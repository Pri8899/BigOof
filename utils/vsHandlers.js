const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const {
  getVSMatch, getVSParticipants, joinVSMatch, updateVSMatchStatus,
  updateVSMatchProblems, removeVSMatch, getUser, db
} = require('../database/db');
const { getCFProblems } = require('./codeforces');
const { processActiveMatch, buildVSMatchEmbed, buildVSMatchComponents } = require('../tasks/vsPoller');
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

  // 2. Fetch problems based on match mode
  let problems = [];
  const isGrid = match.mode !== 'classic';

  if (isGrid) {
    const r = match.rating;
    const tier1Min = Math.max(800, r - 300);
    const tier1Max = Math.max(800, r - 100);
    const tier2Min = Math.max(800, r - 100);
    const tier2Max = Math.min(3500, r + 100);
    const tier3Min = Math.min(3500, r + 100);
    const tier3Max = Math.min(3500, r + 300);

    const [t1, t2, t3] = await Promise.all([
      getCFProblems(tier1Min, tier1Max, match.tag, 3, excludeSet, match.division).catch(() => []),
      getCFProblems(tier2Min, tier2Max, match.tag, 3, excludeSet, match.division).catch(() => []),
      getCFProblems(tier3Min, tier3Max, match.tag, 3, excludeSet, match.division).catch(() => [])
    ]);

    const collected = [...t1, ...t2, ...t3];
    const seenKeys = new Set(collected.map(p => `${p.contestId}${p.index}`));

    // If any tier fell short, backfill from broader range
    if (collected.length < 9) {
      const needed = 9 - collected.length;
      const broaderExclude = new Set([...excludeSet, ...seenKeys]);
      const fillers = await getCFProblems(Math.max(800, r - 300), Math.min(3500, r + 300), match.tag, needed, broaderExclude, match.division);
      collected.push(...fillers);
    }

    if (collected.length < 9) {
      return interaction.followUp({
        content: `❌ Could not find enough unsolved problems with these filters for a 9-problem Lockout Grid. Try adjusting rating or removing tag.`,
        flags: 64
      });
    }

    // Sort by rating ascending so difficulty scales across the 3x3 grid
    collected.sort((a, b) => (a.rating || 0) - (b.rating || 0));

    // Standard Lockout 3x3 point distribution: 100, 100, 200 / 200, 300, 300 / 400, 400, 500
    const GRID_POINTS = [100, 100, 200, 200, 300, 300, 400, 400, 500];
    problems = collected.slice(0, 9).map((p, idx) => ({
      ...p,
      gridIndex: idx + 1,
      points: GRID_POINTS[idx] ?? 100
    }));
  } else {
    // Classic race mode
    const count = match.problems_count || 5;
    problems = await getCFProblems(match.rating, match.rating, match.tag, count, excludeSet, match.division);
    if (problems.length < count) {
      problems = await getCFProblems(match.rating - 100, match.rating + 100, match.tag, count, excludeSet, match.division);
    }

    if (problems.length < count) {
      return interaction.followUp({
        content: `❌ Could not find enough unsolved problems with these filters. Please try another rating/tag.`,
        flags: 64
      });
    }
  }

  // 3. Update match details
  const now = Math.floor(Date.now() / 1000);
  const endsAt = now + match.duration_min * 60;
  
  // Save problems and update match state in DB
  updateVSMatchProblems(matchId, problems);
  updateVSMatchStatus(matchId, 'active', now, endsAt);

  // Retrieve updated match object
  const updatedMatch = getVSMatch(matchId);

  // 4. Build active match message with interactive 3x3 buttons
  const embed = buildVSMatchEmbed(updatedMatch, participants);
  const components = buildVSMatchComponents(updatedMatch);

  await interaction.editReply({ embeds: [embed], components });

  // Post start alert text in the channel
  const pMentions = participants.map(p => `<@${p.discord_id}>`).join(' ');
  const channel = interaction.channel;
  if (channel) {
    const battleType = isGrid ? '⚔️ **3x3 Lockout Grid Battle Started!**' : '🏁 **Versus Race Started!**';
    await channel.send({
      content: `${battleType} ${pMentions}\nSolve the problems listed in the embed above. First to solve locks the problem in Lockout Grid! Good luck!`
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
    return `> \`${idx + 1}.\` <@${p.discord_id}> · [\`${p.cf_handle}\`](https://codeforces.com/profile/${p.cf_handle})`;
  }).join('\n');

  const divLabels = { div1: 'Div. 1', div2: 'Div. 2', div3: 'Div. 3', div4: 'Div. 4' };
  const divValue = match.division ? `\`${divLabels[match.division] ?? match.division}\`` : '`Standard`';
  const modeLabel = match.mode === 'classic'
    ? '🏁 **Classic Race** *(Time decay scoring)*'
    : '⚔️ **3x3 Lockout Grid** *(First AC locks tile · 2500 pts)*';

  return new EmbedBuilder()
    .setColor(0x7C4DFF)
    .setAuthor({
      name: 'Codeforces Duel Arena',
      iconURL: 'https://cdn-icons-png.flaticon.com/512/3112/3112946.png'
    })
    .setTitle(`⚔️ Lockout Match Lobby · ID \`${match.id}\``)
    .setDescription([
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `> 👑 **Host:** <@${match.creator_id}>`,
      `> 🎮 **Battle Format:** ${modeLabel}`,
      `> 🏅 **Target Rating:** **${match.rating}**`,
      `> 🏆 **Division:** ${divValue}`,
      `> ⏱️ **Time Limit:** **${match.duration_min} mins**`,
      `> 🔢 **Problems:** **${match.problems_count} challenges**`,
      match.tag ? `> 🏷️ **Tag:** \`${match.tag}\`` : null,
      `> 🆔 **Match Key:** \`${match.id}\``,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `👥 **Contenders Ready (${participants.length}):**`,
      (pList || '> *Waiting for challengers to click Join below...*'),
      ``,
      `💡 *Host can click **Start Match** once at least 2 contenders have joined!*`
    ].filter(Boolean).join('\n'))
    .setThumbnail('https://cdn-icons-png.flaticon.com/512/3112/3112946.png')
    .setFooter({ text: 'BigOof Lockout Duel · Real-time Codeforces sync' })
    .setTimestamp();
}

module.exports = { handleVSButton, buildLobbyEmbed };
