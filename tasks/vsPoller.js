const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');
const {
  getActiveVSMatches, getVSParticipants, updateVSMatchStatus,
  updateVSParticipantScore, removeVSMatch, getVSMatch
} = require('../database/db');

const CF_BASE = 'https://codeforces.com/api';

/**
 * Starts the background loop that polls active versus matches.
 */
function startVSPoller(client) {
  console.log('[VS-Poller] Versus match poller started (polling every 20s).');
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
  }, 20000);
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

  // ── Case 2: Fetch and update submissions ──────────────────────
  let anyUpdates = false;

  for (const p of participants) {
    try {
      // CF API: fetch recent submissions
      const res = await axios.get(`${CF_BASE}/user.status?handle=${p.cf_handle}&from=1&count=50`, { timeout: 8000 });
      if (res.data.status !== 'OK') continue;

      const submissions = res.data.result;
      // Stagger API calls to prevent Codeforces rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));

      for (const sub of submissions) {
        // Only look at submissions made DURING the match
        if (sub.creationTimeSeconds < match.started_at || sub.creationTimeSeconds > match.ends_at) {
          continue;
        }

        const probKey = `${sub.problem.contestId}-${sub.problem.index}`;
        // Verify this problem is part of the match
        const matchProb = match.problems.find(p => `${p.contestId}-${p.index}` === probKey);
        if (!matchProb) continue;

        // Skip if already solved
        if (p.solves[probKey]) continue;

        // If not solved yet, analyze verdict
        if (sub.verdict === 'OK') {
          // Calculate points
          const elapsedSec = sub.creationTimeSeconds - match.started_at;
          const elapsedMin = elapsedSec / 60;
          
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

          // Check for First Blood
          let isFirstBlood = true;
          for (const other of participants) {
            if (other.solves[probKey]) {
              isFirstBlood = false;
              break;
            }
          }

          // Base points 1000, decay -2 points per minute, -50 points per wrong attempt, +100 first blood
          const basePoints = 1000;
          const decay = Math.floor(elapsedMin * (1000 / (match.duration_min * 3)));
          const penalty = wrongCount * 50;
          const bonus = isFirstBlood ? 100 : 0;
          const points = Math.max(100, basePoints - decay - penalty + bonus);

          // Save solve details
          p.solves[probKey] = {
            elapsedMin: Math.round(elapsedMin * 10) / 10,
            points,
            timestamp: sub.creationTimeSeconds,
            isFirstBlood
          };
          p.score += points;
          p.wrong_attempts[probKey] = wrongCount;

          anyUpdates = true;

          // Notify channel
          const fbLabel = isFirstBlood ? ' 🩸 **[FIRST BLOOD!]**' : '';
          await channel.send({
            content: `🎉 **${p.cf_handle}** (<@${p.discord_id}>) solved **[${matchProb.name}](${matchProb.url})** in **${Math.round(elapsedMin)}** mins! **+${points} pts**${fbLabel}`
          }).catch(() => {});

        } else if (sub.verdict !== 'TESTING') {
          // Track wrong attempts if we don't have them yet
          const currentWrong = p.wrong_attempts[probKey] ?? 0;
          // Count all wrong submissions up to now
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
    for (const p of participants) {
      updateVSParticipantScore(
        match.id,
        p.discord_id,
        p.score,
        JSON.stringify(p.solves),
        JSON.stringify(p.wrong_attempts)
      );
    }

    // Check if ALL participants solved ALL problems
    const totalProblems = match.problems.length;
    const allSolvedAll = participants.every(p => Object.keys(p.solves).length === totalProblems);
    if (allSolvedAll) {
      await concludeMatch(client, channel, match, participants, 'All participants solved all problems!');
      return;
    }

    // Refresh match message embed
    await refreshMatchEmbed(client, channel, match, participants);
  }
}

/**
 * Formats match Embed and Standings details.
 */
function buildVSMatchEmbed(match, participants) {
  const problemsListText = match.problems.map((p, idx) => {
    return `**Problem ${idx + 1}**: [${p.name}](${p.url}) (${p.rating}) ${p.tag ? `[${p.tag}]` : ''}`;
  }).join('\n');

  const sorted = [...participants].sort((a, b) => b.score - a.score);
  const standingsText = sorted.map((p, idx) => {
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

  const divLabels = { div1: 'Div. 1', div2: 'Div. 2', div3: 'Div. 3', div4: 'Div. 4' };
  const divStr = match.division ? ` · **Division**: \`${divLabels[match.division] ?? match.division}\`` : '';

  return new EmbedBuilder()
    .setColor(0x1F8DD6)
    .setTitle(`⚔️ Versus Match Active!`)
    .setDescription(`**Match ID**: \`${match.id}\`\n**Problem Rating**: \`${match.rating}\`${match.tag ? ` · **Tag**: \`${match.tag}\`` : ''}${divStr}\n**Time Remaining**: <t:${match.ends_at}:R>`)
    .addFields(
      { name: '📅 Problems', value: problemsListText, inline: false },
      { name: '📊 Live Standings', value: standingsText, inline: false }
    )
    .setFooter({ text: 'Solve problems on Codeforces. Standings update automatically.' })
    .setTimestamp();
}

/**
 * Refresh the match embed in Discord.
 */
async function refreshMatchEmbed(client, channel, match, participants) {
  const embed = buildVSMatchEmbed(match, participants);
  
  // Find the match message to edit (we can search the channel or store the message ID,
  // but to keep it simple and stateless, we find the last 50 messages and search for the embed with the Match ID)
  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!messages) return;

  const matchMsg = [...messages.values()].find(m => 
    m.author.id === client.user.id && 
    m.embeds.length > 0 && 
    m.embeds[0].description && 
    m.embeds[0].description.includes(`Match ID: \`${match.id}\``)
  );

  if (matchMsg) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`vs-refresh_${match.id}`)
        .setLabel('🔄 Refresh Standings')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`vs-abort_${match.id}`)
        .setLabel('🛑 Abort Match')
        .setStyle(ButtonStyle.Danger)
    );
    await matchMsg.edit({ embeds: [embed], components: [row] }).catch(() => {});
  }
}

