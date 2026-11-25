// commands/vc.js — Persistent Virtual Contests with timestamp-scoped scoring & restart recovery
const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, PermissionFlagsBits } = require('discord.js');
const crypto = require('crypto');
const {
  getUser,
  getActiveVCForChannel,
  getAllActiveVCs,
  createVC,
  getVC,
  joinVC,
  getVCParticipants,
  markVCEndedIfActive,
  updateVCSolved,
  getRatings
} = require('../database/db');
const {
  CF_TAGS,
  DIV_CHOICES,
  getCFProblems,
  getCFStatus,
  extractSolvedIds,
  respondRatingAutocomplete
} = require('../utils/codeforces');
const { chunkLines } = require('../utils/envHelper');
const { errorEmbed, successEmbed } = require('../utils/embeds');

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
 * Fetches CF problem keys solved STRICTLY within the VC's [startedAt, endsAt] window.
 */
async function getCFUserWindowSolvedKeys(handle, startedAt, endsAt) {
  const subs = await getCFStatus(handle, 500);
  const solved = new Set();
  if (!subs) return solved;

  for (const sub of subs) {
    if (
      sub.verdict === 'OK' &&
      sub.problem &&
      sub.creationTimeSeconds >= startedAt &&
      sub.creationTimeSeconds <= endsAt
    ) {
      solved.add(`${sub.problem.contestId}-${sub.problem.index}`);
    }
  }
  return solved;
}

function buildVCEmbed(vc, problems, participants = [], ended = false, individualSolves = null) {
  const endsAt = vc.ends_at ?? (vc.started_at + vc.duration_sec);
  const isTeam = vc.type && vc.type.startsWith('team');
  const teamsCount = (vc.type && vc.type.startsWith('team_'))
    ? (parseInt(vc.type.split('_')[1], 10) || 2)
    : 2;

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
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      `> ⏱️ **Clock:** <t:${endsAt}:R> (ends <t:${endsAt}:t>)`,
      `> 👥 **Format:** ${isTeam ? `Team Contest (${teamsCount} Squad${teamsCount > 1 ? 's' : ''})` : 'Individual Round'}`,
      `> 🎯 **Challenges:** **\`${problems.length}\` problems**`,
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      '*Click **Join Contest** below to participate!*'
    ].join('\n'));
  } else {
    embed.setDescription([
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '> 🏁 **Contest Status:** `Concluded`',
      `> 👥 **Format:** ${isTeam ? `Team Contest (${teamsCount} Squad${teamsCount > 1 ? 's' : ''})` : 'Individual Round'}`,
      '> 🏆 **Results:** Final scores & standings calculated below!',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
    ].join('\n'));
  }

  const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
  const probLines = problems.map((p, i) => {
    const letter = letters[i] ?? `${i + 1}`;
    const url = `https://codeforces.com/problemset/problem/${p.contestId}/${p.index}`;
    return `\`${letter}.\` [${p.name}](${url}) · ⭐ \`${p.rating ?? '?'}\``;
  });

  chunkLines(probLines.length > 0 ? probLines : ['None'], 1000).forEach((chunk, idx) => {
    embed.addFields({ name: idx === 0 ? `📋 Problem Set (${problems.length})` : '📋 Problem Set (cont.)', value: chunk, inline: false });
  });

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
          value: memberLines.slice(0, 1024),
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
      chunkLines(lines, 1000).forEach((chunk, idx) => {
        embed.addFields({ name: idx === 0 ? '🏆 Leaderboard' : '🏆 Leaderboard (cont.)', value: chunk, inline: false });
      });
    }
  } else {
    embed.addFields({ name: '🏆 Leaderboard', value: 'No participants joined.', inline: false });
  }

  embed.setFooter({ text: `VC ID: ${vc.id} · Difficulty: ~${vc.difficulty}` });
  return embed;
}

