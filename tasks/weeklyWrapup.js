// tasks/weeklyWrapup.js — Weekly Wrap-Up posted on Sunday Midnight
const cron = require('node-cron');
const axios = require('axios');
const { getAllUsers, getRatings, getWeeklySnapshot, setWeeklySnapshot, getConfig, setConfig, db } = require('../database/db');
const { buildWeeklyWrapupEmbed } = require('../utils/embeds');

async function runWeeklyWrapup(client) {
  // Try to use the rating channel as requested, fallback to dashboard
  const channelId = getConfig('rating_channel_id') || getConfig('dashboard_channel_id') || process.env.RATING_CHANNEL_ID || process.env.DASHBOARD_CHANNEL_ID;
  if (!channelId) {
    console.log('[WeeklyWrapUp] No channel configured to post wrap up.');
    return;
  }

  const channel = await client.channels.fetch(channelId).catch(err => {
    console.error(`[WeeklyWrapUp] Channel fetch error for ID ${channelId}:`, err.message);
    return null;
  });
  if (!channel) {
    console.warn(`[WeeklyWrapUp] Channel ${channelId} not found.`);
    return;
  }

  const users = getAllUsers();
  
  const allSolved = [];
  const allRatingGains = [];
  
  // Format the date for the new snapshot
  const formatterDate = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' });
  const todayStr = formatterDate.format(new Date());

  const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 3600;  for (const user of users) {
    const ratings = getRatings(user.discord_id);
    let userTotalSolved = 0;
    let userTotalRatingGain = 0;
    
    let cfStart = 0;
    let cfEnd = 0;
    let acStart = 0;
    let acEnd = 0;

    // CF stats
    let cfSolved = null;
    let cfGain = null;
    if (user.cf_handle) {
      try {
        const statusRes = await axios.get(`https://codeforces.com/api/user.status?handle=${user.cf_handle}`, { timeout: 8000 }).catch(() => null);
        if (statusRes && statusRes.data && statusRes.data.status === 'OK' && statusRes.data.result) {
          const solvedSet = new Set();
          for (const sub of statusRes.data.result) {
            if (sub.creationTimeSeconds < sevenDaysAgo) break;
            if (sub.verdict === 'OK' && sub.problem) {
              solvedSet.add(`${sub.problem.contestId}-${sub.problem.index}`);
            }
          }
          cfSolved = solvedSet.size;
        }
      } catch (err) {
        console.error(`[WeeklyWrapUp] CF Status API error for ${user.username}:`, err.message);
      }

      await new Promise(r => setTimeout(r, 2500)); // Rate limit safety
      
      try {
        const ratingRes = await axios.get(`https://codeforces.com/api/user.rating?handle=${user.cf_handle}`, { timeout: 6000 }).catch(() => null);
        if (ratingRes && ratingRes.data && ratingRes.data.status === 'OK' && ratingRes.data.result) {
          const history = ratingRes.data.result;
          if (history.length > 0) {
            let ratingSevenDaysAgo = history[0].oldRating;
            for (const change of history) {
              if (change.ratingUpdateTimeSeconds < sevenDaysAgo) {
                ratingSevenDaysAgo = change.newRating;
              } else {
                break;
              }
            }
            const currentRating = history[history.length - 1].newRating;
            cfGain = Math.max(0, currentRating - ratingSevenDaysAgo);
            cfStart = ratingSevenDaysAgo;
            cfEnd = currentRating;
          } else {
            cfGain = 0;
            cfStart = 0;
            cfEnd = 0;
          }
        }
      } catch (err) {
        console.error(`[WeeklyWrapUp] CF Rating API error for ${user.username}:`, err.message);
      }
    }

    // AtCoder stats
    let acSolved = null;
    let acGain = null;
    if (user.ac_handle) {
      try {
        const resultsRes = await axios.get(`https://kenkoooo.com/atcoder/atcoder-api/results?user=${user.ac_handle}`, { timeout: 8000 }).catch(() => null);
        if (resultsRes && resultsRes.data && Array.isArray(resultsRes.data)) {
          const solvedSet = new Set();
          for (const sub of resultsRes.data) {
            if (sub.epoch_second >= sevenDaysAgo && sub.result === 'AC') {
              solvedSet.add(sub.problem_id);
            }
          }
          acSolved = solvedSet.size;
        }
      } catch (err) {
        console.error(`[WeeklyWrapUp] AtCoder API error for ${user.username}:`, err.message);
      }
      
      try {
        const oldRatingRow = db.prepare(`
          SELECT rating FROM rating_history
          WHERE discord_id = ? AND platform = 'ac' AND recorded_at < ?
          ORDER BY recorded_at DESC LIMIT 1
        `).get(user.discord_id, sevenDaysAgo);
        
        const acDbRating = ratings.find(r => r.platform === 'ac');
        if (acDbRating) {
          const currentRating = acDbRating.rating;
          const ratingSevenDaysAgo = oldRatingRow ? oldRatingRow.rating : 0;
          acGain = Math.max(0, currentRating - ratingSevenDaysAgo);
          acStart = ratingSevenDaysAgo;
          acEnd = currentRating;
        }
      } catch (err) {
        console.error(`[WeeklyWrapUp] AtCoder Local History error for ${user.username}:`, err.message);
      }
    }

    // Hybrid calculation: Use API data if available, otherwise fall back to DB snapshots
    if (user.cf_handle) {
      const cfDbRating = ratings.find(r => r.platform === 'cf');
      const snap = getWeeklySnapshot(user.discord_id, 'cf');
      
      if (cfSolved !== null) {
        userTotalSolved += cfSolved;
      } else if (cfDbRating && snap) {
        cfSolved = Math.max(0, cfDbRating.solved - snap.solved);
        userTotalSolved += cfSolved;
      } else {
        cfSolved = 0;
      }
      
      if (cfGain !== null) {
        userTotalRatingGain += cfGain;
      } else if (cfDbRating && snap) {
        cfGain = Math.max(0, cfDbRating.rating - snap.rating);
        userTotalRatingGain += cfGain;
        cfStart = snap.rating;
        cfEnd = cfDbRating.rating;
      } else if (cfDbRating) {
        cfGain = 0;
        cfStart = cfDbRating.rating;
        cfEnd = cfDbRating.rating;
      } else {
        cfGain = 0;
      }
    }
    
    if (user.ac_handle) {
      const acDbRating = ratings.find(r => r.platform === 'ac');
      const snap = getWeeklySnapshot(user.discord_id, 'ac');
      
      if (acSolved !== null) {
        userTotalSolved += acSolved;
      } else if (acDbRating && snap) {
        acSolved = Math.max(0, acDbRating.solved - snap.solved);
        userTotalSolved += acSolved;
      } else {
        acSolved = 0;
      }
      
      if (acGain !== null) {
        userTotalRatingGain += acGain;
      } else if (acDbRating && snap) {
        acGain = Math.max(0, acDbRating.rating - snap.rating);
        userTotalRatingGain += acGain;
        acStart = snap.rating;
        acEnd = acDbRating.rating;
      } else if (acDbRating) {
        acGain = 0;
        acStart = acDbRating.rating;
        acEnd = acDbRating.rating;
      } else {
        acGain = 0;
      }
    }
    
    // Save/update snapshot for the next week
    for (const r of ratings) {
      setWeeklySnapshot(user.discord_id, r.platform, r.rating, r.solved, todayStr);
    }
    
    allSolved.push({
      discord_id: user.discord_id,
      solved_this_week: userTotalSolved,
      cf_solved: cfSolved || 0,
      ac_solved: acSolved || 0
    });
    
    allRatingGains.push({
      discord_id: user.discord_id,
      rating_gained: userTotalRatingGain,
      cf_gain: cfGain || 0,
      cf_start: cfStart,
      cf_end: cfEnd,
      cf_linked: !!user.cf_handle,
      ac_gain: acGain || 0,
      ac_start: acStart,
      ac_end: acEnd,
      ac_linked: !!user.ac_handle
    });

    await new Promise(r => setTimeout(r, 2500)); // Rate limit safety
  }

  // Sort lists (solved descending, rating gain descending)
  allSolved.sort((a, b) => b.solved_this_week - a.solved_this_week);
  allRatingGains.sort((a, b) => b.rating_gained - a.rating_gained);
  
  const { getPlatformEmojis } = require('../utils/emojis');
  const emojis = await getPlatformEmojis(channel.guild);
  const embed = buildWeeklyWrapupEmbed(allSolved, allRatingGains, emojis);
  
  await channel.send({ content: '@everyone', embeds: [embed] }).catch(err => {
    console.error('[WeeklyWrapUp] Failed to post wrap up:', err.message);
  });
  
  console.log('[WeeklyWrapUp] Successfully posted weekly wrap-up.');
}

