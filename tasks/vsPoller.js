// tasks/vsPoller.js — Versus match poller, scoring engine, ASCII battle grid, & conclusion flow
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const {
  getActiveVSMatches,
  getVSParticipants,
  concludeVSMatchIfActive,
  updateVSParticipantScore,
  updateVSMatchLocks,
  removeVSMatch,
  getVSMatch
} = require('../database/db');
const { getCFStatus } = require('../utils/codeforces');
const { chunkLines } = require('../utils/envHelper');

const matchLockPromises = new Map();
let isPollTickRunning = false;

/**
 * Serializes operations on a given matchId.
 * When `wait = false`, skips if busy; when `wait = true`, queues behind the active run.
 */
async function withMatchLock(matchId, fn, { wait = false } = {}) {
  const existing = matchLockPromises.get(matchId);
  if (existing) {
    if (!wait) return false;
    await existing.catch(() => {});
    // Recurse cleanly in case another waiter ran ahead
    return withMatchLock(matchId, fn, { wait: true });
  }

  const runPromise = (async () => {
    await fn();
  })();
  matchLockPromises.set(matchId, runPromise);

  try {
    await runPromise;
    return true;
  } finally {
    if (matchLockPromises.get(matchId) === runPromise) {
      matchLockPromises.delete(matchId);
    }
  }
}

function startVSPoller(client) {
  console.log('[VS-Poller] Versus match poller started (polling every 15s).');
  setInterval(async () => {
    if (isPollTickRunning) return;
    isPollTickRunning = true;
    try {
      const activeMatches = getActiveVSMatches();
      for (const match of activeMatches) {
        await withMatchLock(match.id, () => processActiveMatch(client, match)).catch(err => {
          console.error(`[VS-Poller] Error processing match ${match.id}:`, err.message);
        });
      }
    } catch (err) {
      console.error('[VS-Poller] Error in poll loop:', err.message);
    } finally {
      isPollTickRunning = false;
    }
  }, 15000);
}