async function concludeVC(client, vcId, channelId, fallbackProblems = []) {
  // Atomic ended = 0 -> 1 claim prevents /vc end and setTimeout from double-concluding
  if (!markVCEndedIfActive(vcId)) return false;

  if (vcTimers.has(vcId)) {
    clearTimeout(vcTimers.get(vcId));
    vcTimers.delete(vcId);
  }

  const vc = getVC(vcId);
  const problems = vc?.problems?.length ? vc.problems : fallbackProblems;
  const participants = getVCParticipants(vcId);
  const startedAt = vc?.started_at || 0;
  const endsAt = Math.min(Math.floor(Date.now() / 1000), vc?.ends_at || Math.floor(Date.now() / 1000));

  const individualSolves = {};
  const participantSolvedSets = new Map();

  for (const p of participants) {
    if (p.cf_handle) {
      const solvedKeys = await getCFUserWindowSolvedKeys(p.cf_handle, startedAt, endsAt);
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
    await new Promise(r => setTimeout(r, 250));
  }

  const isTeam = vc?.type?.startsWith('team');
  const teamsCount = vc?.type?.startsWith('team_') ? (parseInt(vc.type.split('_')[1], 10) || 2) : 2;

  if (isTeam) {
    const teamSolvedProblems = {};
    for (let i = 0; i < teamsCount; i++) {
      const tName = TEAM_NAMES[i]?.name || `Team ${String.fromCharCode(65 + i)}`;
      teamSolvedProblems[tName] = new Set();
    }
    for (const p of participants) {
      const teamName = p.team || 'Team A';
      if (!teamSolvedProblems[teamName]) teamSolvedProblems[teamName] = new Set();
      for (const key of (participantSolvedSets.get(p.discord_id) || new Set())) {
        teamSolvedProblems[teamName].add(key);
      }
    }
    for (const p of participants) {
      const teamName = p.team || 'Team A';
      updateVCSolved(vcId, p.discord_id, teamSolvedProblems[teamName]?.size ?? 0);
    }
  } else {
    for (const p of participants) {
      updateVCSolved(vcId, p.discord_id, individualSolves[p.discord_id] || 0);
    }
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return true;

  const updatedParts = getVCParticipants(vcId);
  const embed = buildVCEmbed(
    vc || { id: vcId, ends_at: endsAt, started_at: startedAt, duration_sec: 0, difficulty: problems[0]?.rating ?? '?', type: 'individual' },
    problems,
    updatedParts,
    true,
    individualSolves
  );
  await channel.send({ content: '🏁 **Virtual Contest Ended!**', embeds: [embed] }).catch(() => {});
  return true;
}

function scheduleVCEnd(client, vcId, channelId, delayMs, problems = []) {
  if (vcTimers.has(vcId)) {
    clearTimeout(vcTimers.get(vcId));
  }
  const timer = setTimeout(async () => {
    await concludeVC(client, vcId, channelId, problems).catch(err =>
      console.error(`[VC] Timer conclusion error for ${vcId}:`, err.message)
    );
  }, Math.max(0, delayMs));
  vcTimers.set(vcId, timer);
}

/**
 * Re-arms timers and settles any expired VCs on bot boot.
 */
async function initVCRecovery(client) {
  const activeVCs = getAllActiveVCs();
  if (!activeVCs.length) return;

  const now = Math.floor(Date.now() / 1000);
  for (const vc of activeVCs) {
    if (vc.ends_at <= now) {
      await concludeVC(client, vc.id, vc.channel_id, vc.problems || []).catch(() => {});
    } else {
      const delayMs = (vc.ends_at - now) * 1000;
      scheduleVCEnd(client, vc.id, vc.channel_id, delayMs, vc.problems || []);
    }
  }
  console.log(`[VC] Recovered ${activeVCs.length} active Virtual Contest(s) on boot.`);
}

/**
 * Handles `vc-join-<vcId>` button clicks globally (works even >15m after start or across restarts).
 */
async function handleVCJoinButton(interaction) {
  const vcId = interaction.customId.slice('vc-join-'.length);
  const vc = getVC(vcId);
  const now = Math.floor(Date.now() / 1000);

  if (!vc || vc.ended === 1 || vc.ends_at <= now) {
    return interaction.reply({ content: '❌ This Virtual Contest has already ended.', flags: 64 });
  }

  const joinerId = interaction.user.id;
  const joinerUser = getUser(joinerId);
  if (!joinerUser || !joinerUser.cf_handle) {
    return interaction.reply({
      content: '❌ Link your Codeforces account first with `/link platform:Codeforces` to participate!',
      flags: 64
    });
  }

  const currentParts = getVCParticipants(vcId);
  if (currentParts.some(p => p.discord_id === joinerId)) {
    return interaction.reply({
      content: 'ℹ️ You have already joined this contest! Solve problems on Codeforces and scores will be tallied when it ends.',
      flags: 64
    });
  }

  await interaction.deferReply({ flags: 64 });

  let teamVal = null;
  if (vc.type && vc.type.startsWith('team')) {
    const teamsCount = vc.type.startsWith('team_') ? (parseInt(vc.type.split('_')[1], 10) || 2) : 2;
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
  const updatedEmbed = buildVCEmbed(vc, vc.problems || [], updatedParts, false);

  await interaction.message.edit({ embeds: [updatedEmbed] }).catch(() => {});
  return interaction.editReply({
    content: `✅ Joined! ${teamVal ? `Assigned to **${teamVal}**.` : ''} Solve on Codeforces during the round window!`
  });
}

module.exports = {
  guildOnly: true,
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
            .setDescription('Number of problems (default: 5, max: 10)')
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
        .setDescription('View timer and standings of the active Virtual Contest in this channel')
    ),

  async autocomplete(interaction) {
    return respondRatingAutocomplete(interaction, getRatings);
  },

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const channelId = interaction.channelId;
    const userId = interaction.user.id;

    if (subcommand === 'end') {
      await interaction.deferReply({ flags: 64 });
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

      await concludeVC(interaction.client, vc.id, channelId, vc.problems || []);
      return interaction.editReply({
        embeds: [successEmbed('Contest Ended', `Virtual contest **${vc.id}** ended and final standings have been posted.`)]
      });
    }

    if (subcommand === 'status') {
      const vc = getActiveVCForChannel(channelId);
      if (!vc) {
        return interaction.reply({
          embeds: [errorEmbed('No Active Contest', 'There is no active virtual contest in this channel. Start one with `/vc start`!')],
          flags: 64
        });
      }
      const parts = getVCParticipants(vc.id);
      const embed = buildVCEmbed(vc, vc.problems || [], parts, false);
      return interaction.reply({ embeds: [embed] });
    }

    if (subcommand === 'start') {
      await interaction.deferReply();

      const existingVC = getActiveVCForChannel(channelId);
      if (existingVC) {
        return interaction.editReply({
          embeds: [errorEmbed('Contest Already Running', 'A virtual contest is already running in this channel! End it with `/vc end` first.')]
        });
      }

      const targetRating = interaction.options.getInteger('difficulty');
      const durationMin = interaction.options.getInteger('duration') ?? 90;
      const durationSec = durationMin * 60;
      const count = interaction.options.getInteger('problems') ?? 5;
      const tag = interaction.options.getString('tag');
      const division = interaction.options.getString('division');
      const type = interaction.options.getString('type') || 'individual';
      const teamsCount = interaction.options.getInteger('teams') || 2;

      const creator = getUser(userId);
      const excludeIds = new Set();
      if (creator?.cf_handle) {
        extractSolvedIds(await getCFStatus(creator.cf_handle, 5000), excludeIds);
      }

      let problems = await getCFProblems({
        minRating: Math.max(800, targetRating - 200),
        maxRating: Math.min(3500, targetRating + 200),
        tag: tag || undefined,
        division: division || undefined,
        excludeIds,
        count
      });

      if (problems.length < count) {
        problems = await getCFProblems({
          minRating: Math.max(800, targetRating - 400),
          maxRating: Math.min(3500, targetRating + 400),
          tag: tag || undefined,
          division: division || undefined,
          excludeIds,
          count
        });
      }

      if (problems.length === 0) {
        return interaction.editReply({
          embeds: [errorEmbed('No Problems Found', 'Could not find Codeforces problems matching your criteria. Try widening rating/tag filters.')]
        });
      }

      const vcId = crypto.randomBytes(4).toString('hex');
      const dbType = type === 'team' ? `team_${teamsCount}` : 'individual';
      const nowSec = Math.floor(Date.now() / 1000);
      const endsAt = nowSec + durationSec;

      createVC(vcId, channelId, interaction.guildId, userId, targetRating, durationSec, problems, dbType);

      if (creator?.cf_handle) {
        joinVC(vcId, userId, creator.cf_handle, type === 'team' ? 'Team A' : null);
      }

      const initialParts = getVCParticipants(vcId);
      const embed = buildVCEmbed(
        { id: vcId, ends_at: endsAt, started_at: nowSec, duration_sec: durationSec, difficulty: targetRating, type: dbType },
        problems,
        initialParts,
        false
      );

      const joinBtn = new ButtonBuilder()
        .setCustomId(`vc-join-${vcId}`)
        .setLabel('Join Contest ⚔️')
        .setStyle(ButtonStyle.Success);

      await interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(joinBtn)] });
      scheduleVCEnd(interaction.client, vcId, channelId, durationSec * 1000, problems);
    }
  },

  concludeVC,
  handleVCJoinButton,
  initVCRecovery,
  vcTimers
};
