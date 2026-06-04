const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const {
  getVSMatch, getVSParticipants, joinVSMatch, updateVSMatchStatus,
  updateVSMatchProblems, removeVSMatch, getUser, db
} = require('../database/db');
const { getCFProblems } = require('./codeforces');
const { processActiveMatch, buildVSMatchEmbed } = require('../tasks/vsPoller');
const axios = require('axios');

const CF_BASE = 'https://codeforces.com/api';

/**
 * Handle button clicks for versus matches.
 */
async function handleVSButton(interaction, client) {
  const [action, matchId] = interaction.customId.split('_');

  if (action === 'vs-join') {
    await handleVSJoin(interaction, matchId);
  } else if (action === 'vs-start') {
    await handleVSStart(interaction, matchId, client);
  } else if (action === 'vs-cancel') {
    await handleVSCancel(interaction, matchId);
  } else if (action === 'vs-refresh') {
    await handleVSRefresh(interaction, matchId, client);
  } else if (action === 'vs-abort') {
    await handleVSAbort(interaction, matchId, client);
  }
}

/**
 * Join Lobby
 */
async function handleVSJoin(interaction, matchId) {
  const match = getVSMatch(matchId);
  if (!match) {
    return interaction.reply({ content: '❌ Match not found.', flags: 64 });
  }
  if (match.status !== 'lobby') {
    return interaction.reply({ content: '❌ This match has already started or ended.', flags: 64 });
  }

  const user = getUser(interaction.user.id);
  if (!user || !user.cf_handle) {
    return interaction.reply({
      content: '⚠️ You must link your Codeforces account using \`/link\` before joining the match!',
      flags: 64
    });
  }

  // Check if already in this match
  const participants = getVSParticipants(matchId);
  if (participants.some(p => p.discord_id === interaction.user.id)) {
    return interaction.reply({ content: '⚠️ You have already joined this match lobby!', flags: 64 });
  }

  // Check if active in another match
  const activeMatch = db.prepare(`
    SELECT m.id FROM vs_matches m
    JOIN vs_participants p ON m.id = p.match_id
    WHERE p.discord_id = ? AND m.status = 'active'
  `).get(interaction.user.id);

  if (activeMatch) {
    return interaction.reply({
      content: '⚠️ You are already in another active versus match! Complete or abort that match first.',
      flags: 64
    });
  }

  // Join match
  joinVSMatch(matchId, interaction.user.id, user.cf_handle);
  const updatedParticipants = getVSParticipants(matchId);

  // Re-build embed
  const embed = buildLobbyEmbed(match, updatedParticipants);
  await interaction.update({ embeds: [embed] });
}

/**
 * Cancel Lobby
 */
async function handleVSCancel(interaction, matchId) {
  const match = getVSMatch(matchId);
  if (!match) {
    return interaction.reply({ content: '❌ Match not found.', flags: 64 });
  }
  if (match.status !== 'lobby') {
    return interaction.reply({ content: '❌ You can only cancel matches in the lobby stage.', flags: 64 });
  }

  if (interaction.user.id !== match.creator_id) {
    return interaction.reply({ content: '⚠️ Only the host can cancel this lobby.', flags: 64 });
  }

  removeVSMatch(matchId);

  await interaction.update({
    content: `❌ **Versus Match Lobby was cancelled by host** (<@${match.creator_id}>).`,
    embeds: [],
    components: []
  });
}

/**
 * Start Match
 */