async function processActiveMatch(client, match) {
  // Re-fetch fresh state inside the lock
  const freshMatch = getVSMatch(match.id);
  if (!freshMatch || freshMatch.status !== 'active') return;
  match = freshMatch;

  const now = Math.floor(Date.now() / 1000);
  const channel = await client.channels.fetch(match.channel_id).catch(() => null);
  if (!channel) return;

  const participants = getVSParticipants(match.id);
  if (participants.length === 0) {
    removeVSMatch(match.id);
    return;
  }

  if (now >= match.ends_at) {
    await concludeMatch(client, channel, match, participants, 'Time limit reached!');
    return;
  }

  const isGrid = match.mode !== 'classic';
  if (!match.locks) match.locks = {};

  let anyUpdates = false;
  const pendingAnnouncements = [];

  for (const p of participants) {
    try {
      const submissions = await getCFStatus(p.cf_handle, 200);
      if (!submissions) continue;
      await new Promise(resolve => setTimeout(resolve, 350));

      // Codeforces returns newest-first; iterate chronologically so earliest AC & attempts win
      const chronological = [...submissions].reverse();
      for (const sub of chronological) {
        if (!sub.problem) continue;
        if (sub.creationTimeSeconds < match.started_at || sub.creationTimeSeconds > match.ends_at) continue;

        const probKey = `${sub.problem.contestId}-${sub.problem.index}`;
        const matchProb = match.problems.find(pr => `${pr.contestId}-${pr.index}` === probKey);
        if (!matchProb || p.solves[probKey]) continue;

        if (sub.verdict === 'OK') {
          const elapsedSec = sub.creationTimeSeconds - match.started_at;
          const elapsedMin = Math.round((elapsedSec / 60) * 10) / 10;

          let wrongCount = 0;
          for (const s of submissions) {
            if (
              s.problem &&
              s.problem.contestId === sub.problem.contestId &&
              s.problem.index === sub.problem.index &&
              s.creationTimeSeconds >= match.started_at &&
              s.creationTimeSeconds < sub.creationTimeSeconds &&
              s.verdict !== 'OK' &&
              s.verdict !== 'TESTING'
            ) {
              wrongCount++;
            }
          }

          if (isGrid) {
            const basePoints = matchProb.points || 100;
            const isFirst = !match.locks[probKey];
            const awardedPoints = isFirst ? basePoints : Math.round(basePoints / 3);

            p.solves[probKey] = { elapsedMin, points: awardedPoints, isFirst, timestamp: sub.creationTimeSeconds };
            p.score += awardedPoints;
            p.wrong_attempts[probKey] = wrongCount;

            if (isFirst) {
              match.locks[probKey] = {
                discord_id: p.discord_id,
                cf_handle: p.cf_handle,
                points: basePoints,
                elapsedMin,
                timestamp: sub.creationTimeSeconds,
                gridIndex: matchProb.gridIndex || 1,
                solversCount: 1
              };

              const droppedVal = Math.round(basePoints / 3);
              const rivalPings = participants.filter(pt => pt.discord_id !== p.discord_id).map(r => `<@${r.discord_id}>`).join(' ');
              pendingAnnouncements.push(
                `⚡ **FIRST BLOOD ON [P${matchProb.gridIndex || ''}]!** <@${p.discord_id}> (\`${p.cf_handle}\`) solved **[${matchProb.name}](${matchProb.url})** in **${Math.round(elapsedMin)}m** and claimed **+${basePoints} pts**!\n🟡 ${rivalPings || 'Rivals'}, Tile #${matchProb.gridIndex || ''} is now downgraded to **${droppedVal} pts** (1/3 value).`
              );
            } else {
              match.locks[probKey].solversCount = (match.locks[probKey].solversCount || 1) + 1;
              pendingAnnouncements.push(
                `🎉 <@${p.discord_id}> (\`${p.cf_handle}\`) also solved **[${matchProb.name}](${matchProb.url})** in **${Math.round(elapsedMin)}m** for **+${awardedPoints} pts** (1/3 value)!`
              );
            }

            anyUpdates = true;
          } else {
            const isFirstBlood = !participants.some(other => Boolean(other.solves[probKey]));
            const basePoints = 1000;
            const decay = Math.floor((elapsedMin / match.duration_min) * 400);
            const penalty = wrongCount * 50;
            const bonus = isFirstBlood ? 100 : 0;
            const points = Math.max(100, basePoints - decay - penalty + bonus);

            p.solves[probKey] = { elapsedMin, points, timestamp: sub.creationTimeSeconds, isFirstBlood };
            p.score += points;
            p.wrong_attempts[probKey] = wrongCount;
            anyUpdates = true;

            const fbLabel = isFirstBlood ? ' 🩸 **[FIRST BLOOD!]**' : '';
            pendingAnnouncements.push(
              `🎉 **${p.cf_handle}** (<@${p.discord_id}>) solved **[${matchProb.name}](${matchProb.url})** in **${Math.round(elapsedMin)}** mins! **+${points} pts**${fbLabel}`
            );
          }
        } else if (sub.verdict !== 'TESTING') {
          const currentWrong = p.wrong_attempts[probKey] ?? 0;
          let wrongCount = 0;
          for (const s of submissions) {
            if (
              s.problem &&
              s.problem.contestId === sub.problem.contestId &&
              s.problem.index === sub.problem.index &&
              s.creationTimeSeconds >= match.started_at &&
              s.creationTimeSeconds <= match.ends_at &&
              s.verdict !== 'OK' &&
              s.verdict !== 'TESTING'
            ) {
              wrongCount++;
            }
          }
          if (wrongCount > currentWrong) {
            p.wrong_attempts[probKey] = wrongCount;
            anyUpdates = true;
          }
        }
      }
    } catch (err) {
      console.error(`[VS-Poller] CF fetch error for ${p.cf_handle}:`, err.message);
    }
  }

  if (anyUpdates) {
    // Persist locks & scores atomically BEFORE dispatching channel messages
    if (isGrid) updateVSMatchLocks(match.id, match.locks);
    for (const p of participants) {
      updateVSParticipantScore(
        match.id,
        p.discord_id,
        p.score,
        JSON.stringify(p.solves),
        JSON.stringify(p.wrong_attempts)
      );
    }

    for (const msgText of pendingAnnouncements) {
      await channel.send({ content: msgText }).catch(() => {});
    }

    const totalProblems = match.problems.length;
    const allSolvedAll = participants.every(p => Object.keys(p.solves || {}).length === totalProblems);
    if (allSolvedAll) {
      await concludeMatch(client, channel, match, participants, `All contenders solved all ${totalProblems} problems!`);
      return;
    }

    if (isGrid) {
      const sorted = [...participants].sort((a, b) => b.score - a.score);
      const leader = sorted[0];

      if (sorted.length >= 2 && leader && leader.score > 0) {
        let canAnyoneCatchUp = false;
        for (let i = 1; i < sorted.length; i++) {
          const contender = sorted[i];
          let maxRemaining = 0;
          for (const pr of match.problems) {
            const k = `${pr.contestId}-${pr.index}`;
            if (!contender.solves[k]) {
              const basePts = pr.points || 100;
              maxRemaining += (match.locks && match.locks[k]) ? Math.round(basePts / 3) : basePts;
            }
          }
          if (contender.score + maxRemaining >= leader.score) {
            canAnyoneCatchUp = true;
            break;
          }
        }
        if (!canAnyoneCatchUp) {
          await concludeMatch(client, channel, match, participants, 'Decisive Victory! Leader secured an unbeatable point lead.');
          return;
        }
      }
    }

    await refreshMatchEmbed(client, channel, match, participants);
  }
}

