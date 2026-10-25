// tasks/contestWrapup.js — Daily 9:00 AM Contest Wrap-up & Upsolve Radar
const cron = require('node-cron');
const axios = require('axios');
const { EmbedBuilder } = require('discord.js');
const {
  getAllUsers, getConfig, isContestWrappedUp, markContestWrappedUp
} = require('../database/db');

const TIMEZONE = process.env.TIMEZONE || 'UTC';
const CF_BASE = 'https://codeforces.com/api';
const CF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*'
};

/**
 * Resolves the target channel for contest wrap-up posts in a guild.
 * Defaults to general channel as requested.
 */
function getWrapupChannel(guild) {
  // 1. Explicit admin configured wrapup channel
  const wrapupChannelId = getConfig('wrapup_channel_id', guild.id);
  if (wrapupChannelId) {
    const ch = guild.channels.cache.get(wrapupChannelId);
    if (ch && ch.isTextBased()) return ch;
  }

  // 2. Default to general channel configured in guild_config
  const generalChannelId = getConfig('general_channel_id', guild.id);
  if (generalChannelId) {
    const ch = guild.channels.cache.get(generalChannelId);
    if (ch && ch.isTextBased()) return ch;
  }

  // 3. Fallback: Search guild text channels for general / cp-chat
  const autoGeneral = guild.channels.cache.find(c => 
    c.isTextBased() && 
    (c.name.toLowerCase() === 'general' ||
     c.name.toLowerCase() === 'general-chat' ||
     c.name.toLowerCase() === 'main' ||
     c.name.toLowerCase() === 'cp-chat' ||
     c.name.toLowerCase() === 'chat')
  );
  if (autoGeneral) return autoGeneral;

  // 4. System channel
  if (guild.systemChannel && guild.systemChannel.isTextBased()) {
    return guild.systemChannel;
  }

  // 5. First accessible text channel
  return guild.channels.cache.find(c => c.isTextBased() && c.permissionsFor(guild.members.me)?.has('SendMessages')) || null;
}

/**
 * Fetch detailed submission verdict for a user on a specific contest problem.
 */
async function fetchRoadblockVerdict(handle, contestId, problemIndex) {
  try {
    const res = await axios.get(
      `${CF_BASE}/user.status?handle=${handle}&from=1&count=40`,
      { timeout: 7000, headers: CF_HEADERS }
    );
    if (res.data.status !== 'OK') return 'Unattempted';

    const subs = res.data.result.filter(s => 
      s.contestId === contestId && 
      s.problem && 
      s.problem.index === problemIndex
    );

    if (subs.length === 0) return 'Unattempted';

    // Latest submission first
    const latest = subs[0];
    const testNum = (latest.passedTestCount || 0) + 1;

    switch (latest.verdict) {
      case 'WRONG_ANSWER':
        return `WA on test ${testNum}`;
      case 'TIME_LIMIT_EXCEEDED':
        return `TLE on test ${testNum}`;
      case 'MEMORY_LIMIT_EXCEEDED':
        return `MLE on test ${testNum}`;
      case 'RUNTIME_ERROR':
        return `RTE on test ${testNum}`;
      case 'COMPILATION_ERROR':
        return 'Compilation Error';
      case 'CHALLENGED':
        return 'Hacked in contest';
      case 'SKIPPED':
        return 'Skipped';
      default:
        return latest.verdict ? latest.verdict.replace(/_/g, ' ') : 'Failed';
    }
  } catch (err) {
    return 'Attempted';
  }
}

/**
 * Builds the high-impact Contest Wrap-up & Upsolve Radar Embed.
 */