function getTargetWeeklyWrapupDate() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  const formatted = formatter.format(now);
  const match = formatted.match(/^(\d{2})\/(\d{2})\/(\d{4}),\s*(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) {
    // Fallback if match fails
    return '';
  }
  
  const month = parseInt(match[1], 10) - 1; // 0-based
  const dayOfMonth = parseInt(match[2], 10);
  const year = parseInt(match[3], 10);
  const hour = parseInt(match[4], 10);
  
  const localDhakaDate = new Date(Date.UTC(year, month, dayOfMonth, hour, 0, 0));
  const dayOfWeek = localDhakaDate.getUTCDay(); // 0 = Sunday, 1 = Monday, etc.
  
  let targetSunday = new Date(localDhakaDate);
  if (dayOfWeek === 0) {
    if (hour < 21) {
      // Sunday before 9pm Dhaka time -> target is previous Sunday
      targetSunday.setUTCDate(localDhakaDate.getUTCDate() - 7);
    } else {
      // Sunday after 9pm -> target is today
      targetSunday.setUTCDate(localDhakaDate.getUTCDate());
    }
  } else {
    // Monday-Saturday -> target is most recent Sunday
    targetSunday.setUTCDate(localDhakaDate.getUTCDate() - dayOfWeek);
  }
  
  const targetYear = targetSunday.getUTCFullYear();
  const targetMonth = String(targetSunday.getUTCMonth() + 1).padStart(2, '0');
  const targetDay = String(targetSunday.getUTCDate()).padStart(2, '0');
  
  return `${targetMonth}/${targetDay}/${targetYear}`;
}