/**
 * Generates a strictly fixed-width aligned ASCII table (no wide emojis inside code block cells).
 */
function renderGridAscii(match, participants = []) {
  const cells = [];
  for (let i = 0; i < 9; i++) {
    const prob = match.problems[i];
    const key = prob ? `${prob.contestId}-${prob.index}` : '';
    const lock = match.locks && match.locks[key];
    const pts = prob?.points || 100;

    const totalSolvers = participants.filter(pt => pt.solves && pt.solves[key]).length;
    if (totalSolvers >= participants.length && participants.length > 1) {
      cells.push('[DONE]');
    } else if (lock) {
      cells.push(`*${lock.cf_handle.slice(0, 5)}`);
    } else {
      cells.push(`${pts}pt`);
    }
  }

  return [
    '```',
    '┌────────┬────────┬────────┐',
    `│ ${cells[0].padEnd(6)} │ ${cells[1].padEnd(6)} │ ${cells[2].padEnd(6)} │`,
    '├────────┼────────┼────────┤',
    `│ ${cells[3].padEnd(6)} │ ${cells[4].padEnd(6)} │ ${cells[5].padEnd(6)} │`,
    '├────────┼────────┼────────┤',
    `│ ${cells[6].padEnd(6)} │ ${cells[7].padEnd(6)} │ ${cells[8].padEnd(6)} │`,
    '└────────┴────────┴────────┘',
    '```'
  ].join('\n');
}

function renderTugOfWarBar(score1, score2, totalBlocks = 14) {
  const total = score1 + score2;
  if (total === 0) return '`[══════════════]` (0 - 0)';
  const ratio1 = Math.min(totalBlocks, Math.max(0, Math.round((score1 / total) * totalBlocks)));
  const ratio2 = totalBlocks - ratio1;
  return `\`[${'█'.repeat(ratio1)}${'░'.repeat(ratio2)}]\``;
}

function formatGridProblemLine(p, idx, match, participants) {
  const key = `${p.contestId}-${p.index}`;
  const lock = match.locks && match.locks[key];
  const link = `[${p.contestId}${p.index} - ${p.name}](${p.url})`;
  const basePts = p.points || 100;
  const droppedPts = Math.round(basePts / 3);

  if (!lock) {
    return `> \`[${idx + 1}]\` 🔓 **${basePts} pts** · ${link} — Open (${p.rating || 'N/A'})`;
  }

  const totalSolvers = participants.filter(pt => pt.solves && pt.solves[key]).length;
  if (totalSolvers >= participants.length && participants.length > 1) {
    return `> \`[${idx + 1}]\` ✅ **${basePts} pts** · ${link} — Solved by All`;
  }

  return `> \`[${idx + 1}]\` ⚡ **${basePts} pts** · ${link} — 1st AC: <@${lock.discord_id}> (+${basePts}) · 🟡 Rival: **${droppedPts} pts**`;
}

