// commands/vc.js — Unified Virtual Contest command (start, end, status)
const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType, PermissionFlagsBits } = require('discord.js');
const { getUser, getActiveVCForChannel, createVC, getVC, joinVC, getVCParticipants, endVC, updateVCSolved, getRatings } = require('../database/db');
const { getCFProblems, checkCFSolved } = require('../utils/codeforces');
const { errorEmbed, successEmbed }     = require('../utils/embeds');
const crypto = require('crypto');

// Active VC timers (in-memory)
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

function buildVCEmbed(vc, problems, participants = [], ended = false, individualSolves = null) {
  const endsAt = vc.ends_at ?? (vc.started_at + vc.duration_sec);
  const isTeam = vc.type && vc.type.startsWith('team');

  let teamsCount = 2;
  if (vc.type && vc.type.startsWith('team_')) {
    teamsCount = parseInt(vc.type.split('_')[1], 10) || 2;
  }

  const themes = [0x5865F2, 0x2ECC71, 0xE67E22, 0x9B59B6, 0x1ABC9C, 0xE74C3C];
  let color = 0x5865F2;
  if (vc.id) {
    let hash = 0;
    for (let i = 0; i < vc.id.length; i++) hash = (hash * 31 + vc.id.charCodeAt(i)) >>> 0;
    color = themes[hash % themes.length];
  }

  const embed = new EmbedBuilder()
    .setColor(ended ? 0xFFD700 : color)
    .setAuthor({
      name: 'Codeforces Virtual Contest Simulation',
      iconURL: 'https://cdn-icons-png.flaticon.com/512/3112/3112946.png'
    })
    .setTitle(ended ? '🏆 Virtual Contest — Final Standings' : '⚡ Virtual Contest in Progress')
    .setTimestamp();

  if (!ended) {
    embed.setDescription([
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `> ⏱️ **Clock:** <t:${endsAt}:R> (ends <t:${endsAt}:t>)`,
      `> 👥 **Format:** ${isTeam ? `Team Contest (${teamsCount} Squad${teamsCount > 1 ? 's' : ''})` : 'Individual Round'}`,
      `> 🎯 **Challenges:** **\`${problems.length}\` problems**`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `*Click the **Join Contest** button below to participate!*`
    ].join('\n'));
  } else {
    embed.setDescription([
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `> 🏁 **Contest Status:** \`Concluded\``,
      `> 👥 **Format:** ${isTeam ? `Team Contest (${teamsCount} Squad${teamsCount > 1 ? 's' : ''})` : 'Individual Round'}`,
      `> 🏆 **Results:** Final scores & standings calculated below!`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    ].join('\n'));
  }

  const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
  const probLines = problems.map((p, i) => {
    const letter = letters[i] ?? `${i + 1}`;
    const url = `https://codeforces.com/problemset/problem/${p.contestId}/${p.index}`;
    return `\`${letter}.\` [${p.name}](${url}) · ⭐ \`${p.rating ?? '?'}\``;
  });
  embed.addFields({ name: `📋 Problem Set (${problems.length})`, value: probLines.join('\n') || 'None', inline: false });

  if (participants.length > 0) {
    if (isTeam) {
      const teams = {};
      for (let i = 0; i < teamsCount; i++) {
        const teamObj = TEAM_NAMES[i] || { name: `Team ${String.fromCharCode(65 + i)}`, emoji: '⚔️' };
        teams[teamObj.name] = { emoji: teamObj.emoji, members: [], solved: 0 };
      }

      for (const p of participants) {
        const t = p.team || 'Team A';
        if (!teams[t]) teams[t] = { emoji: '⚔️', members: [], solved: 0 };
        teams[t].members.push(p);
        if (p.solved > teams[t].solved) teams[t].solved = p.solved;
      }

      for (const [tName, tData] of Object.entries(teams)) {
        const memberLines = tData.members.map(m => {
          const indiv = ended && individualSolves ? ` (${individualSolves[m.discord_id] || 0} solves)` : '';
          return `• <@${m.discord_id}> (\`${m.cf_handle}\`)${indiv}`;
        }).join('\n') || '_No members joined yet_';

        embed.addFields({
          name: `${tData.emoji} ${tName} — ${tData.solved} Solved`,
          value: memberLines,
          inline: true
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

  embed.setFooter({ text: `VC ID: ${vc.id} · Difficulty: ~${vc.difficulty}` });
  return embed;
}

async function concludeVC(client, vcId, channelId, problems) {
  const vc = getVC(vcId);
  const participants = getVCParticipants(vcId);

  const individualSolves = {};
  const participantSolvedSets = new Map();

  for (const p of participants) {
    if (p.cf_handle) {
      const solvedKeys = await getCFUserSolvedKeys(p.cf_handle);
      const solvedContestProblems = new Set();
      for (const prob of problems) {
        const key = `${prob.contestId}-${prob.index}`;
        if (solvedKeys.has(key)) solvedContestProblems.add(key);
      }
      participantSolvedSets.set(p.discord_id, solvedContestProblems);
      individualSolves[p.discord_id] = solvedContestProblems.size;
    } else {
      participantSolvedSets.set(p.discord_id, new Set());
      individualSolves[p.discord_id] = 0;
    }
    await new Promise(r => setTimeout(r, 300));
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

    for (const p of participants) {
      const teamName = p.team || 'Team A';
      if (!teamSolvedProblems[teamName]) teamSolvedProblems[teamName] = new Set();
      const pSolves = participantSolvedSets.get(p.discord_id) || new Set();
      for (const key of pSolves) teamSolvedProblems[teamName].add(key);
    }

    for (const p of participants) {
      const teamName = p.team || 'Team A';
      const teamScore = teamSolvedProblems[teamName]?.size ?? 0;
      updateVCSolved(vcId, p.discord_id, teamScore);
    }
  } else {
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
    .setName('vc')
    .setDescription('Virtual Contest system (simulated contest rounds)')
    .addSubcommand(sub =>
      sub.setName('start')
        .setDescription('Start a simulated Virtual Contest round')
        .addIntegerOption(opt =>
          opt.setName('difficulty')
            .setDescription('Target problem rating (e.g. 1500)')
            .setRequired(true)
            .setMinValue(800)
            .setMaxValue(3500)
            .setAutocomplete(true)
        )
        .addIntegerOption(opt =>
          opt.setName('duration')
            .setDescription('Duration in minutes (default: 90)')
            .setRequired(false)
            .setMinValue(15)
            .setMaxValue(240)
        )
        .addIntegerOption(opt =>
          opt.setName('problems')
            .setDescription('Number of problems (default: 5)')
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(10)
        )
        .addStringOption(opt =>
          opt.setName('tag')
            .setDescription('Filter by topic tag')
            .setRequired(false)
            .addChoices(...CF_TAGS.map(t => ({ name: t, value: t })))
        )
        .addStringOption(opt =>
          opt.setName('division')
            .setDescription('Filter by Codeforces division')
            .setRequired(false)
            .addChoices(...DIV_CHOICES)
        )
        .addStringOption(opt =>
          opt.setName('type')
            .setDescription('Contest format')
            .setRequired(false)
            .addChoices(
              { name: '👤 Individual', value: 'individual' },
              { name: '👥 Team', value: 'team' }
            )
        )
        .addIntegerOption(opt =>
          opt.setName('teams')
            .setDescription('Number of teams for team battle (1-10, default: 2)')
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(10)
        )
    )
    .addSubcommand(sub =>
      sub.setName('end')
        .setDescription('End the active Virtual Contest in this channel early')
    )
    .addSubcommand(sub =>
      sub.setName('status')
        .setDescription('View the timer and standings of the active Virtual Contest in this channel')
    ),

  async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused();
    const userId = interaction.user.id;
    let cfRating = 1200;
    try {
      const ratings = getRatings(userId);
      cfRating = ratings.find(r => r.platform === 'cf')?.rating ?? 1200;
    } catch (_) {}

    const allRatings = [];
    for (let r = 800; r <= 3500; r += 100) allRatings.push(r);

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
      let startIndex = Math.max(0, targetIndex - 12);
      let endIndex = Math.min(allRatings.length - 1, startIndex + 24);
      choices = allRatings.slice(startIndex, endIndex + 1).map(r => ({ name: r.toString(), value: r }));
    }
    await interaction.respond(choices);
  },

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const channelId = interaction.channelId;
    const userId = interaction.user.id;

    // ─── END ─────────────────────────────────────────────────────────
    if (subcommand === 'end') {
      await interaction.deferReply();
      const vc = getActiveVCForChannel(channelId);
      if (!vc) {
        return interaction.editReply({
          embeds: [errorEmbed('No Active Contest', 'There is no virtual contest running in this channel.')]
        });
      }

      const isCreator = vc.started_by === userId;
      const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);

      if (!isCreator && !isAdmin) {
        return interaction.editReply({
          embeds: [errorEmbed('Permission Denied', 'Only the contest creator or a server admin can end the contest.')]
        });
      }

      if (vcTimers.has(vc.id)) {
        clearTimeout(vcTimers.get(vc.id));
        vcTimers.delete(vc.id);
      }

      const problems = vc.problems ?? [];
      await concludeVC(interaction.client, vc.id, channelId, problems);

      return interaction.editReply({
        embeds: [successEmbed('Contest Ended', `Virtual contest **${vc.id}** ended. Final results posted.`)]
      });
    }

    // ─── STATUS ──────────────────────────────────────────────────────
    if (subcommand === 'status') {
      const vc = getActiveVCForChannel(channelId);
      if (!vc) {
        return interaction.reply({
          embeds: [errorEmbed('No Active Contest', 'There is no active virtual contest in this channel. Start one with `/vc start`!')],
          ephemeral: true
        });
      }

      const parts = getVCParticipants(vc.id);
      const embed = buildVCEmbed(vc, vc.problems || [], parts, false);
      return interaction.reply({ embeds: [embed] });
    }

    // ─── START ───────────────────────────────────────────────────────
    if (subcommand === 'start') {
      await interaction.deferReply();

      const existingVC = getActiveVCForChannel(channelId);
      if (existingVC) {
        return interaction.editReply({
          embeds: [errorEmbed('Contest Already Running', 'A virtual contest is already running in this channel! End it with `/vc end` before starting a new one.')]
        });
      }

      const targetRating = interaction.options.getInteger('difficulty');
      const durationMin  = interaction.options.getInteger('duration') ?? 90;
      const durationSec  = durationMin * 60;
      const count        = interaction.options.getInteger('problems') ?? 5;
      const tag          = interaction.options.getString('tag');
      const division     = interaction.options.getString('division');
      const type         = interaction.options.getString('type') || 'individual';
      const teamsCount   = interaction.options.getInteger('teams') || 2;

      let problems = await getCFProblems({
        minRating: Math.max(800, targetRating - 200),
        maxRating: Math.min(3500, targetRating + 200),
        tag: tag || undefined,
        division: division || undefined,
        count: count
      });

      if (problems.length < count) {
        problems = await getCFProblems({
          minRating: Math.max(800, targetRating - 400),
          maxRating: Math.min(3500, targetRating + 400),
          tag: tag || undefined,
          division: division || undefined,
          count: count
        });
      }

      if (problems.length === 0) {
        return interaction.editReply({
          embeds: [errorEmbed('No Problems Found', 'Could not find Codeforces problems matching your criteria. Try adjusting the difficulty or tag.')]
        });
      }

      const vcId = crypto.randomBytes(4).toString('hex');
      const dbType = type === 'team' ? `team_${teamsCount}` : 'individual';

      createVC(vcId, channelId, interaction.guildId, userId, targetRating, durationSec, problems, dbType);

      const creator = getUser(userId);
      if (creator && creator.cf_handle) {
        joinVC(vcId, userId, creator.cf_handle, type === 'team' ? 'Team A' : null);
      }

      const initialParts = getVCParticipants(vcId);
      const endsAt = Math.floor(Date.now() / 1000) + durationSec;
      const embed = buildVCEmbed(
        { id: vcId, ends_at: endsAt, started_at: Math.floor(Date.now() / 1000), duration_sec: durationSec, difficulty: targetRating, type: dbType },
        problems,
        initialParts,
        false
      );

      const joinBtn = new ButtonBuilder()
        .setCustomId(`vc-join-${vcId}`)
        .setLabel('Join Contest ⚔️')
        .setStyle(ButtonStyle.Success);

      const row = new ActionRowBuilder().addComponents(joinBtn);
      const message = await interaction.editReply({ embeds: [embed], components: [row] });

      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: durationSec * 1000
      });

      collector.on('collect', async btnInteraction => {
        const joinerId = btnInteraction.user.id;
        const joinerUser = getUser(joinerId);

        if (!joinerUser || !joinerUser.cf_handle) {
          return btnInteraction.reply({
            content: '❌ You must link your Codeforces account first with `/link platform: Codeforces` to participate!',
            ephemeral: true
          });
        }

        const currentParts = getVCParticipants(vcId);
        if (currentParts.some(p => p.discord_id === joinerId)) {
          return btnInteraction.reply({
            content: 'ℹ️ You have already joined this contest! Solve problems on Codeforces and your score will be tallied when time expires.',
            ephemeral: true
          });
        }

        let teamVal = null;
        if (type === 'team') {
          const teamCounts = {};
          for (let i = 0; i < teamsCount; i++) {
            const tName = TEAM_NAMES[i]?.name || `Team ${String.fromCharCode(65 + i)}`;
            teamCounts[tName] = 0;
          }
          for (const p of currentParts) {
            if (p.team && teamCounts[p.team] !== undefined) teamCounts[p.team]++;
          }
          let minCount = Infinity;
          let bestTeam = 'Team A';
          for (const [tName, count] of Object.entries(teamCounts)) {
            if (count < minCount) {
              minCount = count;
              bestTeam = tName;
            }
          }
          teamVal = bestTeam;
        }

        joinVC(vcId, joinerId, joinerUser.cf_handle, teamVal);

        const updatedParts = getVCParticipants(vcId);
        const updatedEmbed = buildVCEmbed(
          { id: vcId, ends_at: endsAt, started_at: Math.floor(Date.now() / 1000), duration_sec: durationSec, difficulty: targetRating, type: dbType },
          problems,
          updatedParts,
          false
        );

        await interaction.editReply({ embeds: [updatedEmbed] }).catch(() => {});
        await btnInteraction.reply({
          content: `✅ Joined! ${type === 'team' ? `Assigned to **${teamVal}**.` : ''} Solve on Codeforces; solves are tracked automatically.`,
          ephemeral: true
        });
      });

      const timer = setTimeout(async () => {
        collector.stop();
        await concludeVC(interaction.client, vcId, channelId, problems);
        vcTimers.delete(vcId);
      }, durationSec * 1000);

      vcTimers.set(vcId, timer);
    }
  },

  concludeVC,
  vcTimers
};
