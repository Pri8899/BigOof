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
    // No participants, clean up
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

        if (isGrid) {
          // In Lockout Grid Mode: if tile is already locked, nobody else can score it
          if (match.locks && match.locks[probKey]) {
            continue;
          }
        } else {
          // Classic Mode: Skip if this specific participant already solved it
          if (p.solves[probKey]) continue;
        }

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
            // Lockout Grid Tile claim
            if (match.locks[probKey]) continue; // Double check race condition

            const tilePoints = matchProb.points || 100;
            match.locks[probKey] = {
              discord_id: p.discord_id,
              cf_handle: p.cf_handle,
              points: tilePoints,
              elapsedMin,
              timestamp: sub.creationTimeSeconds,
              gridIndex: matchProb.gridIndex || 1
            };

            p.solves[probKey] = {
              elapsedMin,
              points: tilePoints,
              timestamp: sub.creationTimeSeconds
            };
            p.score += tilePoints;
            p.wrong_attempts[probKey] = wrongCount;

            anyUpdates = true;

            // Announce Lockout in channel!
            await channel.send({
              content: `🔒 **LOCKOUT!** <@${p.discord_id}> (\`${p.cf_handle}\`) solved **[${matchProb.name}](${matchProb.url})** in **${Math.round(elapsedMin)}m** and captured **+${tilePoints} pts**!\n🚫 *Tile #${matchProb.gridIndex || ''} is now locked! Rivals can no longer score this problem.*`
            }).catch(() => {});

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
      const totalBoardPoints = match.problems.reduce((sum, pr) => sum + (pr.points || 100), 0);
      const lockedKeys = Object.keys(match.locks);
      const allLocked = lockedKeys.length === match.problems.length;

      const sorted = [...participants].sort((a, b) => b.score - a.score);
      const leader = sorted[0];
      const runnerUp = sorted[1] || { score: 0 };

      // Calculate remaining available points on unlocked tiles
      let remainingUnlockedPoints = 0;
      for (const pr of match.problems) {
        const k = `${pr.contestId}-${pr.index}`;
        if (!match.locks[k]) {
          remainingUnlockedPoints += (pr.points || 100);
        }
      }

      // 1. All 9 tiles locked
      if (allLocked) {
        await concludeMatch(client, channel, match, participants, 'All lockout tiles have been locked!');
        return;
      }

      // 2. Mathematical lock: Leader has more points than runner-up can possibly score
      if (leader && leader.score > (runnerUp.score + remainingUnlockedPoints)) {
        await concludeMatch(client, channel, match, participants, 'Decisive Lockout Victory! Leader secured an unbeatable point lead.');
        return;
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
 * Generates an aligned ASCII table representing the 3x3 Lockout Grid.
 */
function renderGridAscii(match) {
  const cells = [];
  for (let i = 0; i < 9; i++) {
    const prob = match.problems[i];
    const key = prob ? `${prob.contestId}-${prob.index}` : '';
    const lock = match.locks && match.locks[key];
    const pts = prob?.points || 100;
    if (lock) {
      const h = lock.cf_handle.slice(0, 5);
      cells.push(`🔒${h}`);
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
 * Formats match Embed and Standings details.
 */
function buildVSMatchEmbed(match, participants) {
  const isGrid = match.mode !== 'classic';
  const divLabels = { div1: 'Div. 1', div2: 'Div. 2', div3: 'Div. 3', div4: 'Div. 4' };
  const sorted = [...participants].sort((a, b) => b.score - a.score);

  if (isGrid && match.problems && match.problems.length >= 9) {
    const totalBoardPoints = match.problems.reduce((sum, pr) => sum + (pr.points || 100), 0);
    const lockedCount = Object.keys(match.locks || {}).length;

    // Build 9-problem list grouped by rows
    const row1Lines = match.problems.slice(0, 3).map((p, idx) => {
      const key = `${p.contestId}-${p.index}`;
      const lock = match.locks && match.locks[key];
      const link = `[${p.contestId}${p.index} - ${p.name}](${p.url})`;
      if (lock) {
        return `> \`[${idx + 1}]\` 🔒 **${p.points} pts** · ${link} — Locked by <@${lock.discord_id}> (${Math.round(lock.elapsedMin)}m)`;
      }
      return `> \`[${idx + 1}]\` 🔓 **${p.points} pts** · ${link} — Open (${p.rating || 'N/A'})`;
    }).join('\n');

    const row2Lines = match.problems.slice(3, 6).map((p, idx) => {
      const realIdx = idx + 3;
      const key = `${p.contestId}-${p.index}`;
      const lock = match.locks && match.locks[key];
      const link = `[${p.contestId}${p.index} - ${p.name}](${p.url})`;
      if (lock) {
        return `> \`[${realIdx + 1}]\` 🔒 **${p.points} pts** · ${link} — Locked by <@${lock.discord_id}> (${Math.round(lock.elapsedMin)}m)`;
      }
      return `> \`[${realIdx + 1}]\` 🔓 **${p.points} pts** · ${link} — Open (${p.rating || 'N/A'})`;
    }).join('\n');

    const row3Lines = match.problems.slice(6, 9).map((p, idx) => {
      const realIdx = idx + 6;
      const key = `${p.contestId}-${p.index}`;
      const lock = match.locks && match.locks[key];
      const link = `[${p.contestId}${p.index} - ${p.name}](${p.url})`;
      if (lock) {
        return `> \`[${realIdx + 1}]\` 🔒 **${p.points} pts** · ${link} — Locked by <@${lock.discord_id}> (${Math.round(lock.elapsedMin)}m)`;
      }
      return `> \`[${realIdx + 1}]\` 🔓 **${p.points} pts** · ${link} — Open (${p.rating || 'N/A'})`;
    }).join('\n');

    // Standings text
    const standingsText = sorted.map((p, idx) => {
      const medal = ['🥇', '🥈', '🥉'][idx] ?? `\`#${idx + 1}\``;
      const myLocks = Object.values(match.locks || {}).filter(l => l.discord_id === p.discord_id);
      const tilesSummary = myLocks.length > 0
        ? `(${myLocks.map(l => `P${l.gridIndex}`).join(', ')})`
        : '*(0 tiles)*';
      return `${medal} <@${p.discord_id}> (\`${p.cf_handle}\`): **${p.score} pts** · **${myLocks.length}** locked ${tilesSummary}`;
    }).join('\n');

    let duelBar = '';
    if (sorted.length === 2) {
      duelBar = `\n> ⚔️ **Lead Tug-of-War:** ${renderTugOfWarBar(sorted[0].score, sorted[1].score, 14)}`;
    }

    return new EmbedBuilder()
      .setColor(0x7C4DFF)
      .setAuthor({
        name: 'Codeforces Duel Arena · Lockout Grid',
        iconURL: 'https://cdn-icons-png.flaticon.com/512/3112/3112946.png'
      })
      .setTitle(`⚔️ 3x3 Lockout Battle Active · ID \`${match.id}\``)
      .setDescription([
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `> 🏅 **Target Rating:** **${match.rating}**`,
        `> ⏱️ **Time Left:** <t:${match.ends_at}:R> (ends <t:${match.ends_at}:t>)`,
        `> 🔒 **Locked Tiles:** **${lockedCount}/9** claimed (${totalBoardPoints} pts total)`,
        match.tag ? `> 🏷️ **Tag Filter:** \`${match.tag}\`` : null,
        match.division ? `> 🏆 **Division:** \`${divLabels[match.division] ?? match.division}\`` : null,
        `> 🆔 **Match ID:** \`${match.id}\`${duelBar}`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `**Lockout Grid Overview:**`,
        renderGridAscii(match)
      ].filter(Boolean).join('\n'))
      .addFields(
        { name: '📋 Row 1 · 100–200 Points', value: row1Lines, inline: false },
        { name: '📋 Row 2 · 200–300 Points', value: row2Lines, inline: false },
        { name: '📋 Row 3 · 400–500 Points', value: row3Lines, inline: false },
        { name: '📊 Live Standings', value: standingsText, inline: false }
      )
      .setFooter({ text: 'BigOof Lockout Battle · First to AC locks the problem tile!' })
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
 * In Lockout Grid mode: 3 rows of 3 clickable Link buttons + 1 row for actions.
 */
function buildVSMatchComponents(match) {
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
        const isLocked = match.locks && match.locks[key];
        const label = isLocked
          ? `🔒 P${idx + 1}: ${isLocked.cf_handle.slice(0, 8)} (${prob.points})`
          : `[P${idx + 1}] ${prob.points} pts`;

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
  const components = buildVSMatchComponents(match);

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
      winnersText = `👑 **WINNER**: <@${winner.discord_id}> (\`${winner.cf_handle}\`) won the lockout battle with **${winner.score} pts**! 🎉`;
    }
  } else {
    winnersText = '🤷 **No winner** (no one solved any problems!).';
  }

  const finalStandingsText = sorted.map((p, idx) => {
    const medal = ['🥇', '🥈', '🥉'][idx] ?? `\`#${idx + 1}\``;
    if (isGrid) {
      const myLocks = Object.values(match.locks || {}).filter(l => l.discord_id === p.discord_id);
      const tilesStr = myLocks.length > 0 ? `(${myLocks.map(l => `P${l.gridIndex}`).join(', ')})` : '';
      return `${medal} <@${p.discord_id}> (\`${p.cf_handle}\`): **${p.score} pts** · **${myLocks.length}** tiles locked ${tilesStr}`;
    } else {
      const solveCount = Object.keys(p.solves).length;
      return `${medal} <@${p.discord_id}>: **${p.score} pts** (${solveCount}/${match.problems.length} solved)`;
    }
  }).join('\n');

  const embed = new EmbedBuilder()
    .setColor(0xFFD700) // Championship Gold
    .setAuthor({
      name: isGrid ? 'Codeforces Lockout Grid · Match Over' : 'Codeforces Duel Arena · Match Over',
      iconURL: 'https://cdn-icons-png.flaticon.com/512/3112/3112946.png'
    })
    .setTitle(`🏆 Lockout Clash Concluded · ID \`${match.id}\``)
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
      name: '🗺️ Final Lockout Board State',
      value: renderGridAscii(match),
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