function buildVSMatchEmbed(match, participants) {
  const isGrid = match.mode !== 'classic';
  const divLabels = { div1: 'Div. 1', div2: 'Div. 2', div3: 'Div. 3', div4: 'Div. 4' };
  const sorted = [...participants].sort((a, b) => b.score - a.score);

  if (isGrid && match.problems && match.problems.length >= 9) {
    const totalBoardPoints = match.problems.reduce((sum, pr) => sum + (pr.points || 100), 0);
    const firstBloodsTaken = Object.keys(match.locks || {}).length;

    const row1Lines = match.problems.slice(0, 3).map((p, idx) => formatGridProblemLine(p, idx, match, participants)).join('\n');
    const row2Lines = match.problems.slice(3, 6).map((p, idx) => formatGridProblemLine(p, idx + 3, match, participants)).join('\n');
    const row3Lines = match.problems.slice(6, 9).map((p, idx) => formatGridProblemLine(p, idx + 6, match, participants)).join('\n');

    const standingsLines = sorted.map((p, idx) => {
      const medal = ['🥇', '🥈', '🥉'][idx] ?? `\`#${idx + 1}\``;
      const mySolves = Object.keys(p.solves || {});
      const myFirstBloods = Object.values(p.solves || {}).filter(s => s.isFirst).length;
      const fbText = myFirstBloods > 0 ? ` · **${myFirstBloods}** ⚡ 1st AC` : '';
      return `${medal} <@${p.discord_id}> (\`${p.cf_handle}\`): **${p.score} pts** (${mySolves.length}/${match.problems.length}${fbText})`;
    });

    let duelBar = '';
    if (sorted.length === 2) {
      duelBar = `\n> ⚔️ **Lead Tug-of-War:** ${renderTugOfWarBar(sorted[0].score, sorted[1].score, 14)}`;
    }

    const embed = new EmbedBuilder()
      .setColor(0x7C4DFF)
      .setAuthor({
        name: 'Codeforces Duel Arena · Battle Grid',
        iconURL: 'https://cdn-icons-png.flaticon.com/512/3112/3112946.png'
      })
      .setTitle(`⚔️ 3x3 Grid Battle Active · ID \`${match.id}\``)
      .setDescription([
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        `> 🏅 **Target Rating:** **${match.rating}**`,
        `> ⏱️ **Time Left:** <t:${match.ends_at}:R> (ends <t:${match.ends_at}:t>)`,
        '> ⚡ **Scoring Rule:** 1st AC = **100% pts** · Later AC = **1/3 pts**',
        `> 🎯 **First Bloods:** **${firstBloodsTaken}/9** claimed (${totalBoardPoints} max pts)`,
        match.tag ? `> 🏷️ **Tag Filter:** \`${match.tag}\`` : null,
        match.division ? `> 🏆 **Division:** \`${divLabels[match.division] ?? match.division}\`` : null,
        `> 🆔 **Match ID:** \`${match.id}\`${duelBar}`,
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '**3x3 Grid State:**',
        renderGridAscii(match, participants)
      ].filter(Boolean).join('\n'))
      .addFields(
        { name: '📋 Row 1 · 100–200 Points', value: row1Lines.slice(0, 1024), inline: false },
        { name: '📋 Row 2 · 200–300 Points', value: row2Lines.slice(0, 1024), inline: false },
        { name: '📋 Row 3 · 400–500 Points', value: row3Lines.slice(0, 1024), inline: false }
      )
      .setFooter({ text: 'BigOof Grid Battle · 1st solve gets 100%, later gets 1/3 value!' })
      .setTimestamp();

    chunkLines(standingsLines, 1000).forEach((chunk, idx) => {
      embed.addFields({ name: idx === 0 ? '📊 Live Standings' : '📊 Standings (cont.)', value: chunk, inline: false });
    });
    return embed;
  }

  // Classic Race Mode
  const problemLines = match.problems.map((p, idx) =>
    `**Problem ${idx + 1}**: [${p.name}](${p.url}) (\`${p.rating}\`)`
  );

  const classicStandingsLines = sorted.map((p, idx) => {
    const medal = ['🥇', '🥈', '🥉'][idx] ?? `\`#${idx + 1}\``;
    const solvesList = match.problems.map(prob => {
      const key = `${prob.contestId}-${prob.index}`;
      const solved = p.solves[key];
      if (solved) return `✅ ${prob.index} (+${solved.points})`;
      const wrong = p.wrong_attempts[key] ?? 0;
      return `❌ ${prob.index}${wrong > 0 ? ` (-${wrong})` : ''}`;
    }).join('  ');
    return `${medal} <@${p.discord_id}> (${p.cf_handle}): **${p.score} pts**\n> ${solvesList}`;
  });

  const embed = new EmbedBuilder()
    .setColor(0x7C4DFF)
    .setAuthor({
      name: 'Codeforces Duel Arena · Classic Race',
      iconURL: 'https://cdn-icons-png.flaticon.com/512/3112/3112946.png'
    })
    .setTitle(`⚡ Versus Race Active · ID \`${match.id}\``)
    .setDescription([
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      `> 🏅 **Target Rating:** **${match.rating}**`,
      `> ⏱️ **Time Left:** <t:${match.ends_at}:R> (ends <t:${match.ends_at}:t>)`,
      match.tag ? `> 🏷️ **Tag Filter:** \`${match.tag}\`` : null,
      match.division ? `> 🏆 **Division:** \`${divLabels[match.division] ?? match.division}\`` : null,
      `> 🆔 **Match ID:** \`${match.id}\``,
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
    ].filter(Boolean).join('\n'))
    .setFooter({ text: 'BigOof Duel Tracker · Live sync every 15 seconds' })
    .setTimestamp();

  chunkLines(problemLines, 1000).forEach((chunk, idx) => {
    embed.addFields({ name: idx === 0 ? '📋 Contest Problem Set' : '📋 Problem Set (cont.)', value: chunk, inline: false });
  });
  chunkLines(classicStandingsLines, 1000).forEach((chunk, idx) => {
    embed.addFields({ name: idx === 0 ? '📊 Live Standings' : '📊 Standings (cont.)', value: chunk, inline: false });
  });

  return embed;
}

