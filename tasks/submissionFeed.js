// tasks/submissionFeed.js — Live accepted submission feed across CF, AtCoder, and Toph
const axios = require('axios');
const {
  getAllUsers,
  getRatings,
  upsertRating,
  upsertStreak,
  getLastSubmission,
  setLastSubmission,
  getCachedContestName,
  cacheContestName,
  db
} = require('../database/db');
const { cfGet, getCFStatus, getCFUser } = require('../utils/codeforces');
const { axiosGetWithRetry, KENKOOOO_HEADERS, getACUser, getACContestName, calculateACStreak } = require('../utils/atcoder');
const { fetchTophSubmissions, getTophUser, calculateTophStreak } = require('../utils/toph');
const { buildSubmissionEmbed } = require('../utils/embeds');
const { resolveChannelChain } = require('../utils/envHelper');
const { getTimeZone, getLocalParts } = require('../utils/time');

let contestListCache = null;
let lastContestListFetchTime = 0;

function extractACIndex(problemId) {
  const parts = String(problemId || '').split('_');
  return parts[parts.length - 1].toUpperCase();
}

const acProblemTitleCache = new Map();
async function getACProblemTitle(problemId, contestId) {
  if (acProblemTitleCache.has(problemId)) return acProblemTitleCache.get(problemId);
  try {
    const url = `https://atcoder.jp/contests/${encodeURIComponent(contestId)}/tasks/${encodeURIComponent(problemId)}`;
    const res = await axios.get(url, {
      timeout: 6000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BigOof-Bot/1.0)' },
      maxContentLength: 100000
    });
    const m = String(res.data).match(/<title>([^<]+)<\/title>/i);
    if (m) {
      const title = m[1].replace(/\s*[—–-]\s*AtCoder.*/i, '').replace(/^\w+\s*-\s*/, '').trim();
      acProblemTitleCache.set(problemId, title);
      return title;
    }
  } catch (_) {}
  return null;
}

async function getOrFetchContestName(contestId) {
  if (!contestId) return null;
  const cached = getCachedContestName(contestId);
  if (cached) return cached;

  const now = Date.now();
  if (!contestListCache || (now - lastContestListFetchTime > 3600000)) {
    try {
      const res = await cfGet('/contest.list?gym=false', 12000);
      if (res.data?.status === 'OK') {
        contestListCache = res.data.result;
        lastContestListFetchTime = now;
      }
    } catch (err) {
      console.error('[SubmissionFeed] Failed fetching contest list:', err.message);
    }
  }

  if (contestListCache) {
    const contest = contestListCache.find(c => c.id === Number(contestId));
    if (contest) {
      cacheContestName(contestId, contest.name);
      return contest.name;
    }
  }

  if (Number(contestId) >= 100000) {
    try {
      const res = await cfGet(`/contest.standings?contestId=${encodeURIComponent(contestId)}&from=1&count=1&showUnofficial=true`, 8000, 1);
      if (res.data?.status === 'OK' && res.data.result?.contest) {
        const name = res.data.result.contest.name;
        cacheContestName(contestId, name);
        return name;
      }
    } catch (_) {}
    return null;
  }

  try {
    const res = await cfGet(`/contest.ratingChanges?contestId=${encodeURIComponent(contestId)}`, 5000, 1);
    if (res.data?.status === 'OK' && res.data.result?.length > 0) {
      const name = res.data.result[0].contestName;
      cacheContestName(contestId, name);
      return name;
    }
  } catch (_) {}

  return null;
}

