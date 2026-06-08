// tasks/submissionFeed.js — Live feed for accepted submissions
const cron = require('node-cron');
const axios = require('axios');
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

  // Fetch gym contest list if the ID looks like a Gym contest (usually >= 100000)
  if (Number(contestId) >= 100000) {
    if (!gymContestListCache || (now - lastGymContestListFetchTime > 3600000)) {
      try {
        console.log('[SubmissionFeed] Fetching Codeforces gym contest list for cache...');
        const res = await axios.get(`${CF_BASE}/contest.list?gym=true`, { timeout: 15000 });
        if (res.data.status === 'OK') {
          gymContestListCache = res.data.result;
          lastGymContestListFetchTime = now;
        }
      } catch (err) {
        console.error('[SubmissionFeed] Failed to fetch gym contest list:', err.message);
      }
    }

    if (gymContestListCache) {
      const contest = gymContestListCache.find(c => c.id === Number(contestId));
      if (contest) {
        name = contest.name;
        cacheContestName(contestId, name);
        return name;
      }
    }
  }

  // Fallback to contest.ratingChanges if not found in list (e.g. if it is a very new contest)
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
    const res = await axios.get(`${CF_BASE}/user.status?handle=${user.cf_handle}&from=1&count=10`, { timeout: 8000 });
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
      
      if (isNew) {
        highestId = Math.max(highestId, sub.id);
        if (sub.verdict === 'OK' && sub.problem) {
          const contestName = await getOrFetchContestName(sub.problem.contestId);
          const isGym = Number(sub.problem.contestId) >= 100000;
          const problemUrl = isGym
            ? `https://codeforces.com/gym/${sub.problem.contestId}/problem/${sub.problem.index}`
            : `https://codeforces.com/problemset/problem/${sub.problem.contestId}/${sub.problem.index}`;

          newAc.push({
            name: sub.problem.name,
            url: problemUrl,
            rating: sub.problem.rating,
            tags: sub.problem.tags,
            contestName: contestName
          });
        }
      } else if (lastId === null) {
        highestId = Math.max(highestId, sub.id);
      }
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
    
    const res = await axios.get(
      `https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions?user=${user.ac_handle}&from_second=${queryTime + 1}`,
      { timeout: 8000, headers: KENKOOOO_HEADERS }
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
  
  for (const user of users) {
    const cfNew = await fetchCFSubmissions(user);
    const { newAc: acNew, highestTime } = await fetchACSubmissions(user);
    
    for (const sub of cfNew) {
      const embed = buildSubmissionEmbed(user, sub, 'cf');
      await channel.send({ embeds: [embed] }).catch(() => {});
    }
    
    for (const sub of acNew) {
      const embed = buildSubmissionEmbed(user, sub, 'ac');
      await channel.send({ embeds: [embed] }).catch(() => {});
    }

    if (highestTime !== null) {
      setLastSubmission(user.discord_id, 'ac', highestTime);
    }

    if (acNew.length > 0) {
      const { getACSolvedCount } = require('../utils/atcoder');
      const latestSolved = await getACSolvedCount(user.ac_handle);
      if (latestSolved > 0) {
        db.prepare("UPDATE ratings SET solved = max(coalesce(solved, 0), ?) WHERE discord_id = ? AND platform = 'ac'").run(latestSolved, user.discord_id);
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

let isRunning = false;

async function runSubmissionFeedLoop(client) {
  if (isRunning) return;
  isRunning = true;
  try {
    await runSubmissionFeed(client);
  } catch (err) {
    console.error('[SubmissionFeed] Error in loop:', err.message);
  } finally {
    isRunning = false;
  }
}

function startSubmissionFeed(client) {
  // Run every 1 minute
  cron.schedule('* * * * *', async () => {
    await runSubmissionFeedLoop(client);
  });
  console.log('[SubmissionFeed] Started 1-minute live feed poller.');
}

module.exports = { startSubmissionFeed, runSubmissionFeed };