function buildVSMatchComponents(match, participants = []) {
  const rows = [];
  const isGrid = match.mode !== 'classic';

  if (isGrid && match.problems && match.problems.length >= 9) {
    for (let r = 0; r < 3; r++) {
      const row = new ActionRowBuilder();
      for (let c = 0; c < 3; c++) {
        const idx = r * 3 + c;
        const prob = match.problems[idx];
        if (!prob) continue;
        const key = `${prob.contestId}-${prob.index}`;
        const lock = match.locks && match.locks[key];
        const basePts = prob.points || 100;
        const droppedPts = Math.round(basePts / 3);
        const totalSolvers = participants.filter(pt => pt.solves && pt.solves[key]).length;

        let label = `[P${idx + 1}] ${basePts} pts`;
        if (totalSolvers >= participants.length && participants.length > 1) {
          label = `✅ P${idx + 1}: Done`;
        } else if (lock) {
          label = `🟡 [P${idx + 1}] ${droppedPts} pts`;
        }

        row.addComponents(
          new ButtonBuilder()
            .setLabel(label)
            .setStyle(ButtonStyle.Link)
            .setURL(prob.url || `https://codeforces.com/contest/${prob.contestId}/problem/${prob.index}`)
        );
      }
      if (row.components.length > 0) rows.push(row);
    }
  } else if (match.problems && match.problems.length > 0) {
    for (let start = 0; start < match.problems.length && rows.length < 4; start += 5) {
      const slice = match.problems.slice(start, start + 5);
      const row = new ActionRowBuilder();
      slice.forEach((prob, offset) => {
        row.addComponents(
          new ButtonBuilder()
            .setLabel(`P${start + offset + 1}: ${prob.contestId}${prob.index}`.slice(0, 80))
            .setStyle(ButtonStyle.Link)
            .setURL(prob.url || `https://codeforces.com/contest/${prob.contestId}/problem/${prob.index}`)
        );
      });
      rows.push(row);
    }
  }

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`vs-refresh_${match.id}`)
      .setLabel('🔄 Refresh Standings')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`vs-abort_${match.id}`)
      .setLabel('🛑 Abort Match')
      .setStyle(ButtonStyle.Danger)
  );
  rows.push(actionRow);

  return rows;
}

