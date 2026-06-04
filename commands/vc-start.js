// commands/vc-start.js — Virtual Contest: start, join, end
const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType } = require('discord.js');
const { getUser, getActiveVCForChannel, createVC, getVC, joinVC, getVCParticipants, endVC, updateVCSolved, getRatings } = require('../database/db');
const { getCFProblems, checkCFSolved } = require('../utils/codeforces');
const { errorEmbed, successEmbed }     = require('../utils/embeds');
const crypto = require('crypto');

// Active VC timers (in-memory, lost on restart but DB is the source of truth)
const vcTimers = new Map();

const TEAM_NAMES = [
  { name: 'Team A', emoji: '🔴' },
  { name: 'Team B', emoji: '🔵' },
  { name: 'Team C', emoji: '🟢' },
  { name: 'Team D', emoji: '🟡' },
  { name: 'Team E', emoji: '🟣' },
  { name: 'Team F', emoji: '🟠' },
  { name: 'Team G', emoji: '🟤' },
  { name: 'Team H', emoji: '⚫' },
  { name: 'Team I', emoji: '⚪' },
  { name: 'Team J', emoji: '🟩' }
];

/**
 * Fetch Codeforces status for a user to see their solved keys
 */
async function getCFUserSolvedKeys(handle) {
  try {
    const axios = require('axios');
    const res = await axios.get(
      `https://codeforces.com/api/user.status?handle=${handle}&from=1&count=200`,
      { timeout: 10000 }
    );
    if (res.data.status !== 'OK') return new Set();
    const solved = new Set();
    for (const sub of res.data.result) {
      if (sub.verdict === 'OK' && sub.problem) {
        solved.add(`${sub.problem.contestId}-${sub.problem.index}`);
      }
    }
    return solved;
  } catch (err) {
    console.error(`[CF] Error fetching submissions for ${handle}:`, err.message);
    return new Set();
  }
}

/**
 * Build the VC embed showing problems + participants
 */
function buildVCEmbed(vc, problems, participants = [], ended = false, individualSolves = null) {
  const endsAt = vc.ends_at ?? (vc.started_at + vc.duration_sec);
  const isTeam = vc.type && vc.type.startsWith('team');

  let teamsCount = 2;
  if (vc.type && vc.type.startsWith('team_')) {
    teamsCount = parseInt(vc.type.split('_')[1], 10) || 2;
  }

  // Elegant, moody themes
  let embedColor = 0x5865F2; // Discord Blurple
  if (ended) {
    embedColor = 0x2F3136; // Sleek Dark Theme
  } else if (isTeam) {
    embedColor = 0x00D2FF; // Vibrant Team Cyan
  } else {
    embedColor = 0xFF3E55; // Crimson Individual Red
  }

  const embed  = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(`${ended ? '🏁' : '⚔️'} Virtual Contest${isTeam ? ` (Team Battle - ${teamsCount} Teams)` : ''}${ended ? ' — Results' : ''}`)
    .setDescription(
      ended
        ? `**Contest Over!** Final results for this **${isTeam ? 'Team Battle' : 'Individual Battle'}**:`
        : `Contest is **live**! This is a **${isTeam ? `👥 Team Battle (${teamsCount} Teams)` : '👤 Individual Battle'}**.\nSolve as many problems as you can before time runs out.\n\nEnds: <t:${endsAt}:R>`
    );

  problems.forEach((p, i) => {
    embed.addFields({
      name:  `Problem ${i + 1} · ⭐ ${p.rating}`,
      value: `**[${p.name}](${p.url})**\n🏷️ ${p.tags.join(', ') || 'N/A'}`,
      inline: false
    });
  });

  if (!ended) {
    if (participants.length > 0) {
      if (isTeam) {
        const fields = [];
        for (let i = 0; i < teamsCount; i++) {
          const tInfo = TEAM_NAMES[i] || { name: `Team ${String.fromCharCode(65 + i)}`, emoji: '👥' };
          const members = participants.filter(p => p.team === tInfo.name);
          const formatMember = p => `• <@${p.discord_id}> (\`${p.cf_handle}\`)`;

          fields.push({
            name: `${tInfo.emoji} ${tInfo.name} (${members.length})`,
            value: members.map(formatMember).join('\n') || '*No members yet*',
            inline: true
          });
        }
        embed.addFields(fields);
      } else {
        const lines = participants.map(p => `• <@${p.discord_id}> (\`${p.cf_handle}\`)`);
        embed.addFields({
          name: `👥 Participants (${participants.length})`,
          value: lines.join('\n') || '*No participants yet*',
          inline: false
        });
      }
    }
  } else {
    if (participants.length > 0) {
      if (isTeam) {
        const teamsData = [];
        for (let i = 0; i < teamsCount; i++) {
          const tInfo = TEAM_NAMES[i] || { name: `Team ${String.fromCharCode(65 + i)}`, emoji: '👥' };
          const members = participants.filter(p => p.team === tInfo.name);
          const score = members[0]?.solved ?? 0;
          teamsData.push({ ...tInfo, score, members });
        }

        const teamsSorted = teamsData.sort((a, b) => b.score - a.score);

        const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
        const leaderboardLines = teamsSorted.map((t, idx) => {
          return `${medals[idx] || `${idx + 1}.`} **${t.emoji} ${t.name}** — **${t.score}** solved`;
        });

        embed.addFields({
          name: '🏆 Team Rankings',
          value: leaderboardLines.join('\n'),
          inline: false
        });

        for (const t of teamsSorted) {
          const memberLines = t.members.map(m => {
            let indSolvedText = '';
            if (individualSolves && individualSolves[m.discord_id] !== undefined) {
              indSolvedText = ` (contributed ${individualSolves[m.discord_id]} solves)`;
            }
            return `• <@${m.discord_id}> (\`${m.cf_handle}\`)${indSolvedText}`;
          });
          embed.addFields({
            name: `${t.emoji} ${t.name} Members`,
            value: memberLines.join('\n') || '*No members*',
            inline: false
          });
        }
      } else {
        const medals = ['🥇', '🥈', '🥉'];
        const sorted = [...participants].sort((a, b) => {
          if (b.solved !== a.solved) return b.solved - a.solved;
          return (a.finish_time ?? Infinity) - (b.finish_time ?? Infinity);
        });
        const lines = sorted.map((p, i) =>
          `${medals[i] ?? `${i + 1}.`} <@${p.discord_id}> (\`${p.cf_handle}\`) — **${p.solved}** solved`
        );
        embed.addFields({ name: '🏆 Leaderboard', value: lines.join('\n') || 'No solves recorded', inline: false });
      }
    } else {
      embed.addFields({ name: '🏆 Leaderboard', value: 'No participants joined.', inline: false });
    }
  }

  embed.setFooter({ text: `VC ID: ${vc.id} · Difficulty: ~${vc.difficulty}` }).setTimestamp();
  return embed;
}