// One-time weekly reset (no-op now)
async function runOneTimeWeeklyReset(client) {}

function startWeeklyWrapup(client) {
  // Catch-up check on boot (waits 15s to let bot fully connect)
  setTimeout(async () => {
    try {
      // 1. Run layout reset first (no-op now)
      await runOneTimeWeeklyReset(client);

      // 2. Then perform the catch-up check
      const targetDateStr = getTargetWeeklyWrapupDate();
      const lastWrapupDate = getConfig('last_weekly_wrapup_date');
      
      console.log(`[WeeklyWrapUp] Startup check: last wrap-up date is ${lastWrapupDate}, target is ${targetDateStr}`);
      
      if (lastWrapupDate !== targetDateStr) {
        if (!lastWrapupDate) {
          // First time initialization on fresh database: don't post empty historical wrap-up, just mark it as done
          console.log(`[WeeklyWrapUp] Fresh database detected. Initializing last_weekly_wrapup_date to ${targetDateStr} without posting.`);
          setConfig('last_weekly_wrapup_date', targetDateStr);
        } else {
          console.log(`[WeeklyWrapUp] Startup catch-up check: Wrap-up for Sunday ${targetDateStr} not posted yet. Posting...`);
          await runWeeklyWrapup(client);
          setConfig('last_weekly_wrapup_date', targetDateStr);
        }
      }
    } catch (err) {
      console.error('[WeeklyWrapUp Startup Catch-up Error]', err);
    }
  }, 15000);

  // Runs every Sunday at 21:00 (9:00 PM) in Asia/Dhaka time
  cron.schedule('0 21 * * 0', async () => {
    try {
      console.log('[WeeklyWrapUp] Sunday 9 PM triggered! Generating wrap up...');
      await runWeeklyWrapup(client);
      
      const targetDateStr = getTargetWeeklyWrapupDate();
      setConfig('last_weekly_wrapup_date', targetDateStr);
    } catch (err) {
      console.error('[WeeklyWrapUp] Error:', err.message);
    }
  }, { timezone: 'Asia/Dhaka' });
  
  console.log('[WeeklyWrapUp] Started Sunday 9 PM cron scheduler with startup catch-up.');
}

module.exports = { startWeeklyWrapup, runWeeklyWrapup };
