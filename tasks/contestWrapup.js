// tasks/contestWrapup.js — Daily 9:00 AM Contest Wrap-up & shared round analyzer
const cron = require('node-cron');
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const {
  getAllUsers,
  getConfig,
  isContestWrappedUp,
  markContestWrappedUp
} = require('../database/db');
const { cfGet, getCFStatus } = require('../utils/codeforces');
const { chunkLines } = require('../utils/envHelper');
const { getTimeZone, getLocalParts } = require('../utils/time');
const { getCalendarEmoji } = require('../utils/calendarEmoji');

/**
 * Resolves the writable wrapup/general target channel for a guild without falling back to unrelated channels.
 */
function getWrapupChannel(guild) {
  if (!guild) return null;
  const me = guild.members.me;
  const isWritable = (ch) => {
    if (!ch || !ch.isTextBased() || ch.isVoiceBased?.()) return false;
    if (!me) return true;
    const perms = ch.permissionsFor(me);
    return Boolean(
      perms?.has(PermissionFlagsBits.ViewChannel) &&
      perms?.has(PermissionFlagsBits.SendMessages) &&
      perms?.has(PermissionFlagsBits.EmbedLinks)
    );
  };

  const wrapupChannelId = getConfig('wrapup_channel_id', guild.id);
  if (wrapupChannelId) {
    const ch = guild.channels.cache.get(wrapupChannelId);
    if (isWritable(ch)) return ch;
  }

  const generalChannelId = getConfig('general_channel_id', guild.id);
  if (generalChannelId) {
    const ch = guild.channels.cache.get(generalChannelId);
    if (isWritable(ch)) return ch;
  }

  const namedGeneral = guild.channels.cache.find(c =>
    isWritable(c) &&
    ['general', 'general-chat', 'main', 'cp-chat', 'chat'].includes(c.name.toLowerCase())
  );
  if (namedGeneral) return namedGeneral;

  if (isWritable(guild.systemChannel)) return guild.systemChannel;
  return null;
}

async function fetchRoadblockVerdict(handle, contestId, problemIndex) {
  const statusList = await getCFStatus(handle, 40);
  if (!statusList) return 'Attempted';

  const subs = statusList.filter(s =>
    s.contestId === contestId &&
    s.problem &&
    s.problem.index === problemIndex
  );

  if (subs.length === 0) return 'Unattempted';

  const latest = subs[0];
  const testNum = (latest.passedTestCount || 0) + 1;

  switch (latest.verdict) {
    case 'WRONG_ANSWER': return `WA on test ${testNum}`;
    case 'TIME_LIMIT_EXCEEDED': return `TLE on test ${testNum}`;
    case 'MEMORY_LIMIT_EXCEEDED': return `MLE on test ${testNum}`;
    case 'RUNTIME_ERROR': return `RTE on test ${testNum}`;
    case 'COMPILATION_ERROR': return 'Compilation Error';
    case 'CHALLENGED': return 'Hacked in contest';
    case 'SKIPPED': return 'Skipped';
    default: return latest.verdict ? latest.verdict.replace(/_/g, ' ') : 'Failed';
  }
}

/**
 * Fetches contest standings filtered to the specified linked users (handles batched queries)
 * and extracts rank, solve list, and upsolve roadblock per member.
 */
