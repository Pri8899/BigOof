// tasks/submissionFeed.js — Live feed for accepted submissions
const cron = require('node-cron');
const axios = require('axios');
const { getAllUsers, getConfig, getLastSubmission, setLastSubmission, getCachedContestName, cacheContestName } = require('../database/db');
const { buildSubmissionEmbed } = require('../utils/embeds');

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
    const minTime = Math.max(user.joined_at || 0, nowSec - 86400);

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
  if (!user.ac_handle) return [];
  try {
    let lastTime = getLastSubmission(user.discord_id, 'ac');
    const now = Math.floor(Date.now() / 1000);
    
    let queryTime = lastTime;
    if (queryTime === null) {
      queryTime = Math.max(user.joined_at || 0, now - 86400) - 1;
    }
    
    const res = await axios.get(
      `https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions?user=${user.ac_handle}&from_second=${queryTime + 1}`,
      { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    
    if (!Array.isArray(res.data) || res.data.length === 0) {
      if (lastTime === null) {
        setLastSubmission(user.discord_id, 'ac', now);
      }
      return [];
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
    
    if (highestTime > (lastTime || 0)) {
      setLastSubmission(user.discord_id, 'ac', highestTime);
    }
    
    return newAc;
  } catch (err) {
    console.error(`[SubmissionFeed] Error fetching AtCoder submissions for ${user.ac_handle}:`, err.message);
    return [];
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
  
  for (const user of users) {
    const [cfNew, acNew] = await Promise.all([
      fetchCFSubmissions(user),
      fetchACSubmissions(user)
    ]);
    
    for (const sub of cfNew) {
      const embed = buildSubmissionEmbed(user, sub, 'cf');
      await channel.send({ embeds: [embed] }).catch(() => {});
    }
    
    for (const sub of acNew) {
      const embed = buildSubmissionEmbed(user, sub, 'ac');
      await channel.send({ embeds: [embed] }).catch(() => {});
    }
    
    // Slight delay to prevent rate limits when scanning many users (respecting 1 request / 2 seconds CF limit)
    await new Promise(r => setTimeout(r, 2500));
  }
}

function startSubmissionFeed(client) {
  // Run every 1 minute
  cron.schedule('* * * * *', async () => {
    try {
      await runSubmissionFeed(client);
    } catch (err) {
      console.error('[SubmissionFeed] Error:', err.message);
    }
  });
  console.log('[SubmissionFeed] Started 1-minute live feed poller.');
}

module.exports = { startSubmissionFeed };
