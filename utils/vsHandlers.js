// utils/vsHandlers.js — Interactive button handlers for /vs duel lobbies & active matches
const { EmbedBuilder } = require('discord.js');
const {
  getVSMatch,
  getVSParticipants,
  joinVSMatch,
  claimVSMatchStart,
  removeVSMatch,
  getUser,
  db
} = require('../database/db');
const { getCFProblems, getCFStatus, extractSolvedIds } = require('./codeforces');
const {
  withMatchLock,
  processActiveMatch,
  buildVSMatchEmbed,
  buildVSMatchComponents,
  concludeMatch
} = require('../tasks/vsPoller');

async function handleVSButton(interaction, client) {
  const [action, matchId] = interaction.customId.split('_');

  if (action === 'vs-join') return handleVSJoin(interaction, matchId);
  if (action === 'vs-start') return handleVSStart(interaction, matchId);
  if (action === 'vs-cancel') return handleVSCancel(interaction, matchId);
  if (action === 'vs-refresh') return handleVSRefresh(interaction, matchId, client);
  if (action === 'vs-abort') return handleVSAbort(interaction, matchId, client);
}

async function handleVSJoin(interaction, matchId) {
  const match = getVSMatch(matchId);
  if (!match) return interaction.reply({ content: '❌ Match not found.', flags: 64 });
  if (match.status !== 'lobby') return interaction.reply({ content: '❌ This match has already started or ended.', flags: 64 });

  const user = getUser(interaction.user.id);
  if (!user || !user.cf_handle) {
    return interaction.reply({
      content: '⚠️ You must link your Codeforces account using `/link` before joining the match!',
      flags: 64
    });
  }

  const participants = getVSParticipants(matchId);
  if (participants.some(p => p.discord_id === interaction.user.id)) {
    return interaction.reply({ content: '⚠️ You have already joined this match lobby!', flags: 64 });
  }

  const existingMatch = db.prepare(`
    SELECT m.id FROM vs_matches m
    JOIN vs_participants p ON m.id = p.match_id
    WHERE p.discord_id = ? AND m.status IN ('lobby', 'active')
  `).get(interaction.user.id);

  if (existingMatch) {
    return interaction.reply({
      content: `⚠️ You are already in another lobby or active match (\`${existingMatch.id}\`). Finish or cancel that first.`,
      flags: 64
    });
  }

  joinVSMatch(matchId, interaction.user.id, user.cf_handle);
  const updatedParticipants = getVSParticipants(matchId);
  const embed = buildLobbyEmbed(match, updatedParticipants);
  await interaction.update({ embeds: [embed] });
}

async function handleVSCancel(interaction, matchId) {
  const match = getVSMatch(matchId);
  if (!match) return interaction.reply({ content: '❌ Match not found.', flags: 64 });
  if (match.status !== 'lobby') return interaction.reply({ content: '❌ You can only cancel matches in the lobby stage.', flags: 64 });
  if (interaction.user.id !== match.creator_id) {
    return interaction.reply({ content: '⚠️ Only the host can cancel this lobby.', flags: 64 });
  }

  removeVSMatch(matchId);
  await interaction.update({
    content: `❌ **Versus Match Lobby cancelled by host** (<@${match.creator_id}>).`,
    embeds: [],
    components: []
  });
}