async function analyzeContestForUsers(contestId, users) {
  if (!users || users.length === 0) return [];

  const rowByHandle = new Map();
  let contestProblems = null;

  const handles = [...new Set(users.map(u => u.cf_handle).filter(Boolean))];
  const BATCH_SIZE = 80;
  let needsFullFallback = false;

  const ingestRows = (rows) => {
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      const type = row.party?.participantType;
      if (type && type !== 'CONTESTANT' && type !== 'OUT_OF_COMPETITION') continue;

      for (const mem of (row.party?.members || [])) {
        const h = mem.handle?.toLowerCase();
        if (!h) continue;
        const prev = rowByHandle.get(h);
        if (!prev || (prev.party?.participantType !== 'CONTESTANT' && type === 'CONTESTANT')) {
          rowByHandle.set(h, row);
        }
      }
    }
  };

  for (let i = 0; i < handles.length; i += BATCH_SIZE) {
    const batch = handles.slice(i, i + BATCH_SIZE);
    const encodedHandles = batch.map(encodeURIComponent).join(';');
    try {
      const res = await cfGet(
        `/contest.standings?contestId=${encodeURIComponent(contestId)}&handles=${encodedHandles}&showUnofficial=true`,
        20000
      );
      if (res.data?.status === 'OK' && res.data.result) {
        if (!contestProblems && Array.isArray(res.data.result.problems)) {
          contestProblems = res.data.result.problems;
        }
        ingestRows(res.data.result.rows);
      } else {
        needsFullFallback = true;
        break;
      }
    } catch {
      needsFullFallback = true;
      break;
    }
  }

  // Fallback to full standings if a batched query failed due to a renamed/invalid handle
  if (needsFullFallback) {
    rowByHandle.clear();
    const res = await cfGet(`/contest.standings?contestId=${encodeURIComponent(contestId)}&showUnofficial=true`, 25000);
    if (res.data?.status === 'OK' && res.data.result) {
      if (Array.isArray(res.data.result.problems)) {
        contestProblems = res.data.result.problems;
      }
      ingestRows(res.data.result.rows);
    }
  }

  if (!contestProblems) return [];

  const results = [];
  for (const user of users) {
    const row = rowByHandle.get(user.cf_handle.toLowerCase());
    if (!row) continue;

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
      } else if (firstUnattemptedIdx === -1) {
        firstUnattemptedIdx = i;
      }
    }

    const allSolved = solvedIndices.length === contestProblems.length;
    let roadblock = null;
    let verdict = 'Unattempted';

    if (!allSolved) {
      const targetIdx = attemptedUnsolvedIdx !== -1 ? attemptedUnsolvedIdx : firstUnattemptedIdx;
      if (targetIdx !== -1) {
        roadblock = contestProblems[targetIdx];
        if (attemptedUnsolvedIdx !== -1) {
          verdict = await fetchRoadblockVerdict(user.cf_handle, contestId, roadblock.index);
          await new Promise(r => setTimeout(r, 400));
        }
      }
    }

    results.push({
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

  return results;
}

function buildContestWrapupEmbed(contest, participantResults, { calEmoji = null } = {}) {
  const sorted = [...participantResults].sort((a, b) => {
    if (b.solvedCount !== a.solvedCount) return b.solvedCount - a.solvedCount;
    return (a.rank || 999999) - (b.rank || 999999);
  });

  const participantLines = sorted.slice(0, 25).map((p, idx) => {
    const medal = ['🥇', '🥈', '🥉'][idx] ?? `\`#${idx + 1}\``;
    const solvedStr = p.solvedIndices.length > 0 ? ` (${p.solvedIndices.join(', ')})` : '';
    const safeHandle = encodeURIComponent(p.cf_handle);
    const header = `${medal} <@${p.discord_id}> ([\`${p.cf_handle}\`](https://codeforces.com/profile/${safeHandle})) · **${p.solvedCount} Solved**${solvedStr}`;

    if (p.allSolved) return `${header}\n> 🎉 **All Problems Solved!** 👑`;
    if (p.roadblock) {
      const prob = p.roadblock;
      const probUrl = `https://codeforces.com/contest/${contest.id}/problem/${prob.index}`;
      return `${header}\n> ➔ [${contest.id}${prob.index} - ${prob.name}](${probUrl}) (${p.verdict})`;
    }
    return header;
  });

  const roundDateLine = (contest.startTimeSeconds && calEmoji)
    ? `> ${calEmoji} **Contest Date:** <t:${contest.startTimeSeconds}:D>`
    : null;

  const embed = new EmbedBuilder()
    .setColor(0x1F8DD6)
    .setAuthor({
      name: 'Codeforces Contest Wrap-up · Morning Recap',
      iconURL: 'https://cdn-icons-png.flaticon.com/512/3112/3112946.png'
    })
    .setTitle(`🏆 ${contest.name} — Standings & Upsolve Radar`.slice(0, 256))
    .setDescription([
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      roundDateLine,
      '> 🌅 **Good morning!** Yesterday\'s round is finalized and system tests are done.',
      '> 🎯 **Upsolve Goal:** Conquer the problem that stopped your streak yesterday!',
      `> 🔗 **Contest Page:** [Open Round Standings & Submissions](https://codeforces.com/contest/${contest.id})`,
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
    ].filter(Boolean).join('\n'))
    .setFooter({ text: 'BigOof Upsolve Radar · Solve your roadblock today to grow your rating!' })
    .setTimestamp();

  const fieldChunks = chunkLines(
    participantLines.length > 0 ? participantLines : ['> *No server members participated in this round.*'],
    1000,
    '\n\n'
  );

  fieldChunks.forEach((chunk, idx) => {
    embed.addFields({
      name: idx === 0
        ? `📊 Server Contenders & Roadblocks (${participantResults.length})`
        : '📊 Server Contenders (cont.)',
      value: chunk,
      inline: false
    });
  });

  return embed;
}

async function processContestWrapup(client, forceContestId = null, targetGuild = null) {
  try {
    console.log('[Contest-Wrapup] Checking finished Codeforces contests...');
    const listRes = await cfGet('/contest.list?gym=false', 15000);
    if (listRes.data?.status !== 'OK') return;

    const finishedContests = listRes.data.result.filter(c => c.phase === 'FINISHED');
    if (finishedContests.length === 0) return;

    let targetContests = [];
    if (forceContestId) {
      const match = finishedContests.find(c => String(c.id) === String(forceContestId));
      if (match) targetContests.push(match);
    } else {
      const now = Math.floor(Date.now() / 1000);
      targetContests = finishedContests.filter(c => {
        const finishTime = (c.startTimeSeconds || 0) + (c.durationSeconds || 0);
        const ageSec = now - finishTime;
        return ageSec >= 4 * 3600 && ageSec <= 48 * 3600;
      });
    }

    if (targetContests.length === 0) {
      console.log('[Contest-Wrapup] No recent contests in wrap-up window.');
      return;
    }

    const allCfUsers = getAllUsers().filter(u => u.cf_handle);
    if (allCfUsers.length === 0) return;

    const guildsToProcess = targetGuild ? [targetGuild] : [...client.guilds.cache.values()];
    const guildRosterMap = new Map();
    for (const guild of guildsToProcess) {
      const members = await guild.members.fetch().catch(() => guild.members.cache);
      guildRosterMap.set(guild.id, members);
    }

    for (const contest of targetContests) {
      const pendingGuilds = guildsToProcess.filter(g => forceContestId || !isContestWrappedUp(contest.id, g.id));
      if (pendingGuilds.length === 0) continue;

      const candidateUsersMap = new Map();
      for (const guild of pendingGuilds) {
        const members = guildRosterMap.get(guild.id);
        for (const u of allCfUsers) {
          if (members.has(u.discord_id)) candidateUsersMap.set(u.discord_id, u);
        }
      }

      if (candidateUsersMap.size === 0) continue;

      let allResults = [];
      try {
        allResults = await analyzeContestForUsers(contest.id, [...candidateUsersMap.values()]);
      } catch (err) {
        console.warn(`[Contest-Wrapup] Standings lookup failed for contest ${contest.id}:`, err.message);
        continue;
      }

      const resultByDiscordId = new Map(allResults.map(r => [r.discord_id, r]));

      for (const guild of pendingGuilds) {
        const members = guildRosterMap.get(guild.id);
        const guildResults = allCfUsers
          .filter(u => members.has(u.discord_id) && resultByDiscordId.has(u.discord_id))
          .map(u => resultByDiscordId.get(u.discord_id));

        if (guildResults.length === 0) {
          markContestWrappedUp(contest.id, guild.id);
          continue;
        }

        const channel = getWrapupChannel(guild);
        if (!channel) {
          console.warn(`[Contest-Wrapup] No writable wrapup/general channel found in ${guild.name}.`);
          continue;
        }

        const calEmoji = contest.startTimeSeconds
          ? await getCalendarEmoji(client, contest.startTimeSeconds, getTimeZone())
          : null;
        const embed = buildContestWrapupEmbed(contest, guildResults, { calEmoji });
        try {
          await channel.send({ embeds: [embed] });
          markContestWrappedUp(contest.id, guild.id);
          console.log(`[Contest-Wrapup] Posted wrap-up for contest ${contest.id} in ${guild.name} -> #${channel.name}`);
        } catch (err) {
          console.error(`[Contest-Wrapup] Failed to post in ${guild.name}:`, err.message);
        }
      }
    }
  } catch (err) {
    console.error('[Contest-Wrapup] Unexpected error:', err.message);
  }
}

function startContestWrapup(client) {
  const TZ = getTimeZone();

  cron.schedule('0 9 * * *', async () => {
    console.log(`[Contest-Wrapup] 9:00 AM cron trigger (${TZ}).`);
    await processContestWrapup(client);
  }, { timezone: TZ, noOverlap: true });

  setTimeout(async () => {
    try {
      const { hour } = getLocalParts(new Date(), TZ);
      if (hour >= 9) {
        console.log(`[Contest-Wrapup] Startup check: Past 9:00 AM (${hour}:00 ${TZ}). Checking pending wrap-ups...`);
        await processContestWrapup(client);
      }
    } catch (err) {
      console.error('[Contest-Wrapup Startup Error]', err.message);
    }
  }, 12000);

  console.log(`[Contest-Wrapup] Daily 9:00 AM scheduler (${TZ}) started.`);
}

module.exports = {
  startContestWrapup,
  processContestWrapup,
  analyzeContestForUsers,
  buildContestWrapupEmbed,
  getWrapupChannel
};