/**
 * End a VC: grade all participants and post results
 */
async function concludeVC(client, vcId, channelId, problems) {
  const vc = getVC(vcId);
  const participants = getVCParticipants(vcId);

  const individualSolves = {};
  const participantSolvedSets = new Map();

  // Grade each participant
  for (const p of participants) {
    if (p.cf_handle) {
      const solvedKeys = await getCFUserSolvedKeys(p.cf_handle);
      const solvedContestProblems = new Set();
      for (const prob of problems) {
        const key = `${prob.contestId}-${prob.index}`;
        if (solvedKeys.has(key)) {
          solvedContestProblems.add(key);
        }
      }
      participantSolvedSets.set(p.discord_id, solvedContestProblems);
      individualSolves[p.discord_id] = solvedContestProblems.size;
    } else {
      participantSolvedSets.set(p.discord_id, new Set());
      individualSolves[p.discord_id] = 0;
    }
    await new Promise(r => setTimeout(r, 300)); // be gentle with CF API
  }

  const isTeam = vc && vc.type && vc.type.startsWith('team');
  let teamsCount = 2;
  if (vc && vc.type && vc.type.startsWith('team_')) {
    teamsCount = parseInt(vc.type.split('_')[1], 10) || 2;
  }

  if (isTeam) {
    const teamSolvedProblems = {};
    for (let i = 0; i < teamsCount; i++) {
      const tName = TEAM_NAMES[i]?.name || `Team ${String.fromCharCode(65 + i)}`;
      teamSolvedProblems[tName] = new Set();
    }

    // Calculate union for each team
    for (const p of participants) {
      const teamName = p.team || 'Team A';
      if (!teamSolvedProblems[teamName]) {
        teamSolvedProblems[teamName] = new Set();
      }
      const pSolves = participantSolvedSets.get(p.discord_id) || new Set();
      for (const key of pSolves) {
        teamSolvedProblems[teamName].add(key);
      }
    }

    // Update each participant's solved count in the DB to their team's union count
    for (const p of participants) {
      const teamName = p.team || 'Team A';
      const teamScore = teamSolvedProblems[teamName]?.size ?? 0;
      updateVCSolved(vcId, p.discord_id, teamScore);
    }
  } else {
    // Individual contest: update each participant's solved count to their individual count
    for (const p of participants) {
      const pScore = individualSolves[p.discord_id] || 0;
      updateVCSolved(vcId, p.discord_id, pScore);
    }
  }

  endVC(vcId);

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  const updatedParts = getVCParticipants(vcId);
  const embed = buildVCEmbed(
    vc || { id: vcId, ends_at: 0, started_at: 0, duration_sec: 0, difficulty: problems[0]?.rating ?? '?', type: 'individual' },
    problems,
    updatedParts,
    true,
    individualSolves
  );
  await channel.send({ content: '🏁 **Virtual Contest Ended!**', embeds: [embed] }).catch(() => {});
}