async function findMatchMessage(client, channel, matchId) {
  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!messages) return null;
  return [...messages.values()].find(m =>
    m.author.id === client.user.id &&
    m.embeds.length > 0 &&
    (m.embeds[0].description?.includes(matchId) || m.embeds[0].title?.includes(matchId))
  ) || null;
}

async function refreshMatchEmbed(client, channel, match, participants) {
  const embed = buildVSMatchEmbed(match, participants);
  const components = buildVSMatchComponents(match, participants);
  const matchMsg = await findMatchMessage(client, channel, match.id);
  if (matchMsg) {
    await matchMsg.edit({ embeds: [embed], components }).catch(() => {});
  }
}

async function concludeMatch(client, channel, match, participants, reason) {
  // Atomic status guard prevents duplicate conclusion messages from Abort + Poller overlap
  if (!concludeVSMatchIfActive(match.id, match.started_at, match.ends_at)) return;

  const sorted = [...participants].sort((a, b) => b.score - a.score);
  const winner = sorted[0];
  const isGrid = match.mode !== 'classic';

  let winnersText = '';
  if (winner && winner.score > 0) {
    const tied = sorted.filter(p => p.score === winner.score);
    if (tied.length > 1) {
      winnersText = `🤝 **TIE MATCH!** Co-winners: ${tied.map(p => `<@${p.discord_id}>`).join(' & ')} with **${winner.score} pts**!`;
    } else {
      winnersText = `👑 **WINNER**: <@${winner.discord_id}> (\`${winner.cf_handle}\`) won the ${isGrid ? 'grid battle' : 'race'} with **${winner.score} pts**! 🎉`;
    }
  } else {
    winnersText = '🤷 **No winner** (no one solved any problems!).';
  }

  const finalLines = sorted.map((p, idx) => {
    const medal = ['🥇', '🥈', '🥉'][idx] ?? `\`#${idx + 1}\``;
    const solveCount = Object.keys(p.solves || {}).length;
    if (isGrid) {
      const myFirstBloods = Object.values(p.solves || {}).filter(s => s.isFirst).length;
      const fbText = myFirstBloods > 0 ? ` · **${myFirstBloods}** ⚡ First Bloods` : '';
      return `${medal} <@${p.discord_id}> (\`${p.cf_handle}\`): **${p.score} pts** (${solveCount}/${match.problems.length} solved${fbText})`;
    }
    return `${medal} <@${p.discord_id}> (\`${p.cf_handle}\`): **${p.score} pts** (${solveCount}/${match.problems.length} solved)`;
  });

  const embed = new EmbedBuilder()
    .setColor(0xFFD700)
    .setAuthor({
      name: isGrid ? 'Codeforces Battle Grid · Match Over' : 'Codeforces Duel Arena · Match Over',
      iconURL: 'https://cdn-icons-png.flaticon.com/512/3112/3112946.png'
    })
    .setTitle(isGrid ? `🏆 Grid Battle Concluded · ID \`${match.id}\`` : `🏆 Versus Race Concluded · ID \`${match.id}\``)
    .setDescription([
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      `> 🏁 **Resolution:** \`${reason}\``,
      `> 🆔 **Match ID:** \`${match.id}\``,
      `> 🏆 **Final Verdict:** ${winnersText}`,
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
    ].join('\n'))
    .setFooter({ text: 'BigOof Duel Arena · GG to all participants!' })
    .setTimestamp();

  chunkLines(finalLines, 1000).forEach((chunk, idx) => {
    embed.addFields({ name: idx === 0 ? '📊 Final Standings' : '📊 Final Standings (cont.)', value: chunk, inline: false });
  });

  if (isGrid && match.problems && match.problems.length >= 9) {
    embed.addFields({
      name: '🗺️ Final Grid Board State',
      value: renderGridAscii(match, participants),
      inline: false
    });
  }

  if (channel) {
    await channel.send({ embeds: [embed] }).catch(() => {});
    const matchMsg = await findMatchMessage(client, channel, match.id);
    if (matchMsg) {
      await matchMsg.edit({ embeds: [embed], components: [] }).catch(() => {});
    }
  }
}

module.exports = {
  startVSPoller,
  withMatchLock,
  processActiveMatch,
  buildVSMatchEmbed,
  buildVSMatchComponents,
  concludeMatch,
  refreshMatchEmbed
};
