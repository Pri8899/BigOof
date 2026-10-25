const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');
const {
  getActiveVSMatches, getVSParticipants, updateVSMatchStatus,
  updateVSParticipantScore, updateVSMatchLocks, removeVSMatch, getVSMatch
} = require('../database/db');

const CF_BASE = 'https://codeforces.com/api';

/**
 * Starts the background loop that polls active versus matches.
 */
function startVSPoller(client) {
  console.log('[VS-Poller] Versus match poller started (polling every 15s).');
  setInterval(async () => {
    try {
      const activeMatches = getActiveVSMatches();
      for (const match of activeMatches) {
        await processActiveMatch(client, match).catch(err => {
          console.error(`[VS-Poller] Error processing match ${match.id}:`, err.message);
        });
      }
    } catch (err) {
      console.error('[VS-Poller] Error in poll loop:', err.message);
    }
  }, 15000);
}

/**
 * Check if the match is concluded or needs submission updates.
 */
async function processActiveMatch(client, match) {
  const now = Math.floor(Date.now() / 1000);
  const channel = await client.channels.fetch(match.channel_id).catch(() => null);
  if (!channel) return;

  const participants = getVSParticipants(match.id);
  if (participants.length === 0) {
    removeVSMatch(match.id);
    return;
  }

  // ── Case 1: Match Time Expired ───────────────────────────────
  if (now >= match.ends_at) {
    await concludeMatch(client, channel, match, participants, 'Time limit reached!');
    return;
  }

  const isGrid = match.mode !== 'classic';
  if (!match.locks) match.locks = {};

  // ── Case 2: Fetch and update submissions ──────────────────────
  let anyUpdates = false;

  for (const p of participants) {
    try {
      // CF API: fetch recent submissions
      const res = await axios.get(`${CF_BASE}/user.status?handle=${p.cf_handle}&from=1&count=50`, { timeout: 8000 });
      if (res.data.status !== 'OK') continue;

      const submissions = res.data.result;
      // Stagger API calls to prevent Codeforces rate limiting
      await new Promise(resolve => setTimeout(resolve, 400));

      for (const sub of submissions) {
        // Only look at submissions made DURING the match
        if (sub.creationTimeSeconds < match.started_at || sub.creationTimeSeconds > match.ends_at) {
          continue;
        }

        const probKey = `${sub.problem.contestId}-${sub.problem.index}`;
        // Verify this problem is part of the match
        const matchProb = match.problems.find(pr => `${pr.contestId}-${pr.index}` === probKey);
        if (!matchProb) continue;

        // Skip if THIS participant already solved this problem
        if (p.solves[probKey]) continue;

        // If not solved yet, analyze verdict
        if (sub.verdict === 'OK') {
          const elapsedSec = sub.creationTimeSeconds - match.started_at;
          const elapsedMin = Math.round((elapsedSec / 60) * 10) / 10;

          // Count wrong attempts before this OK submission
          let wrongCount = 0;
          for (const s of submissions) {
            if (
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

            // Option B: 1st solver gets 100% full points. Subsequent solvers get 1/3 points!
            const awardedPoints = isFirst ? basePoints : Math.round(basePoints / 3);

            p.solves[probKey] = {
              elapsedMin,
              points: awardedPoints,
              isFirst,
              timestamp: sub.creationTimeSeconds
            };
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
            } else {
              match.locks[probKey].solversCount = (match.locks[probKey].solversCount || 1) + 1;
            }

            anyUpdates = true;

            // Announce solve in channel!
            if (isFirst) {
              const droppedVal = Math.round(basePoints / 3);
              const rivals = participants.filter(pt => pt.discord_id !== p.discord_id);
              const rivalPings = rivals.map(r => `<@${r.discord_id}>`).join(' ');

              await channel.send({
                content: `⚡ **FIRST BLOOD ON [P${matchProb.gridIndex || ''}]!** <@${p.discord_id}> (\`${p.cf_handle}\`) solved **[${matchProb.name}](${matchProb.url})** in **${Math.round(elapsedMin)}m** and claimed **+${basePoints} pts**!\n🟡 ${rivalPings || 'Rivals'}, Tile #${matchProb.gridIndex || ''} is now downgraded to **${droppedVal} pts** (1/3 value). You can still solve it to score partial points or switch to an open full-value tile!`
              }).catch(() => {});
            } else {
              await channel.send({
                content: `🎉 <@${p.discord_id}> (\`${p.cf_handle}\`) also solved **[${matchProb.name}](${matchProb.url})** in **${Math.round(elapsedMin)}m** and cashed in **+${awardedPoints} pts** (1/3 value)!`
              }).catch(() => {});
            }

          } else {
            // Classic mode scoring with decay and first blood
            let isFirstBlood = true;
            for (const other of participants) {
              if (other.solves[probKey]) {
                isFirstBlood = false;
                break;
              }
            }

            const basePoints = 1000;
            const decay = Math.floor((elapsedMin / match.duration_min) * 400);
            const penalty = wrongCount * 50;
            const bonus = isFirstBlood ? 100 : 0;
            const points = Math.max(100, basePoints - decay - penalty + bonus);

            p.solves[probKey] = {
              elapsedMin,
              points,
              timestamp: sub.creationTimeSeconds,
              isFirstBlood
            };
            p.score += points;
            p.wrong_attempts[probKey] = wrongCount;

            anyUpdates = true;

            const fbLabel = isFirstBlood ? ' 🩸 **[FIRST BLOOD!]**' : '';
            await channel.send({
              content: `🎉 **${p.cf_handle}** (<@${p.discord_id}>) solved **[${matchProb.name}](${matchProb.url})** in **${Math.round(elapsedMin)}** mins! **+${points} pts**${fbLabel}`
            }).catch(() => {});
          }

        } else if (sub.verdict !== 'TESTING') {
          // Track wrong attempts if we don't have them yet
          const currentWrong = p.wrong_attempts[probKey] ?? 0;
          let wrongCount = 0;
          for (const s of submissions) {
            if (
              s.problem.contestId === sub.problem.contestId &&
              s.problem.index === sub.problem.index &&
              s.creationTimeSeconds >= match.started_at &&
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

  // If there are updates, write to DB and refresh scoreboard embed
  if (anyUpdates) {
    if (isGrid) {
      updateVSMatchLocks(match.id, match.locks);
    }

    for (const p of participants) {
      updateVSParticipantScore(
        match.id,
        p.discord_id,
        p.score,
        JSON.stringify(p.solves),
        JSON.stringify(p.wrong_attempts)
      );
    }

    // ── Check Early Conclude Conditions ─────────────────────────
    if (isGrid) {
      const totalProblems = match.problems.length;
      const allSolvedAll = participants.every(p => Object.keys(p.solves || {}).length === totalProblems);
      if (allSolvedAll) {
        await concludeMatch(client, channel, match, participants, 'All contenders solved all 9 problems!');
        return;
      }

      // Mathematical lock: check if leader is uncatchable
      const sorted = [...participants].sort((a, b) => b.score - a.score);
      const leader = sorted[0];

      if (sorted.length >= 2 && leader && leader.score > 0) {
        let canAnyoneCatchUp = false;
        for (let i = 1; i < sorted.length; i++) {
          const contender = sorted[i];
          let maxRemainingForContender = 0;
          for (const pr of match.problems) {
            const k = `${pr.contestId}-${pr.index}`;
            if (!contender.solves[k]) {
              const basePts = pr.points || 100;
              // If already solved by someone, this contender can at most score 1/3
              if (match.locks && match.locks[k]) {
                maxRemainingForContender += Math.round(basePts / 3);
              } else {
                maxRemainingForContender += basePts;
              }
            }
          }
          if (contender.score + maxRemainingForContender >= leader.score) {
            canAnyoneCatchUp = true;
            break;
          }
        }

        if (!canAnyoneCatchUp) {
          await concludeMatch(client, channel, match, participants, 'Decisive Victory! Leader secured an unbeatable point lead.');
          return;
        }
      }

    } else {
      // Classic Mode: Check if all participants solved all problems
      const totalProblems = match.problems.length;
      const allSolvedAll = participants.every(p => Object.keys(p.solves).length === totalProblems);
      if (allSolvedAll) {
        await concludeMatch(client, channel, match, participants, 'All contenders solved all problems!');
        return;
      }
    }

    // Refresh match message embed and buttons
    await refreshMatchEmbed(client, channel, match, participants);
  }
}

/**
 * Generates an aligned ASCII table representing the 3x3 Battle Grid.
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
      cells.push(`✅Done`);
    } else if (lock) {
      const h = lock.cf_handle.slice(0, 4);
      cells.push(`⚡${h}`);
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

/**
 * Builds sleek ASCII ratio progress bar between 2 contenders
 */
function renderTugOfWarBar(score1, score2, totalBlocks = 14) {
  const total = score1 + score2;
  if (total === 0) return '`[══════════════]` (0 - 0)';
  const ratio1 = Math.min(totalBlocks, Math.max(0, Math.round((score1 / total) * totalBlocks)));
  const ratio2 = totalBlocks - ratio1;
  return `\`[${'█'.repeat(ratio1)}${'░'.repeat(ratio2)}]\``;
}

/**
 * Formats a problem row line for the grid embed.
 */
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
    return `> \`[${idx + 1}]\` ✅ **${basePts} pts** · ${link} — Solved by All Contenders`;
  }

  return `> \`[${idx + 1}]\` ⚡ **${basePts} pts** · ${link} — 1st AC: <@${lock.discord_id}> (+${basePts} pts) · 🟡 Rival Value: **${droppedPts} pts**`;
}

/**
 * Formats match Embed and Standings details.
 */
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

    // Standings text
    const standingsText = sorted.map((p, idx) => {
      const medal = ['🥇', '🥈', '🥉'][idx] ?? `\`#${idx + 1}\``;
      const mySolves = Object.keys(p.solves || {});
      const myFirstBloods = Object.values(p.solves || {}).filter(s => s.isFirst).length;
      const fbText = myFirstBloods > 0 ? ` · **${myFirstBloods}** ⚡ First Bloods` : '';
      return `${medal} <@${p.discord_id}> (\`${p.cf_handle}\`): **${p.score} pts** (${mySolves.length}/${match.problems.length} solved${fbText})`;
    }).join('\n');

    let duelBar = '';
    if (sorted.length === 2) {
      duelBar = `\n> ⚔️ **Lead Tug-of-War:** ${renderTugOfWarBar(sorted[0].score, sorted[1].score, 14)}`;
    }

    return new EmbedBuilder()
      .setColor(0x7C4DFF)
      .setAuthor({
        name: 'Codeforces Duel Arena · Battle Grid',
        iconURL: 'https://cdn-icons-png.flaticon.com/512/3112/3112946.png'
      })
      .setTitle(`⚔️ 3x3 Grid Battle Active · ID \`${match.id}\``)
      .setDescription([
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `> 🏅 **Target Rating:** **${match.rating}**`,
        `> ⏱️ **Time Left:** <t:${match.ends_at}:R> (ends <t:${match.ends_at}:t>)`,
        `> ⚡ **Scoring Rule:** 1st AC = **100% pts** · Later AC = **1/3 pts** (All tiles solvable)`,
        `> 🎯 **First Bloods:** **${firstBloodsTaken}/9** claimed (${totalBoardPoints} max pts)`,
        match.tag ? `> 🏷️ **Tag Filter:** \`${match.tag}\`` : null,
        match.division ? `> 🏆 **Division:** \`${divLabels[match.division] ?? match.division}\`` : null,
        `> 🆔 **Match ID:** \`${match.id}\`${duelBar}`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `**3x3 Grid State:**`,
        renderGridAscii(match, participants)
      ].filter(Boolean).join('\n'))
      .addFields(
        { name: '📋 Row 1 · 100–200 Points', value: row1Lines, inline: false },
        { name: '📋 Row 2 · 200–300 Points', value: row2Lines, inline: false },
        { name: '📋 Row 3 · 400–500 Points', value: row3Lines, inline: false },
        { name: '📊 Live Standings', value: standingsText, inline: false }
      )
      .setFooter({ text: 'BigOof Grid Battle · 1st solve gets 100%, later gets 1/3 value!' })
      .setTimestamp();
  }

  // Classic Mode Embed
  const problemsListText = match.problems.map((p, idx) => {
    return `**Problem ${idx + 1}**: [${p.name}](${p.url}) (${p.rating}) ${p.tag ? `[${p.tag}]` : ''}`;
  }).join('\n');

  const classicStandingsText = sorted.map((p, idx) => {
    const medal = ['🥇', '🥈', '🥉'][idx] ?? `\`#${idx + 1}\``;
    const solvesList = match.problems.map(prob => {
      const key = `${prob.contestId}-${prob.index}`;
      const solved = p.solves[key];
      if (solved) {
        return `✅ ${prob.index} (+${solved.points})`;
      } else {
        const wrong = p.wrong_attempts[key] ?? 0;
        return `❌ ${prob.index}${wrong > 0 ? ` (-${wrong})` : ''}`;
      }
    }).join('   ');
    return `${medal} <@${p.discord_id}> (${p.cf_handle}): **${p.score} pts**\n> ${solvesList}`;
  }).join('\n');

  return new EmbedBuilder()
    .setColor(0x7C4DFF)
    .setAuthor({
      name: 'Codeforces Duel Arena · Classic Race',
      iconURL: 'https://cdn-icons-png.flaticon.com/512/3112/3112946.png'
    })
    .setTitle(`⚡ Versus Clash Active · ID \`${match.id}\``)
    .setDescription([
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `> 🏅 **Target Rating:** **${match.rating}**`,
      `> ⏱️ **Time Left:** <t:${match.ends_at}:R> (ends <t:${match.ends_at}:t>)`,
      match.tag ? `> 🏷️ **Tag Filter:** \`${match.tag}\`` : null,
      match.division ? `> 🏆 **Division:** \`${divLabels[match.division] ?? match.division}\`` : null,
      `> 🆔 **Match ID:** \`${match.id}\``,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    ].filter(Boolean).join('\n'))
    .addFields(
      { name: '📋 Contest Problem Set', value: problemsListText, inline: false },
      { name: '📊 Live Standings', value: classicStandingsText, inline: false }
    )
    .setFooter({ text: 'BigOof Duel Tracker · Live sync every 15 seconds' })
    .setTimestamp();
}

/**
 * Builds interactive button rows for active matches.
 * Features 3 rows of 3 clickable Link buttons + 1 row for actions.
 */
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
  }

  // Control buttons row
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

/**
 * Refresh the match embed in Discord.
 */
async function refreshMatchEmbed(client, channel, match, participants) {
  const embed = buildVSMatchEmbed(match, participants);
  const components = buildVSMatchComponents(match, participants);

  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!messages) return;

  const matchMsg = [...messages.values()].find(m => 
    m.author.id === client.user.id && 
    m.embeds.length > 0 && 
    ((m.embeds[0].description && m.embeds[0].description.includes(match.id)) ||
     (m.embeds[0].title && m.embeds[0].title.includes(match.id)))
  );

  if (matchMsg) {
    await matchMsg.edit({ embeds: [embed], components }).catch(() => {});
  }
}