function buildContestWrapupEmbed(contest, participantResults) {
  const sorted = [...participantResults].sort((a, b) => {
    if (b.solvedCount !== a.solvedCount) return b.solvedCount - a.solvedCount;
    return (a.rank || 999999) - (b.rank || 999999);
  });

  const participantLines = sorted.map((p, idx) => {
    const medal = ['🥇', '🥈', '🥉'][idx] ?? `\`#${idx + 1}\``;
    const solvedStr = p.solvedIndices.length > 0 ? ` (${p.solvedIndices.join(', ')})` : '';
    const header = `${medal} <@${p.discord_id}> (\`${p.cf_handle}\`) · **${p.solvedCount} Solved**${solvedStr}`;

    if (p.allSolved) {
      return `${header}\n> 🎉 **All Problems Solved!** 👑`;
    }

    if (p.roadblock) {
      const prob = p.roadblock;
      const probUrl = `https://codeforces.com/contest/${contest.id}/problem/${prob.index}`;
      const probLabel = `${contest.id}${prob.index} - ${prob.name}`;
      return `${header}\n> ➔ [${probLabel}](${probUrl}) (${p.verdict})`;
    }

    return header;
  });

  return new EmbedBuilder()
    .setColor(0x1F8DD6) // Codeforces Royal Blue
    .setAuthor({
      name: 'Codeforces Contest Wrap-up · Morning Recap',
      iconURL: 'https://cdn-icons-png.flaticon.com/512/3112/3112946.png'
    })
    .setTitle(`🏆 ${contest.name} — Standings & Upsolve Radar`)
    .setDescription([
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `> 🌅 **Good morning!** Yesterday's round is finalized and system tests are done.`,
      `> 🎯 **Upsolve Goal:** Conquer the problem that stopped your streak yesterday!`,
      `> 🔗 **Contest Page:** [Open Round Standings & Submissions](https://codeforces.com/contest/${contest.id})`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    ].join('\n'))
    .addFields({
      name: `📊 Server Contenders & Roadblocks (${participantResults.length})`,
      value: participantLines.slice(0, 20).join('\n\n') || '> *No server members participated in this round.*',
      inline: false
    })
    .setFooter({ text: 'BigOof Upsolve Radar · Solve your roadblock today to grow your rating!' })
    .setTimestamp();
}

/**
 * Processes and posts the contest wrap-up for all guilds or a specific guild.
 */