async function fetchCFSubmissions(user) {
  if (!user.cf_handle) return { newAc: [], highestId: null };
  try {
    const subs = await getCFStatus(user.cf_handle, 50);
    if (!subs) return { newAc: [], highestId: null };

    const lastId = getLastSubmission(user.discord_id, 'cf');
    let highestId = lastId || 0;

    const submissions = [...subs].sort((a, b) => a.id - b.id);
    const newAc = [];
    const minTime = Math.floor(Date.now() / 1000) - 86400;

    for (const sub of submissions) {
      if (sub.creationTimeSeconds < minTime) continue;
      if (sub.verdict === 'TESTING' || !sub.verdict) break;

      highestId = Math.max(highestId, sub.id);
      if (lastId && sub.id <= lastId) continue;

      if (sub.verdict === 'OK' && sub.problem) {
        const dedupKey = `cf_prob_${user.discord_id}_${sub.problem.contestId}_${sub.problem.index}`;
        const alreadySeen = db.prepare('SELECT 1 FROM processed_submissions WHERE id = ?').get(dedupKey);
        if (alreadySeen) continue;

        const isGym = Number(sub.problem.contestId) >= 100000;
        const contestName = (await getOrFetchContestName(sub.problem.contestId))
          || (isGym ? `Codeforces Gym #${sub.problem.contestId}` : `Codeforces Round #${sub.problem.contestId}`);
        const contestUrl = isGym
          ? `https://codeforces.com/gym/${sub.problem.contestId}`
          : `https://codeforces.com/contest/${sub.problem.contestId}`;
        const problemUrl = isGym
          ? `https://codeforces.com/gym/${sub.problem.contestId}/problem/${sub.problem.index}`
          : `https://codeforces.com/problemset/problem/${sub.problem.contestId}/${sub.problem.index}`;

        newAc.push({
          name: sub.problem.name,
          index: sub.problem.index,
          url: problemUrl,
          rating: sub.problem.rating,
          tags: sub.problem.tags,
          timeSec: sub.timeConsumedMillis !== undefined ? (sub.timeConsumedMillis / 1000).toFixed(2) : undefined,
          memoryMb: sub.memoryConsumedBytes !== undefined ? (sub.memoryConsumedBytes / 1048576).toFixed(1) : undefined,
          contestId: sub.problem.contestId,
          contestName,
          contestUrl,
          id: sub.id,
          timestamp: sub.creationTimeSeconds,
          dedupKey
        });
      }
    }

    return { newAc, highestId: highestId > (lastId || 0) ? highestId : null };
  } catch (err) {
    console.error(`[SubmissionFeed] CF fetch error for ${user.cf_handle}:`, err.message);
    return { newAc: [], highestId: null };
  }
}

async function fetchACSubmissions(user) {
  if (!user.ac_handle) return { newAc: [], highestTime: null };
  try {
    const lastTime = getLastSubmission(user.discord_id, 'ac');
    const now = Math.floor(Date.now() / 1000);
    const queryTime = lastTime === null ? now - 10800 : lastTime;

    const res = await axiosGetWithRetry(
      `https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions?user=${encodeURIComponent(user.ac_handle)}&from_second=${queryTime + 1}`,
      { timeout: 15000, headers: KENKOOOO_HEADERS }
    );

    if (!Array.isArray(res.data) || res.data.length === 0) {
      return { newAc: [], highestTime: lastTime === null ? queryTime : null };
    }

    const submissions = [...res.data].sort((a, b) => a.epoch_second - b.epoch_second);
    let highestTime = lastTime || queryTime;
    const newAc = [];

    for (const sub of submissions) {
      highestTime = Math.max(highestTime, sub.epoch_second);
      if (sub.result === 'AC') {
        const dedupKey = `ac_prob_${user.discord_id}_${sub.problem_id}`;
        const alreadySeen = db.prepare('SELECT 1 FROM processed_submissions WHERE id = ?').get(dedupKey);
        if (alreadySeen) continue;

        const index = extractACIndex(sub.problem_id);
        const [title, contestName] = await Promise.all([
          getACProblemTitle(sub.problem_id, sub.contest_id).catch(() => null),
          getACContestName(sub.contest_id)
        ]);

        newAc.push({
          name: title || sub.problem_id,
          index,
          url: `https://atcoder.jp/contests/${sub.contest_id}/tasks/${sub.problem_id}`,
          difficulty: null,
          tags: [],
          timeSec: sub.execution_time !== undefined && sub.execution_time !== null
            ? (sub.execution_time / 1000).toFixed(2)
            : undefined,
          contestId: sub.contest_id,
          contestName,
          contestUrl: `https://atcoder.jp/contests/${sub.contest_id}`,
          id: sub.id,
          timestamp: sub.epoch_second,
          dedupKey
        });
      }
    }

    return { newAc, highestTime: highestTime > (lastTime || 0) ? highestTime : null };
  } catch (err) {
    console.error(`[SubmissionFeed] AC fetch error for ${user.ac_handle}:`, err.message);
    return { newAc: [], highestTime: null };
  }
}

async function broadcastSubmission(client, user, sub, platform) {
  let sentAny = false;
  const sentChannels = new Set();

  for (const guild of client.guilds.cache.values()) {
    try {
      const member = guild.members.cache.get(user.discord_id) || await guild.members.fetch(user.discord_id).catch(() => null);
      if (!member) continue;

      const targetChannel = await resolveChannelChain(
        client,
        [
          { key: 'general_channel_id', env: 'GENERAL_CHANNEL_ID' },
          { key: 'feed_channel_id', env: 'FEED_CHANNEL_ID' },
          { key: 'dashboard_channel_id', env: 'DASHBOARD_CHANNEL_ID' },
          { key: 'rating_channel_id', env: 'RATING_CHANNEL_ID' }
        ],
        guild.id
      );

      if (targetChannel && !sentChannels.has(targetChannel.id)) {
        sentChannels.add(targetChannel.id);
        const embed = buildSubmissionEmbed(user, sub, platform);
        await targetChannel.send({ embeds: [embed] });
        sentAny = true;
      }
    } catch (err) {
      console.error(`[SubmissionFeed] Error broadcasting in ${guild.name}:`, err.message);
    }
  }

  return sentAny;
}

