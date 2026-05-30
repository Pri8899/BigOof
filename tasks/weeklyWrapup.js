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

// One-time weekly reset to clean up old leaderboard messages and regenerate with new layout
async function runOneTimeWeeklyReset(client) {
  try {
    const { getConfig, setConfig, db } = require('../database/db');
    const resetWeeklyDone = getConfig('reset_weekly_layout_done');
    if (resetWeeklyDone === 'true') return;

    console.log('[WeeklyReset] Running one-time weekly wrap-up layout reset...');

    // 1. Fetch channel and delete the previous wrap-up message
    const channelId = getConfig('rating_channel_id') || getConfig('dashboard_channel_id');
    if (channelId) {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (channel) {
        const messages = await channel.messages.fetch({ limit: 50 }).catch(() => []);
        const targetMessages = [...messages.values()].filter(m => 
          m.author.id === client.user.id &&
          m.embeds.length > 0 &&
          (m.embeds[0].title?.includes('WEEKLY CP HALL OF FAME') || m.embeds[0].title?.includes('Weekly CP Wrap-Up') || m.embeds[0].title?.includes('CP SERVER WEEKLY CHAMPIONS'))
        );

        for (const msg of targetMessages) {
          await msg.delete().catch(() => {});
          console.log(`[WeeklyReset] Deleted old weekly wrap-up message: ${msg.id}`);
        }
      }
    }

    // 2. Clear last_weekly_wrapup_date so catch-up triggers immediately
    setConfig('last_weekly_wrapup_date', 'null_reset');

    // 3. Mark reset as done
    setConfig('reset_weekly_layout_done', 'true');
    console.log('[WeeklyReset] One-time weekly wrap-up reset complete.');
  } catch (err) {
    console.error('[WeeklyReset Error]', err);
  }
}

function startWeeklyWrapup(client) {
  // Catch-up check on boot (waits 15s to let bot fully connect)
  setTimeout(async () => {
    try {
      // 1. Run layout reset first
      await runOneTimeWeeklyReset(client);

      // 2. Then perform the catch-up check
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