const CF_TAGS = [
  'implementation', 'math', 'greedy', 'dp', 'data structures',
  'graphs', 'strings', 'binary search', 'constructive algorithms',
  'number theory'
];

const DIV_CHOICES = [
  { name: 'Div. 1', value: 'div1' },
  { name: 'Div. 2', value: 'div2' },
  { name: 'Div. 3', value: 'div3' },
  { name: 'Div. 4', value: 'div4' }
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('vc-start')
    .setDescription('Start a Virtual Contest with random Codeforces problems')
    .addIntegerOption(opt =>
      opt.setName('difficulty')
        .setDescription('Target problem rating (e.g. 1500)')
        .setRequired(true)
        .setMinValue(800)
        .setMaxValue(3500)
        .setAutocomplete(true))
    .addIntegerOption(opt =>
      opt.setName('duration')
        .setDescription('Duration in minutes (default: 90)')
        .setRequired(false)
        .setMinValue(15)
        .setMaxValue(240))
    .addIntegerOption(opt =>
      opt.setName('problems')
        .setDescription('Number of problems (default: 5)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(10))
    .addStringOption(opt =>
      opt.setName('tag')
        .setDescription('Filter by topic tag')
        .setRequired(false)
        .addChoices(...CF_TAGS.map(t => ({ name: t, value: t }))))
    .addStringOption(opt =>
      opt.setName('division')
        .setDescription('Filter by Codeforces division')
        .setRequired(false)
        .addChoices(...DIV_CHOICES))
    .addStringOption(opt =>
      opt.setName('type')
        .setDescription('Contest type (Individual or Team)')
        .setRequired(false)
        .addChoices(
          { name: '👤 Individual', value: 'individual' },
          { name: '👥 Team', value: 'team' }
        ))
    .addIntegerOption(opt =>
      opt.setName('teams')
        .setDescription('Number of teams for team battle (set 1 for single-team coop)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(10)),

  async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused();
    const userId = interaction.user.id;
    let cfRating = 1200;
    try {
      const ratings = getRatings(userId);
      cfRating = ratings.find(r => r.platform === 'cf')?.rating ?? 1200;
    } catch (err) {
      console.error('[VC-Start Autocomplete] Database query failed:', err);
    }

    const allRatings = [];
    for (let r = 800; r <= 3500; r += 100) {
      allRatings.push(r);
    }

    let choices = [];
    if (focusedValue) {
      const filtered = allRatings
        .map(r => r.toString())
        .filter(choice => choice.startsWith(focusedValue))
        .slice(0, 25);
      choices = filtered.map(choice => ({ name: choice, value: parseInt(choice, 10) }));
    } else {
      const roundedRating = Math.round(cfRating / 100) * 100;
      const targetRating = Math.max(800, Math.min(3500, roundedRating));
      const targetIndex = allRatings.indexOf(targetRating);

      let startIndex = targetIndex - 12;
      let endIndex = targetIndex + 12;

      if (startIndex < 0) {
        startIndex = 0;
        endIndex = Math.min(allRatings.length - 1, 24);
      }
      if (endIndex >= allRatings.length) {
        endIndex = allRatings.length - 1;
        startIndex = Math.max(0, endIndex - 24);
      }

      const windowRatings = allRatings.slice(startIndex, endIndex + 1);
      choices = windowRatings.map(r => ({ name: r.toString(), value: r }));
    }

    await interaction.respond(choices).catch(() => {});
  },

  async execute(interaction) {
    await interaction.deferReply();

    const channelId    = interaction.channelId;
    const guildId      = interaction.guildId;
    const userId       = interaction.user.id;
    const targetRating = interaction.options.getInteger('difficulty');
    const durationMin  = interaction.options.getInteger('duration') ?? 90;
    const problemCount = interaction.options.getInteger('problems') ?? 5;
    const tag          = interaction.options.getString('tag') || null;
    const division     = interaction.options.getString('division') || null;
    let type           = interaction.options.getString('type') || 'individual';
    const teamsCountOption = interaction.options.getInteger('teams');
    const durationSec  = durationMin * 60;

    if (teamsCountOption && type === 'individual') {
      type = 'team';
    }

    let dbType = type;
    let teamsCount = 2;
    if (type === 'team') {
      teamsCount = teamsCountOption || 2;
      dbType = `team_${teamsCount}`;
    }

    // Check if a VC is already running
    const existing = getActiveVCForChannel(channelId);
    if (existing) {
      return interaction.editReply({
        embeds: [errorEmbed('Contest Already Running', `A virtual contest is already active in this channel! It ends <t:${existing.ends_at}:R>.`)]
      });
    }

    // Pick problems
    const minR = Math.max(800, targetRating - 100);
    const maxR = Math.min(3500, targetRating + 100);
    const problems = await getCFProblems(minR, maxR, tag, problemCount, new Set(), division);

    if (problems.length < 1) {
      return interaction.editReply({
        embeds: [errorEmbed('No Problems Found', 'Could not fetch CF problems with these filters. Try again.')]
      });
    }

    // Create VC in DB
    const vcId = crypto.randomBytes(4).toString('hex').toUpperCase();
    createVC(vcId, channelId, guildId, userId, String(targetRating), durationSec, problems, dbType);

    // Auto-join the creator if they have CF linked
    const user = getUser(userId);
    if (user?.cf_handle) {
      const teamVal = type === 'team' ? TEAM_NAMES[0].name : null;
      joinVC(vcId, userId, user.cf_handle, teamVal);
    }

    // Build join button
    const joinBtn = new ButtonBuilder()
      .setCustomId(`vc_join_${vcId}`)
      .setLabel('✅ Join Contest')
      .setStyle(ButtonStyle.Success);
    const row = new ActionRowBuilder().addComponents(joinBtn);

    const embed = buildVCEmbed(
      { id: vcId, ends_at: Math.floor(Date.now() / 1000) + durationSec, started_at: Math.floor(Date.now() / 1000), duration_sec: durationSec, difficulty: targetRating, type: dbType },
      problems,
      user?.cf_handle ? [{ discord_id: userId, cf_handle: user.cf_handle, team: type === 'team' ? TEAM_NAMES[0].name : null }] : []
    );

    await interaction.editReply({ embeds: [embed], components: [row] });

    // Collect join button clicks for the full duration
    const msg = await interaction.fetchReply();
    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: durationSec * 1000
    });

    collector.on('collect', async btnInteraction => {
      if (!btnInteraction.customId.startsWith('vc_join_')) return;
      const clicker = getUser(btnInteraction.user.id);
      
      // 1. Verify Codeforces linkage
      if (!clicker || !clicker.cf_handle) {
        return btnInteraction.reply({
          content: `⚠️ You must link your Codeforces account first using \`/link\` before joining the virtual contest!`,
          ephemeral: true
        });
      }

      // 2. Check if already joined
      const participants = getVCParticipants(vcId);
      const alreadyJoined = participants.some(p => p.discord_id === btnInteraction.user.id);
      if (alreadyJoined) {
        return btnInteraction.reply({
          content: `⚠️ You've already joined this contest!`,
          ephemeral: true
        });
      }

      let teamVal = null;
      if (type === 'team') {
        const teamIndex = participants.length % teamsCount;
        teamVal = TEAM_NAMES[teamIndex]?.name || `Team ${String.fromCharCode(65 + teamIndex)}`;
      }

      joinVC(vcId, btnInteraction.user.id, clicker.cf_handle, teamVal);

      // Get updated list of participants to update the lobby embed
      const updatedParts = getVCParticipants(vcId);
      const updatedEmbed = buildVCEmbed(
        { id: vcId, ends_at: Math.floor(Date.now() / 1000) + durationSec, started_at: Math.floor(Date.now() / 1000), duration_sec: durationSec, difficulty: targetRating, type: dbType },
        problems,
        updatedParts,
        false
      );

      await interaction.editReply({ embeds: [updatedEmbed] }).catch(err => console.error(err));

      await btnInteraction.reply({
        content: `✅ You've joined the contest! ${type === 'team' ? `You have been assigned to **${teamVal}**.` : ''} Solve the problems on Codeforces and your score will be recorded automatically when time ends.`,
        ephemeral: true
      });
    });

    // Schedule VC end
    const timer = setTimeout(async () => {
      collector.stop();
      await concludeVC(interaction.client, vcId, channelId, problems);
      vcTimers.delete(vcId);
    }, durationSec * 1000);

    vcTimers.set(vcId, timer);
  },

  concludeVC,
  vcTimers
};