/**
 * Conclude the match, write final results, and post a conclusion message.
 */
async function concludeMatch(client, channel, match, participants, reason) {
  updateVSMatchStatus(match.id, 'concluded', match.started_at, match.ends_at);

  const sorted = [...participants].sort((a, b) => b.score - a.score);
  const winner = sorted[0];
  const isGrid = match.mode !== 'classic';

  let winnersText = '';
  if (winner && winner.score > 0) {
    const tied = sorted.filter(p => p.score === winner.score);
    if (tied.length > 1) {
      winnersText = `🤝 **TIE MATCH!** Co-winners: ${tied.map(p => `<@${p.discord_id}>`).join(' & ')} with **${winner.score} pts**!`;
    } else {
      winnersText = `👑 **WINNER**: <@${winner.discord_id}> (\`${winner.cf_handle}\`) won the grid battle with **${winner.score} pts**! 🎉`;
    }
  } else {
    winnersText = '🤷 **No winner** (no one solved any problems!).';
  }

  const finalStandingsText = sorted.map((p, idx) => {
    const medal = ['🥇', '🥈', '🥉'][idx] ?? `\`#${idx + 1}\``;
    const solveCount = Object.keys(p.solves || {}).length;
    if (isGrid) {
      const myFirstBloods = Object.values(p.solves || {}).filter(s => s.isFirst).length;
      const fbText = myFirstBloods > 0 ? ` · **${myFirstBloods}** ⚡ First Bloods` : '';
      return `${medal} <@${p.discord_id}> (\`${p.cf_handle}\`): **${p.score} pts** (${solveCount}/${match.problems.length} solved${fbText})`;
    } else {
      return `${medal} <@${p.discord_id}>: **${p.score} pts** (${solveCount}/${match.problems.length} solved)`;
    }
  }).join('\n');

  const embed = new EmbedBuilder()
    .setColor(0xFFD700) // Championship Gold
    .setAuthor({
      name: isGrid ? 'Codeforces Battle Grid · Match Over' : 'Codeforces Duel Arena · Match Over',
      iconURL: 'https://cdn-icons-png.flaticon.com/512/3112/3112946.png'
    })
    .setTitle(`🏆 Grid Battle Concluded · ID \`${match.id}\``)
    .setDescription([
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `> 🏁 **Resolution:** \`${reason}\``,
      `> 🆔 **Match ID:** \`${match.id}\``,
      `> 🏆 **Final Verdict:** ${winnersText}`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    ].join('\n'))
    .addFields(
      { name: '📊 Final Standings', value: finalStandingsText, inline: false }
    )
    .setFooter({ text: 'BigOof Duel Arena · GG to all participants!' })
    .setTimestamp();

  if (isGrid && match.problems && match.problems.length >= 9) {
    embed.addFields({
      name: '🗺️ Final Grid Board State',
      value: renderGridAscii(match, participants),
      inline: false
    });
  }

  // Send conclusion message
  await channel.send({ embeds: [embed] }).catch(() => {});

  // Update original match message to remove components and show concluding embed
  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (messages) {
    const matchMsg = [...messages.values()].find(m => 
      m.author.id === client.user.id && 
      m.embeds.length > 0 && 
      ((m.embeds[0].description && m.embeds[0].description.includes(match.id)) ||
       (m.embeds[0].title && m.embeds[0].title.includes(match.id)))
    );
    if (matchMsg) {
      await matchMsg.edit({ embeds: [embed], components: [] }).catch(() => {});
    }
  }
}

module.exports = {
  startVSPoller,
  processActiveMatch,
  buildVSMatchEmbed,
  buildVSMatchComponents,
  concludeMatch,
  refreshMatchEmbed
};