async function handleVSStart(interaction, matchId, client) {
  const match = getVSMatch(matchId);
  if (!match) {
    return interaction.reply({ content: '❌ Match not found.', flags: 64 });
  }
  if (match.status !== 'lobby') {
    return interaction.reply({ content: '❌ This match has already started.', flags: 64 });
  }

  if (interaction.user.id !== match.creator_id) {
    return interaction.reply({ content: '⚠️ Only the host can start this match.', flags: 64 });
  }

  const participants = getVSParticipants(matchId);
  if (participants.length < 2) {
    return interaction.reply({
      content: '⚠️ You need at least 2 participants to start a versus match!',
      flags: 64
    });
  }

  // Defer update as Codeforces API calls take time
  await interaction.deferUpdate();

  // 1. Gather all solved problems for all participants to exclude
  const excludeSet = new Set();
  for (const p of participants) {
    try {
      const res = await axios.get(`${CF_BASE}/user.status?handle=${p.cf_handle}&from=1&count=10000`, { timeout: 10000 });
      if (res.data.status === 'OK') {
        for (const sub of res.data.result) {
          if (sub.verdict === 'OK' && sub.problem) {
            excludeSet.add(`${sub.problem.contestId}${sub.problem.index}`);
          }
        }
      }
    } catch (err) {
      console.warn(`[VS-Start] Failed to fetch submissions for ${p.cf_handle} (skipping exclusion):`, err.message);
    }
  }

  // 2. Fetch unsolved problems for rating
  let problems = await getCFProblems(match.rating, match.rating, match.tag, match.problems_count, excludeSet);
  
  // If count is not enough, fall back to rating +/- 100 range
  if (problems.length < match.problems_count) {
    console.log(`[VS-Start] Not enough problems at rating ${match.rating}. Falling back to rating +/- 100 range...`);
    problems = await getCFProblems(match.rating - 100, match.rating + 100, match.tag, match.problems_count, excludeSet);
  }

  if (problems.length < match.problems_count) {
    return interaction.followUp({
      content: `❌ Could not find enough unsolved problems with these filters. Please try another rating/tag.`,
      flags: 64
    });
  }

  // 3. Update match details
  const now = Math.floor(Date.now() / 1000);
  const endsAt = now + match.duration_min * 60;
  
  // Save problems and update match state in DB
  updateVSMatchProblems(matchId, problems);
  updateVSMatchStatus(matchId, 'active', now, endsAt);

  // Retrieve updated match object
  const updatedMatch = getVSMatch(matchId);

  // 4. Build active match message
  const embed = buildVSMatchEmbed(updatedMatch, participants);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`vs-refresh_${matchId}`)
      .setLabel('🔄 Refresh Standings')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`vs-abort_${matchId}`)
      .setLabel('🛑 Abort Match')
      .setStyle(ButtonStyle.Danger)
  );

  await interaction.editReply({ embeds: [embed], components: [row] });

  // Post start alert text in the channel
  const pMentions = participants.map(p => `<@${p.discord_id}>`).join(' ');
  const channel = interaction.channel;
  if (channel) {
    await channel.send({
      content: `⚔️ **Versus Match Started!** ${pMentions}\nSolve the problems listed in the embed above. Good luck!`
    }).catch(() => {});
  }
}

/**
 * Refresh Standings
 */
async function handleVSRefresh(interaction, matchId, client) {
  const match = getVSMatch(matchId);
  if (!match) {
    return interaction.reply({ content: '❌ Match not found.', flags: 64 });
  }
  if (match.status !== 'active') {
    return interaction.reply({ content: '❌ This match is not active.', flags: 64 });
  }

  // Defer update as CF status sync is synchronous/slow
  await interaction.deferReply({ flags: 64 });

  await processActiveMatch(client, match);

  await interaction.editReply({ content: '✅ Standings refreshed!' });
}

/**
 * Abort Match
 */
async function handleVSAbort(interaction, matchId, client) {
  const match = getVSMatch(matchId);
  if (!match) {
    return interaction.reply({ content: '❌ Match not found.', flags: 64 });
  }
  if (match.status !== 'active') {
    return interaction.reply({ content: '❌ Only active matches can be aborted.', flags: 64 });
  }

  if (interaction.user.id !== match.creator_id) {
    return interaction.reply({ content: '⚠️ Only the host can abort this match.', flags: 64 });
  }

  const participants = getVSParticipants(matchId);
  const { concludeMatch } = require('../tasks/vsPoller');
  const channel = interaction.channel;

  await concludeMatch(client, channel, match, participants, `Aborted by host (<@${match.creator_id}>)`);
  await interaction.reply({ content: '✅ Match aborted successfully.', flags: 64 });
}

/**
 * Build the lobby embed.
 */
function buildLobbyEmbed(match, participants) {
  const pList = participants.map((p, idx) => {
    return `\`${idx + 1}.\` <@${p.discord_id}> (${p.cf_handle})`;
  }).join('\n');

  return new EmbedBuilder()
    .setColor(0x3498DB)
    .setTitle('⚔️ Versus Match Lobby')
    .setDescription(`A versus match is being hosted! Click **Join Match** below to play.\n\n**Match ID**: \`${match.id}\``)
    .addFields(
      { name: '👤 Host', value: `<@${match.creator_id}>`, inline: true },
      { name: '🏅 Rating', value: `\`${match.rating}\``, inline: true },
      { name: '🏷️ Tag', value: match.tag ? `\`${match.tag}\`` : '`None`', inline: true },
      { name: '⏱️ Duration', value: `\`${match.duration_min} minutes\``, inline: true },
      { name: '🔢 Problems', value: `\`${match.problems_count}\``, inline: true },
      { name: '👥 Joined Participants', value: pList || '_No one has joined yet._', inline: false }
    )
    .setFooter({ text: 'Requires at least 2 participants to start.' })
    .setTimestamp();
}

module.exports = { handleVSButton, buildLobbyEmbed };
