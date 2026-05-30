// tasks/weeklyWrapup.js — Weekly Wrap-Up posted on Sunday Midnight
const cron = require('node-cron');
const { getAllUsers, getRatings, getWeeklySnapshot, setWeeklySnapshot, getConfig, setConfig } = require('../database/db');
const { buildWeeklyWrapupEmbed } = require('../utils/embeds');

async function runWeeklyWrapup(client) {
  // Try to use the rating channel as requested, fallback to dashboard
  const channelId = getConfig('rating_channel_id') || getConfig('dashboard_channel_id');
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

  for (const user of users) {
    const ratings = getRatings(user.discord_id);
    let userTotalSolved = 0;
    let userTotalRatingGain = 0;
    
    for (const r of ratings) {
      const snap = getWeeklySnapshot(user.discord_id, r.platform);
      
      const startSolved = snap ? snap.solved : r.solved;
      const startRating = snap ? snap.rating : r.rating;
      
      userTotalSolved += Math.max(0, r.solved - startSolved);
      userTotalRatingGain += (r.rating - startRating);
      
      // Save new snapshot for the next week
      setWeeklySnapshot(user.discord_id, r.platform, r.rating, r.solved, todayStr);
    }
    
    allSolved.push({
      discord_id: user.discord_id,
      solved_this_week: userTotalSolved
    });
    
    allRatingGains.push({
      discord_id: user.discord_id,
      rating_gained: userTotalRatingGain
    });
  }

  // Sort lists (solved descending, rating gain descending)
  allSolved.sort((a, b) => b.solved_this_week - a.solved_this_week);
  allRatingGains.sort((a, b) => b.rating_gained - a.rating_gained);
  
  const embed = buildWeeklyWrapupEmbed(allSolved, allRatingGains);
  
  await channel.send({ content: '@everyone', embeds: [embed] }).catch(err => {
    console.error('[WeeklyWrapUp] Failed to post wrap up:', err.message);
  });
  
  console.log('[WeeklyWrapUp] Successfully posted weekly wrap-up.');
}

function getTargetWeeklyWrapupDate() {
  const now = new Date();
  const dhakaStr = now.toLocaleString('en-US', { timeZone: 'Asia/Dhaka' });
  const dhakaDate = new Date(dhakaStr);
  const day = dhakaDate.getDay(); // 0 = Sunday, 1 = Monday...
  const hour = dhakaDate.getHours();
  
  let targetSunday = new Date(dhakaDate);
  if (day === 0) {
    if (hour < 21) {
      // Sunday before 9pm Dhaka time, target is previous Sunday
      targetSunday.setDate(dhakaDate.getDate() - 7);
    } else {
      // Sunday after 9pm, target is today
      targetSunday.setDate(dhakaDate.getDate());
    }
  } else {
    // Monday-Saturday, target is most recent Sunday
    targetSunday.setDate(dhakaDate.getDate() - day);
  }
  
  const formatterDate = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' });
  return formatterDate.format(targetSunday);
}

function startWeeklyWrapup(client) {
  // Catch-up check on boot (waits 15s to let bot fully connect)
  setTimeout(async () => {
    try {
      const targetDateStr = getTargetWeeklyWrapupDate();
      const lastWrapupDate = getConfig('last_weekly_wrapup_date');
      
      console.log(`[WeeklyWrapUp] Startup check: last wrap-up date is ${lastWrapupDate}, target is ${targetDateStr}`);
      
      if (lastWrapupDate !== targetDateStr) {
        console.log(`[WeeklyWrapUp] Startup catch-up check: Wrap-up for Sunday ${targetDateStr} not posted yet. Posting...`);
        await runWeeklyWrapup(client);
        setConfig('last_weekly_wrapup_date', targetDateStr);
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
