// tasks/submissionFeed.js — Live feed for accepted submissions
const cron = require('node-cron');
const axios = require('axios');

async function axiosGetWithRetry(url, options = {}, retries = 3, backoff = 1500) {
  for (let i = 0; i < retries; i++) {
    try {
      return await axios.get(url, options);
    } catch (err) {
      const status = err.response ? err.response.status : null;
      const isRateLimit = status === 429;
      const isServerError = status && status >= 500;
      const isTimeout = err.code === 'ECONNABORTED' || err.message.includes('timeout');
      
      if ((isRateLimit || isServerError || isTimeout) && i < retries - 1) {
        const delay = backoff * Math.pow(2, i);
        console.warn(`[AC Feed Retry] Failed to fetch ${url} (Status: ${status || err.code}). Retrying in ${delay}ms... (Attempt ${i + 1}/${retries})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}
const { getAllUsers, getConfig, getLastSubmission, setLastSubmission, getCachedContestName, cacheContestName, db } = require('../database/db');
const { buildSubmissionEmbed } = require('../utils/embeds');

const KENKOOOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
  'Origin':     'https://kenkoooo.com',
  'Referer':    'https://kenkoooo.com/atcoder/'
};

const CF_BASE = 'https://codeforces.com/api';

let contestListCache = null;
let lastContestListFetchTime = 0;
let gymContestListCache = null;
let lastGymContestListFetchTime = 0;

async function getOrFetchContestName(contestId) {
  if (!contestId) return null;
  let name = getCachedContestName(contestId);
  if (name) return name;

  const now = Date.now();
  // Fetch contest list if cache is empty or older than 1 hour (3600000 ms)
  if (!contestListCache || (now - lastContestListFetchTime > 3600000)) {
    try {
      console.log('[SubmissionFeed] Fetching Codeforces contest list for cache...');
      const res = await axios.get(`${CF_BASE}/contest.list?gym=false`, { timeout: 8000 });
      if (res.data.status === 'OK') {
        contestListCache = res.data.result;
        lastContestListFetchTime = now;
      }
    } catch (err) {
      console.error('[SubmissionFeed] Failed to fetch contest list:', err.message);
    }
  }

  // Look up contest in cache
  if (contestListCache) {
    const contest = contestListCache.find(c => c.id === Number(contestId));
    if (contest) {
      name = contest.name;
      cacheContestName(contestId, name);
      return name;
    }
  }

  // For gym contests — fetch the name directly (gym list is too large and times out)
  if (Number(contestId) >= 100000) {
    try {
      const res = await axios.get(`${CF_BASE}/contest.standings?contestId=${contestId}&from=1&count=1&showUnofficial=true`, { timeout: 8000 });
      if (res.data.status === 'OK' && res.data.result && res.data.result.contest) {
        name = res.data.result.contest.name;
        cacheContestName(contestId, name);
        return name;
      }
    } catch (err) {
      // Gym contest might be private — ignore
    }
    return null; // gym contest name not found, embed will show "Practice"
  }

  // Fallback to contest.ratingChanges for very new regular contests
  try {
    const res = await axios.get(`${CF_BASE}/contest.ratingChanges?contestId=${contestId}`, { timeout: 5000 });
    if (res.data.status === 'OK' && res.data.result && res.data.result.length > 0) {
      name = res.data.result[0].contestName;
      cacheContestName(contestId, name);
      return name;
    }
  } catch (err) {
    // Ignore fallback errors
  }

  return null;
}

async function fetchCFSubmissions(user) {
  if (!user.cf_handle) return [];
  try {
    const res = await axios.get(`${CF_BASE}/user.status?handle=${user.cf_handle}&from=1&count=50`, { timeout: 8000 });
    if (res.data.status !== 'OK') return [];

    let lastId = getLastSubmission(user.discord_id, 'cf');
    let highestId = lastId || 0;

    // Sort submissions by ID ascending so we process oldest to newest
    const submissions = res.data.result.sort((a, b) => a.id - b.id);
    const newAc = [];

    const nowSec = Math.floor(Date.now() / 1000);
    const minTime = nowSec - 10800; // 3 hours

    for (const sub of submissions) {
      const isNew = lastId !== null ? (sub.id > lastId) : (sub.creationTimeSeconds >= minTime);
      if (!isNew) continue;

      if (sub.verdict === 'TESTING' || !sub.verdict) {
        // Still being judged — stop here and re-check next poll
        break;
      }

      // Advance pointer for all fully-judged submissions
      highestId = Math.max(highestId, sub.id);

      if (sub.verdict === 'OK' && sub.problem) {
        // ── Per-submission dedup using processed_submissions table ──
        const dedupKey = `cf_${user.discord_id}_${sub.id}`;
        const alreadySeen = db.prepare('SELECT 1 FROM processed_submissions WHERE id = ?').get(dedupKey);
        if (alreadySeen) continue; // already announced — skip

        // Mark as processed BEFORE announcing to prevent duplicates on restart
        db.prepare('INSERT OR IGNORE INTO processed_submissions (id, timestamp) VALUES (?, ?)').run(dedupKey, sub.creationTimeSeconds);

        const contestName = await getOrFetchContestName(sub.problem.contestId);
        const isGym = Number(sub.problem.contestId) >= 100000;
        const problemUrl = isGym
          ? `https://codeforces.com/gym/${sub.problem.contestId}/problem/${sub.problem.index}`
          : `https://codeforces.com/problemset/problem/${sub.problem.contestId}/${sub.problem.index}`;

        newAc.push({
          name: sub.problem.name,
          index: sub.problem.index,        // A, B, C, C1, D …
          url: problemUrl,
          rating: sub.problem.rating,
          tags: sub.problem.tags,
          contestName: contestName
        });
      }
      // WA, TLE etc — pointer advanced, nothing to announce
    }

    if (highestId > (lastId || 0)) {
      setLastSubmission(user.discord_id, 'cf', highestId);
    }

    return newAc;
  } catch (err) {
    console.error(`[SubmissionFeed] Error fetching Codeforces submissions for ${user.cf_handle}:`, err.message);
    return [];
  }
}

async function fetchACSubmissions(user) {
  if (!user.ac_handle) return { newAc: [], highestTime: null };
  try {
    let lastTime = getLastSubmission(user.discord_id, 'ac');
    const now = Math.floor(Date.now() / 1000);
    
    let queryTime = lastTime;
    if (queryTime === null) {
      queryTime = now - 10800; // 3 hours
    }
    
    const res = await axiosGetWithRetry(
      `https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions?user=${user.ac_handle}&from_second=${queryTime + 1}`,
      { timeout: 15000, headers: KENKOOOO_HEADERS }
    );
    
    if (!Array.isArray(res.data) || res.data.length === 0) {
      return { newAc: [], highestTime: lastTime === null ? queryTime : null };
    }
    
    // Sort by epoch_second ascending
    const submissions = res.data.sort((a, b) => a.epoch_second - b.epoch_second);
    let highestTime = lastTime || queryTime;
    const newAc = [];
    
    for (const sub of submissions) {
      highestTime = Math.max(highestTime, sub.epoch_second);
      if (sub.result === 'AC') {
        newAc.push({
          name: `${sub.problem_id}`,
          url: `https://atcoder.jp/contests/${sub.contest_id}/tasks/${sub.problem_id}`,
          difficulty: null,
          tags: [],
          contestId: sub.contest_id
        });
      }
    }
    
    return { newAc, highestTime: highestTime > (lastTime || 0) ? highestTime : null };
  } catch (err) {
    console.error(`[SubmissionFeed] Error fetching AtCoder submissions for ${user.ac_handle}:`, err.message);
    return { newAc: [], highestTime: null };
  }
}


async function runSubmissionFeed(client) {
  const channelId = getConfig('feed_channel_id') || process.env.FEED_CHANNEL_ID || process.env.GENERAL_CHANNEL_ID;
  if (!channelId) {
    console.warn('[SubmissionFeed] No live feed channel configured. Please set one using /set-feed-channel or define FEED_CHANNEL_ID / GENERAL_CHANNEL_ID in .env.');
    return;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    console.warn(`[SubmissionFeed] Configured channel ID ${channelId} could not be fetched.`);
    return;
  }

  const users = getAllUsers();
  let shouldUpdateDashboard = false;
  
  const { getPlatformEmojis } = require('../utils/emojis');
  const emojis = await getPlatformEmojis(channel.guild);

  for (const user of users) {
    const { fetchTophSubmissions } = require('../utils/toph');
    const cfNew = await fetchCFSubmissions(user);
    const { newAc: acNew, highestTime } = await fetchACSubmissions(user);
    const tophNew = await fetchTophSubmissions(user);

    // Save AC pointer BEFORE sending embeds to prevent re-announcing on restart
    if (highestTime !== null) {
      setLastSubmission(user.discord_id, 'ac', highestTime);
    }

    for (const sub of cfNew) {
      const embed = buildSubmissionEmbed(user, sub, 'cf', emojis);
      await channel.send({ embeds: [embed] }).catch(() => {});
    }
    
    for (const sub of acNew) {
      const embed = buildSubmissionEmbed(user, sub, 'ac', emojis);
      await channel.send({ embeds: [embed] }).catch(() => {});
    }

    for (const sub of tophNew) {
      const embed = buildSubmissionEmbed(user, sub, 'toph', emojis);
      await channel.send({ embeds: [embed] }).catch(() => {});
    }



    if (cfNew.length > 0) {
      try {
        const { getCFUser } = require('../utils/codeforces');
        const cfStats = await getCFUser(user.cf_handle);
        if (cfStats) {
          const { upsertRating } = require('../database/db');
          upsertRating(user.discord_id, 'cf', cfStats);
        }
      } catch (err) {
        console.error(`[SubmissionFeed] Error updating CF stats for ${user.cf_handle}:`, err.message);
      }
      try {
        const { calculateCFStreak } = require('./ratingSync');
        const streakInfo = await calculateCFStreak(user.cf_handle);
        if (streakInfo) {
          const { upsertStreak } = require('../database/db');
          upsertStreak(user.discord_id, 'cf', streakInfo.current, streakInfo.max, new Date().toISOString().split('T')[0]);
        }
      } catch (err) {
        console.error(`[SubmissionFeed] Error updating CF streak for ${user.cf_handle}:`, err.message);
      }
      shouldUpdateDashboard = true;
    }

    if (acNew.length > 0) {
      try {
        const { getACSolvedCount } = require('../utils/atcoder');
        const latestSolved = await getACSolvedCount(user.ac_handle);
        if (latestSolved > 0) {
          db.prepare("UPDATE ratings SET solved = max(coalesce(solved, 0), ?) WHERE discord_id = ? AND platform = 'ac'").run(latestSolved, user.discord_id);
        }
      } catch (err) {
        console.error(`[SubmissionFeed] Error updating AC stats for ${user.ac_handle}:`, err.message);
      }
      try {
        const { calculateACStreak } = require('./ratingSync');
        const streakInfo = await calculateACStreak(user.ac_handle);
        if (streakInfo) {
          const { upsertStreak } = require('../database/db');
          upsertStreak(user.discord_id, 'ac', streakInfo.current, streakInfo.max, new Date().toISOString().split('T')[0]);
        }
      } catch (err) {
        console.error(`[SubmissionFeed] Error updating AC streak for ${user.ac_handle}:`, err.message);
      }
      shouldUpdateDashboard = true;
    }

    if (tophNew.length > 0) {
      try {
        const { getTophUser } = require('../utils/toph');
        const tophStats = await getTophUser(user.toph_handle);
        if (tophStats) {
          const { upsertRating } = require('../database/db');
          upsertRating(user.discord_id, 'toph', tophStats);
        }
      } catch (err) {
        console.error(`[SubmissionFeed] Error updating Toph stats for ${user.toph_handle}:`, err.message);
      }
      try {
        const { calculateTophStreak } = require('../utils/toph');
        const streakInfo = await calculateTophStreak(user.toph_handle);
        if (streakInfo && (streakInfo.current > 0 || streakInfo.max > 0)) {
          const { upsertStreak } = require('../database/db');
          upsertStreak(user.discord_id, 'toph', streakInfo.current, streakInfo.max, new Date().toISOString().split('T')[0]);
        }
      } catch (err) {
        console.error(`[SubmissionFeed] Error updating Toph streak for ${user.toph_handle}:`, err.message);
      }
      shouldUpdateDashboard = true;
    }
    
    // Slight delay to prevent rate limits when scanning many users (respecting 1 request / 2 seconds CF limit)
    if (user.cf_handle) {
      await new Promise(r => setTimeout(r, 2500));
    } else if (user.ac_handle) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  if (shouldUpdateDashboard) {
    const { updateDashboard } = require('./ratingSync');
    await updateDashboard(client).catch(err => console.error('[SubmissionFeed] Dashboard update failed:', err.message));
  }
}

async function runWithTimeout(promise, ms, name) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Timeout: ${name} took longer than ${ms}ms`));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

let isRunning = false;

async function runSubmissionFeedLoop(client) {
  if (isRunning) return;
  isRunning = true;
  try {
    console.log('[SubmissionFeed] Polling submission feed...');
    await runWithTimeout(runSubmissionFeed(client), 90000, 'runSubmissionFeed');
    console.log('[SubmissionFeed] Submission feed poll complete.');
  } catch (err) {
    console.error('[SubmissionFeed] Error in loop:', err.message);
  } finally {
    isRunning = false;
  }
}

function startSubmissionFeed(client) {
  // Run initial check 15 seconds after boot to catch any offline solves
  setTimeout(async () => {
    console.log('[SubmissionFeed] Startup check: Running initial poller...');
    await runSubmissionFeedLoop(client);
  }, 15000);

  // Set up a robust recursive setTimeout poller that schedules the next run only after the previous finishes
  const poll = async () => {
    try {
      await runSubmissionFeedLoop(client);
    } catch (err) {
      console.error('[SubmissionFeed] Poller error:', err.message);
    }
    setTimeout(poll, 60000); // Poll again 60 seconds after completing the previous run
  };

  // Schedule the recursive poller to begin after the startup check
  setTimeout(poll, 75000);
  console.log('[SubmissionFeed] Sleep-resistant recursive poller started (guaranteed every 60s).');
}

module.exports = { startSubmissionFeed, runSubmissionFeed };
