// tasks/weeklyWrapup.js — Weekly Wrap-Up posted on Sunday Midnight
const cron = require('node-cron');
const axios = require('axios');
const { getAllUsers, getRatings, getWeeklySnapshot, setWeeklySnapshot, getConfig, setConfig, db } = require('../database/db');
const { buildWeeklyWrapupEmbed } = require('../utils/embeds');


async function runWeeklyWrapup(client, updateSnapshots = false) {
  // Try to use the rating channel as requested, fallback to dashboard
  const channelId = getConfig('rating_channel_id') || getConfig('dashboard_channel_id') || process.env.RATING_CHANNEL_ID || process.env.DASHBOARD_CHANNEL_ID;
  if (!channelId) {
    console.log('[WeeklyWrapUp] No channel configured to post wrap up.');
    return false;
  }

  const channel = await client.channels.fetch(channelId).catch(err => {
    console.error(`[WeeklyWrapUp] Channel fetch error for ID ${channelId}:`, err.message);
    return null;
  });
  if (!channel) {
    console.warn(`[WeeklyWrapUp] Channel ${channelId} not found.`);
    return false;
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
    
    let cfStart = 0, cfEnd = 0, cfGain = 0, cfSolved = 0;
    let acStart = 0, acEnd = 0, acGain = 0, acSolved = 0;
    let tophStart = 0, tophEnd = 0, tophGain = 0, tophSolved = 0;

    if (user.cf_handle) {
      const dbRating = ratings.find(r => r.platform === 'cf');
      const snap = getWeeklySnapshot(user.discord_id, 'cf');
      if (dbRating && snap) {
        cfSolved = Math.max(0, dbRating.solved - snap.solved);
        cfGain = Math.max(0, dbRating.rating - snap.rating);
        cfStart = snap.rating;
        cfEnd = dbRating.rating;
      } else if (dbRating) {
        cfStart = dbRating.rating;
        cfEnd = dbRating.rating;
      }
      userTotalSolved += cfSolved;
      userTotalRatingGain += cfGain;
    }

    if (user.ac_handle) {
      const dbRating = ratings.find(r => r.platform === 'ac');
      const snap = getWeeklySnapshot(user.discord_id, 'ac');
      if (dbRating && snap) {
        acSolved = Math.max(0, dbRating.solved - snap.solved);
        acGain = Math.max(0, dbRating.rating - snap.rating);
        acStart = snap.rating;
        acEnd = dbRating.rating;
      } else if (dbRating) {
        acStart = dbRating.rating;
        acEnd = dbRating.rating;
      }
      userTotalSolved += acSolved;
      userTotalRatingGain += acGain;
    }

    if (user.toph_handle) {
      const dbRating = ratings.find(r => r.platform === 'toph');
      const snap = getWeeklySnapshot(user.discord_id, 'toph');
      if (dbRating && snap) {
        tophSolved = Math.max(0, dbRating.solved - snap.solved);
        tophGain = Math.max(0, dbRating.rating - snap.rating);
        tophStart = snap.rating;
        tophEnd = dbRating.rating;
      } else if (dbRating) {
        tophStart = dbRating.rating;
        tophEnd = dbRating.rating;
      }
      userTotalSolved += tophSolved;
      userTotalRatingGain += tophGain;
    }
    
    // Save/update snapshot for the next week only when requested (e.g., Sunday Midnight Cron)
    if (updateSnapshots) {
      for (const r of ratings) {
        setWeeklySnapshot(user.discord_id, r.platform, r.rating, r.solved, todayStr);
      }
    }
    
    allSolved.push({
      discord_id: user.discord_id,
      cf_solved:   cfSolved   || 0,
      ac_solved:   acSolved   || 0,
      toph_solved: tophSolved || 0,
      // Total = sum of all platforms (Toph was previously missing from this)
      solved_this_week: (cfSolved || 0) + (acSolved || 0) + (tophSolved || 0)
    });

    allRatingGains.push({
      discord_id: user.discord_id,
      rating_gained: userTotalRatingGain,
      cf_gain:    cfGain   || 0, cf_start: cfStart,   cf_end: cfEnd,   cf_linked:   !!user.cf_handle,
      ac_gain:    acGain   || 0, ac_start: acStart,   ac_end: acEnd,   ac_linked:   !!user.ac_handle,
      toph_gain:  tophGain || 0, toph_start: tophStart, toph_end: tophEnd, toph_linked: !!user.toph_handle
    });

  }

  // Sort lists (solved descending, rating gain descending)
  allSolved.sort((a, b) => b.solved_this_week - a.solved_this_week);
  allRatingGains.sort((a, b) => b.rating_gained - a.rating_gained);
  
  const { getPlatformEmojis } = require('../utils/emojis');
  const emojis = await getPlatformEmojis(channel.guild);
  const embed = buildWeeklyWrapupEmbed(allSolved, allRatingGains, emojis);
  
  let posted = false;
  await channel.send({ content: '@everyone', embeds: [embed] })
    .then(() => {
      posted = true;
    })
    .catch(err => {
      console.error('[WeeklyWrapUp] Failed to post wrap up:', err.message);
    });
  
  if (posted) {
    console.log('[WeeklyWrapUp] Successfully posted weekly wrap-up.');
    return true;
  }
  return false;
}

function getTargetWeeklyWrapupDate() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false
  });
  
  const parts = formatter.formatToParts(now);
  const partMap = {};
  for (const part of parts) {
    partMap[part.type] = part.value;
  }
  
  const year = parseInt(partMap.year, 10);
  const month = parseInt(partMap.month, 10) - 1; // 0-based
  const dayOfMonth = parseInt(partMap.day, 10);
  const hour = parseInt(partMap.hour, 10);
  
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
          const success = await runWeeklyWrapup(client, true);
          if (success) {
            setConfig('last_weekly_wrapup_date', targetDateStr);
          } else {
            console.error('[WeeklyWrapUp] Startup catch-up failed or skipped (no channel resolved).');
          }
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
      const success = await runWeeklyWrapup(client, true);
      if (success) {
        const targetDateStr = getTargetWeeklyWrapupDate();
        setConfig('last_weekly_wrapup_date', targetDateStr);
      } else {
        console.error('[WeeklyWrapUp] Sunday 9 PM execution failed or skipped (no channel resolved).');
      }
    } catch (err) {
      console.error('[WeeklyWrapUp] Error:', err.message);
    }
  }, { timezone: 'Asia/Dhaka' });
  
  console.log('[WeeklyWrapUp] Started Sunday 9 PM cron scheduler with startup catch-up.');
}

module.exports = { startWeeklyWrapup, runWeeklyWrapup };