/**
 * Conclude the match, write final results, and post a conclusion message.
 */
async function concludeMatch(client, channel, match, participants, reason) {
  updateVSMatchStatus(match.id, 'ended', match.started_at, match.ends_at);

  const sorted = [...participants].sort((a, b) => b.score - a.score);
  const winner = sorted[0];

  let winnersText = '';
  if (winner && winner.score > 0) {
    // Check for ties
    const tied = sorted.filter(p => p.score === winner.score);
    if (tied.length > 1) {
      winnersText = `🤝 **TIE MATCH!** Winners: ${tied.map(p => `<@${p.discord_id}>`).join(' & ')} with **${winner.score} pts**!`;
    } else {
      winnersText = `👑 **WINNER**: <@${winner.discord_id}> (${winner.cf_handle}) won the match with **${winner.score} pts**! 🎉`;
    }
  } else {
    winnersText = '🤷 **No winner** (no one solved any problems!).';
  }

  const finalStandingsText = sorted.map((p, idx) => {
    const medal = ['🥇', '🥈', '🥉'][idx] ?? `\`#${idx + 1}\``;
    const solveCount = Object.keys(p.solves).length;
    return `${medal} <@${p.discord_id}>: **${p.score} pts** (${solveCount}/${match.problems.length} solved)`;
  }).join('\n');

  const embed = new EmbedBuilder()
    .setColor(0xD4AF37) // Concluded Gold
    .setTitle(`🏆 Versus Match Concluded!`)
    .setDescription(`**Match ID**: \`${match.id}\`\n**Conclude Reason**: \`${reason}\``)
    .addFields(
      { name: '📊 Final Standings', value: finalStandingsText, inline: false },
      { name: '🏆 Conclusion', value: winnersText, inline: false }
    )
    .setTimestamp();

  // Send conclusion message
  await channel.send({ embeds: [embed] }).catch(() => {});

  // Update match message to remove buttons and show concluding embed
  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (messages) {
    const matchMsg = [...messages.values()].find(m => 
      m.author.id === client.user.id && 
      m.embeds.length > 0 && 
      m.embeds[0].description && 
      m.embeds[0].description.includes(`Match ID: \`${match.id}\``)
    );
    if (matchMsg) {
      await matchMsg.edit({ embeds: [embed], components: [] }).catch(() => {});
    }
  }
}

module.exports = { startVSPoller, processActiveMatch, buildVSMatchEmbed, concludeMatch, refreshMatchEmbed };
