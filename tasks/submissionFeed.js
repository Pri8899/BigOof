// tasks/submissionFeed.js — Live feed for accepted submissions
const cron = require('node-cron');
const axios = require('axios');
const { getAllUsers, getConfig, getLastSubmission, setLastSubmission } = require('../database/db');
const { buildSubmissionEmbed } = require('../utils/embeds');

const CF_BASE = 'https://codeforces.com/api';

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
    
    for (const sub of submissions) {
      if (lastId === null) {
        highestId = Math.max(highestId, sub.id);
      } else if (sub.id > lastId) {
        highestId = Math.max(highestId, sub.id);
        if (sub.verdict === 'OK' && sub.problem) {
          newAc.push({
            name: sub.problem.name,
            url: `https://codeforces.com/problemset/problem/${sub.problem.contestId}/${sub.problem.index}`,
            rating: sub.problem.rating,
            tags: sub.problem.tags
          });
        }
      }
    }
    
    if (highestId > (lastId || 0)) {
      setLastSubmission(user.discord_id, 'cf', highestId);
    }
    
    // If it was their first time being checked, don't spam their latest 10 submissions.
    if (lastId === null) return [];
    
    return newAc;
  } catch (err) {
    return [];
  }
}

async function fetchACSubmissions(user) {
  if (!user.ac_handle) return [];
  try {
    let lastTime = getLastSubmission(user.discord_id, 'ac');
    const now = Math.floor(Date.now() / 1000);
    
    // If first time, just set it to now to avoid fetching all history
    if (lastTime === null) {
      setLastSubmission(user.discord_id, 'ac', now);
      return [];
    }
    
    const res = await axios.get(
      `https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions?user=${user.ac_handle}&from_second=${lastTime + 1}`,
      { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    
    if (!Array.isArray(res.data) || res.data.length === 0) return [];
    
    // Sort by epoch_second ascending
    const submissions = res.data.sort((a, b) => a.epoch_second - b.epoch_second);
    let highestTime = lastTime;
    const newAc = [];
    
    for (const sub of submissions) {
      highestTime = Math.max(highestTime, sub.epoch_second);
      if (sub.result === 'AC') {
        newAc.push({
          name: `${sub.problem_id}`,
          url: `https://atcoder.jp/contests/${sub.contest_id}/tasks/${sub.problem_id}`,
          difficulty: null,
          tags: []
        });
      }
    }
    
    if (highestTime > lastTime) {
      setLastSubmission(user.discord_id, 'ac', highestTime);
    }
    
    return newAc;
  } catch (err) {
    return [];
  }
}

async function runSubmissionFeed(client) {
  const channelId = getConfig('feed_channel_id');
  if (!channelId) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

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
    
    // Slight delay to prevent rate limits when scanning many users
    await new Promise(r => setTimeout(r, 500));
  }
}

function startSubmissionFeed(client) {
  // Run every 2 minutes
  cron.schedule('*/2 * * * *', async () => {
    try {
      await runSubmissionFeed(client);
    } catch (err) {
      console.error('[SubmissionFeed] Error:', err.message);
    }
  });
  console.log('[SubmissionFeed] Started 2-minute live feed poller.');
}

module.exports = { startSubmissionFeed };