async function publishSubmissions(client, user, subs, platform) {
  for (const sub of subs) {
    await broadcastSubmission(client, user, sub, platform);
    if (sub.dedupKey) {
      db.prepare('INSERT OR IGNORE INTO processed_submissions (id, timestamp) VALUES (?, ?)').run(sub.dedupKey, sub.timestamp);
    }
  }
}

async function runSubmissionFeed(client) {
  const users = getAllUsers();
  let shouldUpdateDashboard = false;
  const isoToday = getLocalParts(new Date(), getTimeZone()).isoDate;

  for (const user of users) {
    const { newAc: cfNew, highestId } = await fetchCFSubmissions(user);
    const { newAc: acNew, highestTime } = await fetchACSubmissions(user);
    const tophNew = await fetchTophSubmissions(user);

    await publishSubmissions(client, user, cfNew, 'cf');
    if (highestId !== null) setLastSubmission(user.discord_id, 'cf', highestId);

    await publishSubmissions(client, user, acNew, 'ac');
    if (highestTime !== null) setLastSubmission(user.discord_id, 'ac', highestTime);

    await publishSubmissions(client, user, tophNew, 'toph');

    if (cfNew.length > 0) {
      try {
        const cfStats = await getCFUser(user.cf_handle);
        if (cfStats) {
          const prevCf = getRatings(user.discord_id).find(r => r.platform === 'cf');
          if (cfStats.solved === null) cfStats.solved = prevCf?.solved ?? 0;
          if (cfStats.rating === 0 && (prevCf?.rating ?? 0) > 0) cfStats.rating = prevCf.rating;
          upsertRating(user.discord_id, 'cf', cfStats);
        }
        const { calculateCFStreak } = require('./ratingSync');
        const streakInfo = await calculateCFStreak(user.cf_handle);
        upsertStreak(user.discord_id, 'cf', streakInfo.current, streakInfo.max, isoToday);
        shouldUpdateDashboard = true;
      } catch (err) {
        console.error(`[SubmissionFeed] CF stat update failed for ${user.cf_handle}:`, err.message);
      }
    }

    if (acNew.length > 0) {
      try {
        const acStats = await getACUser(user.ac_handle);
        if (acStats) {
          const prevAc = getRatings(user.discord_id).find(r => r.platform === 'ac');
          if (acStats.rating === 0 && (prevAc?.rating ?? 0) > 0) acStats.rating = prevAc.rating;
          upsertRating(user.discord_id, 'ac', acStats);
        }
        const streakInfo = await calculateACStreak(user.ac_handle);
        upsertStreak(user.discord_id, 'ac', streakInfo.current, streakInfo.max, isoToday);
        shouldUpdateDashboard = true;
      } catch (err) {
        console.error(`[SubmissionFeed] AC stat update failed for ${user.ac_handle}:`, err.message);
      }
    }

    if (tophNew.length > 0) {
      try {
        const tophStats = await getTophUser(user.toph_handle);
        if (tophStats) upsertRating(user.discord_id, 'toph', tophStats);
        const streakInfo = await calculateTophStreak(user.toph_handle);
        upsertStreak(user.discord_id, 'toph', streakInfo.current, streakInfo.max, isoToday);
        shouldUpdateDashboard = true;
      } catch (err) {
        console.error(`[SubmissionFeed] Toph stat update failed for ${user.toph_handle}:`, err.message);
      }
    }

    if (user.cf_handle) await new Promise(r => setTimeout(r, 2000));
    else if (user.ac_handle) await new Promise(r => setTimeout(r, 500));
  }

  if (shouldUpdateDashboard) {
    const { updateDashboard } = require('./ratingSync');
    await updateDashboard(client).catch(err => console.error('[SubmissionFeed] Dashboard update failed:', err.message));
  }
}

let isRunning = false;

async function runSubmissionFeedLoop(client) {
  if (isRunning) return;
  isRunning = true;
  try {
    console.log('[SubmissionFeed] Polling submission feed...');
    await runSubmissionFeed(client);
    console.log('[SubmissionFeed] Poll complete.');
  } catch (err) {
    console.error('[SubmissionFeed] Error in loop:', err.message);
  } finally {
    isRunning = false;
  }
}

function startSubmissionFeed(client) {
  const scheduleNext = () => {
    setTimeout(async () => {
      await runSubmissionFeedLoop(client);
      scheduleNext();
    }, 60000);
  };

  // Single chained loop: runs initial catch-up at 15s, then 60s after each cycle finishes
  setTimeout(async () => {
    await runSubmissionFeedLoop(client);
    scheduleNext();
  }, 15000);

  console.log('[SubmissionFeed] Chained 60s submission poller started.');
}

module.exports = { startSubmissionFeed, runSubmissionFeed };
