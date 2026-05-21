// tasks/weeklyWrapup.js — Weekly Wrap-Up posted on Sunday Midnight
const cron = require('node-cron');
const { getAllUsers, getRatings, getWeeklySnapshot, setWeeklySnapshot, getConfig } = require('../database/db');
const { buildWeeklyWrapupEmbed } = require('../utils/embeds');

async function runWeeklyWrapup(client) {
  // Try to use the rating channel as requested, fallback to dashboard
  const channelId = getConfig('rating_channel_id') || getConfig('dashboard_channel_id');
  if (!channelId) {
    console.log('[WeeklyWrapUp] No channel configured to post wrap up.');
    return;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  const users = getAllUsers();
  
  const allSolved = [];
  const allRatingGains = [];
  
  // Format the date for the new snapshot
  const formatterDate = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' });
  const todayStr = formatterDate.format(new Date());

  for (const user of users) {
    const ratings = getRatings(user.discord_id);
    let userTotalSolved = 0;
    
    for (const r of ratings) {
      const snap = getWeeklySnapshot(user.discord_id, r.platform);
      
      const startSolved = snap ? snap.solved : r.solved; // If no snap, they solved 0 this week (newly tracked)
      const startRating = snap ? snap.rating : r.rating;
      
      const solvedThisWeek = Math.max(0, r.solved - startSolved);
      userTotalSolved += solvedThisWeek;
      
      const ratingGained = r.rating - startRating;
      if (ratingGained > 0) {
        allRatingGains.push({
          discord_id: user.discord_id,
          platform: r.platform,
          rating_gained: ratingGained
        });
      }
      
      // Save new snapshot for the next week
      setWeeklySnapshot(user.discord_id, r.platform, r.rating, r.solved, todayStr);
    }
    
    if (userTotalSolved > 0) {
      allSolved.push({
        discord_id: user.discord_id,
        solved_this_week: userTotalSolved
      });
    }
  }

  // Sort and get top 5
  allSolved.sort((a, b) => b.solved_this_week - a.solved_this_week);
  allRatingGains.sort((a, b) => b.rating_gained - a.rating_gained);
  
  const topSolved = allSolved.slice(0, 5);
  const topRating = allRatingGains.slice(0, 5);

  const embed = buildWeeklyWrapupEmbed(topSolved, topRating);
  
  await channel.send({ content: '@everyone', embeds: [embed] }).catch(err => {
    console.error('[WeeklyWrapUp] Failed to post wrap up:', err.message);
  });
  
  console.log('[WeeklyWrapUp] Successfully posted weekly wrap-up.');
}

function startWeeklyWrapup(client) {
  // Runs every Sunday at 21:00 (9:00 PM) in Asia/Dhaka time
  cron.schedule('0 21 * * 0', async () => {
    try {
      console.log('[WeeklyWrapUp] Sunday 9 PM triggered! Generating wrap up...');
      await runWeeklyWrapup(client);
    } catch (err) {
      console.error('[WeeklyWrapUp] Error:', err.message);
    }
  }, { timezone: 'Asia/Dhaka' });
  
  console.log('[WeeklyWrapUp] Started Sunday 9 PM cron scheduler.');
}

module.exports = { startWeeklyWrapup, runWeeklyWrapup };