async function handleVSStart(interaction, matchId) {
  const match = getVSMatch(matchId);
  if (!match) return interaction.reply({ content: '❌ Match not found.', flags: 64 });
  if (match.status !== 'lobby') return interaction.reply({ content: '❌ This match has already started.', flags: 64 });
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

  await interaction.deferUpdate();

  // Gather solved problems across all contenders so match serves fresh problems
  const excludeSet = new Set();
  for (const p of participants) {
    extractSolvedIds(await getCFStatus(p.cf_handle, 10000), excludeSet);
    await new Promise(r => setTimeout(r, 300));
  }

  let problems = [];
  const isGrid = match.mode !== 'classic';

  if (isGrid) {
    const r = match.rating;
    const [t1, t2, t3] = await Promise.all([
      getCFProblems(Math.max(800, r - 300), Math.max(800, r - 100), match.tag, 3, excludeSet, match.division),
      getCFProblems(Math.max(800, r - 100), Math.min(3500, r + 100), match.tag, 3, excludeSet, match.division),
      getCFProblems(Math.min(3500, r + 100), Math.min(3500, r + 300), match.tag, 3, excludeSet, match.division)
    ]);

    const seenKeys = new Set();
    const collected = [];
    for (const p of [...t1, ...t2, ...t3]) {
      const k = `${p.contestId}${p.index}`;
      if (!seenKeys.has(k)) {
        seenKeys.add(k);
        collected.push(p);
      }
    }

    if (collected.length < 9) {
      const needed = 9 - collected.length;
      const broaderExclude = new Set([...excludeSet, ...seenKeys]);
      const fillers = await getCFProblems(Math.max(800, r - 300), Math.min(3500, r + 300), match.tag, needed, broaderExclude, match.division);
      for (const p of fillers) {
        const k = `${p.contestId}${p.index}`;
        if (!seenKeys.has(k)) {
          seenKeys.add(k);
          collected.push(p);
        }
      }
    }

    if (collected.length < 9) {
      return interaction.followUp({
        content: '❌ Could not find enough unsolved problems for a 3x3 Battle Grid. Try cancelling this lobby and widening filters.',
        flags: 64
      });
    }

    collected.sort((a, b) => (Number(a.rating) || 0) - (Number(b.rating) || 0));
    const GRID_POINTS = [100, 100, 200, 200, 300, 300, 400, 400, 500];
    problems = collected.slice(0, 9).map((p, idx) => ({
      ...p,
      gridIndex: idx + 1,
      points: GRID_POINTS[idx] ?? 100
    }));
  } else {
    const count = match.problems_count || 5;
    problems = await getCFProblems(match.rating, match.rating, match.tag, count, excludeSet, match.division);
    if (problems.length < count) {
      problems = await getCFProblems(Math.max(800, match.rating - 100), Math.min(3500, match.rating + 100), match.tag, count, excludeSet, match.division);
    }

    if (problems.length < count) {
      return interaction.followUp({
        content: '❌ Could not find enough unsolved problems with these filters. Cancel lobby and adjust rating/tag.',
        flags: 64
      });
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const endsAt = now + match.duration_min * 60;

  if (!claimVSMatchStart(matchId, problems, now, endsAt)) {
    return interaction.followUp({ content: '⚠️ Match was already started or cancelled.', flags: 64 });
  }

  const updatedMatch = getVSMatch(matchId);
  const embed = buildVSMatchEmbed(updatedMatch, participants);
  const components = buildVSMatchComponents(updatedMatch, participants);
  await interaction.editReply({ embeds: [embed], components });

  const pMentions = participants.map(p => `<@${p.discord_id}>`).join(' ');
  if (interaction.channel) {
    const battleType = isGrid ? '⚔️ **3x3 Grid Battle Started!**' : '🏁 **Versus Race Started!**';
    const ruleHint = isGrid
      ? '1st AC scores 100% full points; subsequent solves score 1/3 value.'
      : 'Solve problems as fast as possible!';
    await interaction.channel.send({
      content: `${battleType} ${pMentions}\n${ruleHint} Good luck!`
    }).catch(() => {});
  }
}

async function handleVSRefresh(interaction, matchId, client) {
  const match = getVSMatch(matchId);
  if (!match) return interaction.reply({ content: '❌ Match not found.', flags: 64 });
  if (match.status !== 'active') return interaction.reply({ content: '❌ This match is not active.', flags: 64 });

  await interaction.deferReply({ flags: 64 });
  const acquired = await withMatchLock(matchId, () => processActiveMatch(client, match));
  await interaction.editReply({
    content: acquired ? '✅ Standings refreshed!' : '⏳ A sync check is already in progress — try again in a moment.'
  });
}

async function handleVSAbort(interaction, matchId, client) {
  const match = getVSMatch(matchId);
  if (!match) return interaction.reply({ content: '❌ Match not found.', flags: 64 });
  if (match.status !== 'active') return interaction.reply({ content: '❌ Only active matches can be aborted.', flags: 64 });
  if (interaction.user.id !== match.creator_id) {
    return interaction.reply({ content: '⚠️ Only the host can abort this match.', flags: 64 });
  }

  await interaction.deferReply({ flags: 64 });

  let concluded = false;
  await withMatchLock(
    matchId,
    async () => {
      const freshMatch = getVSMatch(matchId);
      if (!freshMatch || freshMatch.status !== 'active') return;
      const freshParticipants = getVSParticipants(matchId);
      await concludeMatch(
        client,
        interaction.channel,
        freshMatch,
        freshParticipants,
        `Aborted by host (<@${freshMatch.creator_id}>)`
      );
      concluded = true;
    },
    { wait: true }
  );

  await interaction.editReply({
    content: concluded ? '✅ Match aborted successfully.' : '❌ This match has already concluded.'
  });
}

function buildLobbyEmbed(match, participants) {
  const pList = participants.map((p, idx) =>
    `> \`${idx + 1}.\` <@${p.discord_id}> · [\`${p.cf_handle}\`](https://codeforces.com/profile/${encodeURIComponent(p.cf_handle)})`
  ).join('\n');

  const divLabels = { div1: 'Div. 1', div2: 'Div. 2', div3: 'Div. 3', div4: 'Div. 4' };
  const divValue = match.division ? `\`${divLabels[match.division] ?? match.division}\`` : '`Standard`';
  const isClassic = match.mode === 'classic';
  const modeLabel = isClassic
    ? '🏁 **Classic Race** *(Time decay scoring)*'
    : '⚔️ **3x3 Battle Grid** *(1st AC: 100% pts · Later AC: 1/3 pts · 2,500 max pts)*';
  const effectiveCount = isClassic ? match.problems_count : 9;

  return new EmbedBuilder()
    .setColor(0x7C4DFF)
    .setAuthor({
      name: 'Codeforces Duel Arena',
      iconURL: 'https://cdn-icons-png.flaticon.com/512/3112/3112946.png'
    })
    .setTitle(`⚔️ Lockout Match Lobby · ID \`${match.id}\``)
    .setDescription([
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      `> 👑 **Host:** <@${match.creator_id}>`,
      `> 🎮 **Battle Format:** ${modeLabel}`,
      `> 🏅 **Target Rating:** **${match.rating}**`,
      `> 🏆 **Division:** ${divValue}`,
      `> ⏱️ **Time Limit:** **${match.duration_min} mins**`,
      `> 🔢 **Problems:** **${effectiveCount} challenges**`,
      match.tag ? `> 🏷️ **Tag:** \`${match.tag}\`` : null,
      `> 🆔 **Match Key:** \`${match.id}\``,
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      `👥 **Contenders Ready (${participants.length}):**`,
      pList || '> *Waiting for challengers to click Join below...*',
      '',
      '💡 *Host can click **Start Match** once at least 2 contenders have joined!*'
    ].filter(Boolean).join('\n'))
    .setThumbnail('https://cdn-icons-png.flaticon.com/512/3112/3112946.png')
    .setFooter({ text: 'BigOof Lockout Duel · Real-time Codeforces sync' })
    .setTimestamp();
}

module.exports = { handleVSButton, buildLobbyEmbed };