async function processContestWrapup(client, forceContestId = null, targetGuild = null) {
  try {
    console.log('[Contest-Wrapup] Checking for finished Codeforces contests to wrap up...');

    // 1. Fetch finished contests from Codeforces
    const listRes = await axios.get(`${CF_BASE}/contest.list?gym=false`, { timeout: 15000, headers: CF_HEADERS });
    if (listRes.data.status !== 'OK') return;

    const finishedContests = listRes.data.result.filter(c => c.phase === 'FINISHED');
    if (finishedContests.length === 0) return;

    let targetContests = [];
    if (forceContestId) {
      const match = finishedContests.find(c => String(c.id) === String(forceContestId));
      if (match) targetContests.push(match);
    } else {
      // Find contests that finished between 6 hours and 48 hours ago (yesterday's contests)
      const now = Math.floor(Date.now() / 1000);
      targetContests = finishedContests.filter(c => {
        const finishTime = (c.startTimeSeconds || 0) + (c.durationSeconds || 0);
        const ageSec = now - finishTime;
        return ageSec >= (4 * 3600) && ageSec <= (48 * 3600);
      });
    }

    if (targetContests.length === 0) {
      console.log('[Contest-Wrapup] No recent contests in wrap-up window.');
      return;
    }

    const guildsToProcess = targetGuild ? [targetGuild] : [...client.guilds.cache.values()];

    for (const contest of targetContests) {
      console.log(`[Contest-Wrapup] Processing contest ${contest.id} (${contest.name})...`);

      // 2. Fetch full standings for this contest (single anonymous API call)
      let standingsData = null;
      try {
        const res = await axios.get(`${CF_BASE}/contest.standings?contestId=${contest.id}`, { timeout: 20000, headers: CF_HEADERS });
        if (res.data.status === 'OK' && res.data.result) {
          standingsData = res.data.result;
        }
      } catch (err) {
        console.warn(`[Contest-Wrapup] Failed to fetch standings for contest ${contest.id}:`, err.message);
        continue;
      }

      if (!standingsData || !standingsData.problems) continue;
      const contestProblems = standingsData.problems;

      // Map rows by lowercase handle
      const rowByHandle = new Map();
      if (Array.isArray(standingsData.rows)) {
        for (const row of standingsData.rows) {
          if (row.party && Array.isArray(row.party.members) && row.party.members.length > 0) {
            const h = row.party.members[0].handle.toLowerCase();
            rowByHandle.set(h, row);
          }
        }
      }

      for (const guild of guildsToProcess) {
        // Check if already posted for this guild
        if (!forceContestId && isContestWrappedUp(contest.id, guild.id)) {
          continue;
        }

        // Get all linked users in this guild
        const users = getAllUsers().filter(u => u.cf_handle);
        const memberResults = [];

        for (const user of users) {
          // Check if user is a member of this guild
          const member = await guild.members.fetch(user.discord_id).catch(() => null);
          if (!member) continue;

          const h = user.cf_handle.toLowerCase();
          const row = rowByHandle.get(h);
          if (!row) continue; // Did not participate in this round

          const problemResults = row.problemResults || [];
          const solvedIndices = [];
          let attemptedUnsolvedIdx = -1;
          let firstUnattemptedIdx = -1;

          for (let i = 0; i < contestProblems.length; i++) {
            const pr = problemResults[i];
            const prob = contestProblems[i];
            if (pr && pr.points > 0) {
              solvedIndices.push(prob.index);
            } else if (pr && pr.rejectedAttemptCount > 0) {
              if (attemptedUnsolvedIdx === -1) attemptedUnsolvedIdx = i;
            } else {
              if (firstUnattemptedIdx === -1) firstUnattemptedIdx = i;
            }
          }

          const allSolved = solvedIndices.length === contestProblems.length;
          let roadblock = null;
          let verdict = 'Unattempted';

          if (!allSolved) {
            // Prioritize problem they tried and choked on, otherwise first unattempted
            const targetIdx = attemptedUnsolvedIdx !== -1 ? attemptedUnsolvedIdx : firstUnattemptedIdx;
            if (targetIdx !== -1) {
              roadblock = contestProblems[targetIdx];
              if (attemptedUnsolvedIdx !== -1) {
                // Fetch exact submission verdict
                verdict = await fetchRoadblockVerdict(user.cf_handle, contest.id, roadblock.index);
                await new Promise(r => setTimeout(r, 400)); // Rate limit buffer
              } else {
                verdict = 'Unattempted';
              }
            }
          }

          memberResults.push({
            discord_id: user.discord_id,
            cf_handle: user.cf_handle,
            rank: row.rank || 0,
            solvedCount: solvedIndices.length,
            solvedIndices,
            allSolved,
            roadblock,
            verdict
          });
        }

        // If no members in this guild played, mark as processed and skip
        if (memberResults.length === 0) {
          markContestWrappedUp(contest.id, guild.id);
          continue;
        }

        // Resolve target channel
        const channel = getWrapupChannel(guild);
        if (!channel) {
          console.warn(`[Contest-Wrapup] No suitable channel found in guild ${guild.name} (${guild.id}).`);
          continue;
        }

        const embed = buildContestWrapupEmbed(contest, memberResults);
        await channel.send({ embeds: [embed] }).catch(err => {
          console.error(`[Contest-Wrapup] Failed to post in ${guild.name}:`, err.message);
        });

        markContestWrappedUp(contest.id, guild.id);
        console.log(`[Contest-Wrapup] ✅ Posted wrap-up for contest ${contest.id} in ${guild.name} -> #${channel.name}`);
      }
    }
  } catch (err) {
    console.error('[Contest-Wrapup] Unexpected error in wrap-up task:', err.message);
  }
}

/**
 * Initializes the Contest Wrap-up cron scheduler and boot catch-up.
 */
function startContestWrapup(client) {
  // Scheduled every morning at 9:00 AM in configured TIMEZONE
  cron.schedule('0 9 * * *', async () => {
    console.log(`[Contest-Wrapup] ⏰ 9:00 AM cron trigger (${TIMEZONE}). Running contest wrap-up...`);
    await processContestWrapup(client);
  }, { timezone: TIMEZONE });

  // Startup catch-up check after 12 seconds
  setTimeout(async () => {
    try {
      const now = new Date();
      const formatterHour = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, hour: 'numeric', hour12: false });
      const currentHour = parseInt(formatterHour.format(now), 10);

      // If already past 9:00 AM today, check if yesterday's contest needs to be wrapped up
      if (currentHour >= 9) {
        console.log(`[Contest-Wrapup] Startup check: Past 9:00 AM (${currentHour}:00 ${TIMEZONE}). Checking for pending contest wrap-ups...`);
        await processContestWrapup(client);
      }
    } catch (err) {
      console.error('[Contest-Wrapup Startup Error]', err.message);
    }
  }, 12000);

  console.log(`[Contest-Wrapup] Daily 9:00 AM scheduler (${TIMEZONE}) started.`);
}

module.exports = {
  startContestWrapup,
  processContestWrapup,
  buildContestWrapupEmbed,
  getWrapupChannel
};
