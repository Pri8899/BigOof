// tasks/ratingSync.js — Hourly rating sync + dashboard update + rating change alerts
const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');
const axios = require('axios');
const {
  getAllUsers, upsertRating, getAllRatings,
  getRatings, getConfig, setConfig,
  insertRatingHistory, upsertStreak, getAllStreaks
} = require('../database/db');
const { getCFUser }              = require('../utils/codeforces');
const { getACUser }              = require('../utils/atcoder');
const { buildDashboardEmbed } = require('../utils/embeds');
const { computeLeaderboard }  = require('../commands/leaderboard');

const CF_BASE = 'https://codeforces.com/api';

const STREAK_ROLES = [
  { name: '💫 30+ Day Streak', min: 30, color: 0xE0115F }, // Ruby
  { name: '👑 15+ Day Streak', min: 15, color: 0xF1C40F }, // Gold
  { name: '🔥 7+ Day Streak',  min: 7,  color: 0xE67E22 }  // Orange
];

const CF_ROLES = [
  { name: 'Legendary Grandmaster', min: 3000, color: 0xFF0000 },
  { name: 'International Grandmaster', min: 2600, color: 0xFF0000 },
  { name: 'Grandmaster', min: 2400, color: 0xFF0000 },
  { name: 'International Master', min: 2300, color: 0xFF8C00 },
  { name: 'Master', min: 2100, color: 0xFF8C00 },
  { name: 'Candidate Master', min: 1900, color: 0xAA00AA },
  { name: 'Expert', min: 1600, color: 0x0000FF },
  { name: 'Specialist', min: 1400, color: 0x03A89E },
  { name: 'Pupil', min: 1200, color: 0x008000 },
  { name: 'Newbie', min: 0, color: 0x808080 }
];

// ─── Auto-Rank Roles ─────────────────────────────────────────
async function updateDiscordRole(client, discordId, rating) {
  if (!client) return;
  const targetRoleData = CF_ROLES.find(r => rating >= r.min) || CF_ROLES[CF_ROLES.length - 1];
  
  for (const guild of client.guilds.cache.values()) {
    try {
      const member = await guild.members.fetch(discordId).catch(() => null);
      if (!member) continue;

      let targetRole = guild.roles.cache.find(r => r.name === targetRoleData.name);
      if (!targetRole) {
        targetRole = await guild.roles.create({
          name: targetRoleData.name,
          color: targetRoleData.color,
          reason: 'Auto-created CF Rank Role'
        });
      }

      if (!member.roles.cache.has(targetRole.id)) {
        await member.roles.add(targetRole).catch(() => {});
      }

      for (const roleDef of CF_ROLES) {
        if (roleDef.name !== targetRoleData.name) {
          const roleToRemove = guild.roles.cache.find(r => r.name === roleDef.name);
          if (roleToRemove && member.roles.cache.has(roleToRemove.id)) {
            await member.roles.remove(roleToRemove).catch(() => {});
          }
        }
      }
    } catch (err) {
      console.error(`[RoleSync] Error for ${discordId}:`, err.message);
    }
  }
}

// ─── Rating Change Alert ─────────────────────────────────────
async function postRatingChange(client, discordId, username, platform, oldRating, newRating, rankTitle, lastContest) {
  const channelId = getConfig('rating_channel_id') || process.env.RATING_CHANNEL_ID;
  if (!channelId || oldRating === newRating) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  const diff   = newRating - oldRating;
  const arrow  = diff > 0 ? '📈' : '📉';
  const sign   = diff > 0 ? `+${diff}` : `${diff}`;
  const color  = diff > 0 ? 0x2ECC71 : 0xE74C3C;

  const { getPlatformEmojis } = require('../utils/emojis');
  const emojis = await getPlatformEmojis(channel.guild);
  const platformName = { cf: `Codeforces ${emojis.cf}`, ac: `AtCoder ${emojis.ac}` }[platform] ?? platform;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${arrow} Rating Update — ${username}`)
    .setDescription(`**${platformName}**\n\`\`\`diff\n${oldRating} → ${newRating}  (${sign})\n\`\`\``)
    .addFields({ name: '🏅 Current Rank', value: rankTitle ?? 'Unrated', inline: true })
    .setTimestamp();

  if (lastContest) {
    embed.addFields({
      name: '🏆 Last Contest',
      value: `**${lastContest.contestName}**\nPlace: \`#${lastContest.rank}\``,
      inline: false
    });
  }

  await channel.send({ content: `<@${discordId}>`, embeds: [embed] }).catch(() => {});
}

// ─── Sync All Ratings ────────────────────────────────────────
async function syncAllRatings(client) {
  const users = getAllUsers();
  console.log(`[RatingSync] Syncing ratings and streaks for ${users.length} users...`);

  for (const user of users) {
    const existing = {};
    for (const r of getRatings(user.discord_id)) existing[r.platform] = r;

    if (user.cf_handle) {
      try {
        const stats = await getCFUser(user.cf_handle);
        if (stats) {
          const hasExisting = existing['cf'] !== undefined;
          const oldRating = existing['cf']?.rating ?? 0;
          upsertRating(user.discord_id, 'cf', stats);
          insertRatingHistory(user.discord_id, 'cf', stats.rating);
          if (client) {
            await updateDiscordRole(client, user.discord_id, stats.rating);
            if (hasExisting && oldRating !== stats.rating) {
              await postRatingChange(client, user.discord_id, user.username, 'cf', oldRating, stats.rating, stats.rank_title, stats.lastContest);
            }
          }
        }
      } catch (err) {
        console.error(`[RatingSync] CF error ${user.cf_handle}:`, err.message);
      }

      await new Promise(r => setTimeout(r, 2500)); // Rate limit safety

      try {
        const streakInfo = await calculateCFStreak(user.cf_handle);
        upsertStreak(user.discord_id, 'cf', streakInfo.current, streakInfo.max, new Date().toISOString().split('T')[0]);
        if (client) {
          await updateDiscordStreakRole(client, user.discord_id, streakInfo.current);
        }
      } catch (err) {
        console.error(`[RatingSync] CF streak error for ${user.cf_handle}:`, err.message);
      }

      await new Promise(r => setTimeout(r, 2500)); // Rate limit safety
    }

    if (user.ac_handle) {
      try {
        const stats = await getACUser(user.ac_handle);
        if (stats) {
          const hasExisting = existing['ac'] !== undefined;
          const oldRating = existing['ac']?.rating ?? 0;
          upsertRating(user.discord_id, 'ac', stats);
          insertRatingHistory(user.discord_id, 'ac', stats.rating);
          if (client && hasExisting && oldRating !== stats.rating) {
            await postRatingChange(client, user.discord_id, user.username, 'ac', oldRating, stats.rating, stats.rank_title, stats.lastContest);
          }
        }
      } catch (err) {
        console.error(`[RatingSync] AC error ${user.ac_handle}:`, err.message);
      }

      await new Promise(r => setTimeout(r, 2500)); // Rate limit safety
    }
  }

  console.log('[RatingSync] Sync complete.');
}

// ─── Update Dashboard ────────────────────────────────────────
async function updateDashboard(client) {
  try {
    const channelId = getConfig('dashboard_channel_id') || process.env.DASHBOARD_CHANNEL_ID;
    if (!channelId) return;

    const channel = await client.channels.fetch(channelId).catch(err => {
      console.error('[Dashboard] Channel fetch error:', err.message);
      return null;
    });
    if (!channel) return;

    const users   = getAllUsers();
    const ratings = getAllRatings();
    const streaks = getAllStreaks();
    const rows    = computeLeaderboard(users, ratings, streaks);
    const { getPlatformEmojis } = require('../utils/emojis');
    const emojis  = await getPlatformEmojis(channel.guild);
    const embed   = buildDashboardEmbed(rows, streaks, emojis);

    // Fetch recent messages in the channel to find any existing dashboard messages sent by the bot
    let existingMessages = [];
    try {
      const messages = await channel.messages.fetch({ limit: 50 });
      // Filter for messages sent by the bot that have the dashboard/leaderboard embed title or description
      existingMessages = [...messages.values()].filter(m => 
        m.author.id === client.user.id && 
        m.embeds.length > 0 && 
        ((m.embeds[0].title && (m.embeds[0].title.includes('Leaderboard') || m.embeds[0].title.includes('🏅 CP Server Leaderboard'))) ||
         (m.embeds[0].description && (m.embeds[0].description.includes('Leaderboard') || m.embeds[0].description.includes('🏅 CP Server Leaderboard'))))
      );
    } catch (err) {
      console.warn('[Dashboard] Failed to fetch recent channel messages:', err.message);
    }

    let msg = null;
    if (existingMessages.length > 0) {
      // Sort existingMessages by creation time descending (newest first)
      existingMessages.sort((a, b) => b.createdTimestamp - a.createdTimestamp);
      
      // Use the newest one as our primary message to edit
      msg = existingMessages[0];
      setConfig('dashboard_message_id', msg.id);

      // Clean up any extra/duplicate dashboard messages to enforce exactly one message in the channel
      if (existingMessages.length > 1) {
        console.log(`[Dashboard] Found ${existingMessages.length} dashboard messages. Cleaning up duplicates...`);
        for (let i = 1; i < existingMessages.length; i++) {
          await existingMessages[i].delete().catch(() => {});
        }
      }
    }

    if (msg) {
      // Delete the old message — new one will be posted below
      await msg.delete().catch(() => {});
      console.log('[Dashboard] Deleted old dashboard message.');
    }

    // Post fresh — retry until it succeeds so the channel is never left empty
    let newMsg = null;
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        newMsg = await channel.send({ embeds: [embed] });
        break; // success
      } catch (err) {
        console.warn(`[Dashboard] Send attempt ${attempt}/10 failed: ${err.message}`);
        if (attempt < 10) await new Promise(r => setTimeout(r, 5000)); // wait 5s before retry
      }
    }

    if (newMsg) {
      setConfig('dashboard_message_id', newMsg.id);
      console.log('[Dashboard] Created new dashboard message.');
    } else {
      console.error('[Dashboard] Failed to post dashboard after 10 attempts!');
    }
  } catch (err) {
    console.error('[Dashboard] updateDashboard critical error:', err);
  }
}

// ─── Scheduler ───────────────────────────────────────────────
function startRatingSync(client) {
  // Run immediately on boot
  setTimeout(async () => {
    try {
      console.log(`[RatingSync] Startup trigger: Syncing ratings and updating dashboard...`);
      await syncAllRatings(client);
      await updateDashboard(client);
    } catch (err) {
      console.error('[RatingSync Startup Error]', err);
    }
  }, 10000);

  // Hourly check for rating changes (runs at minute 30 of every hour)
  cron.schedule('30 * * * *', async () => {
    try {
      console.log(`[RatingSync] Hourly rating sync triggered.`);
      await syncAllRatings(client);
    } catch (err) {
      console.error('[RatingSync Hourly Cron Error]', err);
    }
  });

  // Exactly at 9:00 AM every morning in Asia/Dhaka time
  cron.schedule('0 9 * * *', async () => {
    try {
      console.log(`[Dashboard] Scheduled 9 AM dashboard update triggered.`);
      // Sync ratings before updating dashboard to ensure it's fresh
      await syncAllRatings(client);
      await updateDashboard(client);
    } catch (err) {
      console.error('[Dashboard 9AM Cron Error]', err);
    }
  }, { timezone: 'Asia/Dhaka' });

  console.log('[RatingSync] Strict cron scheduler started (Hourly rating sync + 9 AM Dashboard update).');
}

/**
 * Calculate the current and maximum consecutive days a Codeforces user has submitted at least one problem (any verdict).
 * Dates are calculated in UTC time to match Codeforces profile activity calendar and streaks.
 */
async function calculateCFStreak(handle) {
  try {
    const res = await axios.get(`${CF_BASE}/user.status?handle=${handle}&from=1&count=2000`, { timeout: 12000 });
    if (res.data.status !== 'OK') return { current: 0, max: 0 };

    const solvedDates = new Set();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Dhaka',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });

    const formatDate = (d) => {
      const parts = formatter.formatToParts(d);
      const partMap = {};
      for (const part of parts) {
        partMap[part.type] = part.value;
      }
      return `${partMap.year}-${partMap.month}-${partMap.day}`;
    };

    for (const sub of res.data.result) {
      if (sub.problem) {
        const date = new Date(sub.creationTimeSeconds * 1000);
        solvedDates.add(formatDate(date));
      }
    }

    if (solvedDates.size === 0) return { current: 0, max: 0 };

    const sortedDates = Array.from(solvedDates).sort();

    // Calculate current active streak in Dhaka time
    const nowLocal = new Date();
    const todayStr = formatDate(nowLocal);
    
    const yesterday = new Date(nowLocal);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = formatDate(yesterday);

    let currentStreak = 0;
    let checkDate = new Date(nowLocal);

    if (solvedDates.has(todayStr)) {
      while (true) {
        const checkStr = formatDate(checkDate);
        if (solvedDates.has(checkStr)) {
          currentStreak++;
          checkDate.setDate(checkDate.getDate() - 1);
        } else {
          break;
        }
      }
    } else if (solvedDates.has(yesterdayStr)) {
      checkDate.setDate(checkDate.getDate() - 1);
      while (true) {
        const checkStr = formatDate(checkDate);
        if (solvedDates.has(checkStr)) {
          currentStreak++;
          checkDate.setDate(checkDate.getDate() - 1);
        } else {
          break;
        }
      }
    }

    // Calculate max streak in the last 30 days to match the "X days in a row for the last month" CF text
    const thirtyDaysAgo = Date.now() - 30 * 24 * 3600 * 1000;
    const recentDates = sortedDates.filter(dateStr => {
      const parts = dateStr.split('-');
      const time = Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      return time >= thirtyDaysAgo;
    });

    let maxRecentStreak = 0;
    let tempStreak = 0;
    let prevTime = null;

    for (const dateStr of recentDates) {
      const parts = dateStr.split('-');
      const currTime = Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));

      if (prevTime === null) {
        tempStreak = 1;
      } else {
        const diffDays = Math.round((currTime - prevTime) / (24 * 3600 * 1000));
        if (diffDays === 1) {
          tempStreak++;
        } else if (diffDays > 1) {
          maxRecentStreak = Math.max(maxRecentStreak, tempStreak);
          tempStreak = 1;
        }
      }
      prevTime = currTime;
    }
    maxRecentStreak = Math.max(maxRecentStreak, tempStreak);

    // Final display streak is the maximum of their active streak and recent 30-day streak
    const displayStreak = Math.max(currentStreak, maxRecentStreak);

    // Calculate max streak in history (all-time)
    let maxStreak = 0;
    let tempMax = 0;
    let prevMaxTime = null;

    for (const dateStr of sortedDates) {
      const parts = dateStr.split('-');
      const currTime = Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));

      if (prevMaxTime === null) {
        tempMax = 1;
      } else {
        const diffDays = Math.round((currTime - prevMaxTime) / (24 * 3600 * 1000));
        if (diffDays === 1) {
          tempMax++;
        } else if (diffDays > 1) {
          maxStreak = Math.max(maxStreak, tempMax);
          tempMax = 1;
        }
      }
      prevMaxTime = currTime;
    }
    maxStreak = Math.max(maxStreak, tempMax);

    return { current: displayStreak, max: maxStreak };
  } catch (err) {
    console.error(`[StreakCalc] Error calculating streak for ${handle}:`, err.message);
    return { current: 0, max: 0 };
  }
}

/**
 * Assign the target streak milestone role to a Discord member and remove any others to avoid duplicates.
 */
async function updateDiscordStreakRole(client, discordId, currentStreak) {
  const targetRoleData = STREAK_ROLES.find(r => currentStreak >= r.min);
  
  for (const guild of client.guilds.cache.values()) {
    try {
      const member = await guild.members.fetch(discordId).catch(() => null);
      if (!member) continue;

      let targetRole = null;
      if (targetRoleData) {
        targetRole = guild.roles.cache.find(r => r.name === targetRoleData.name);
        if (!targetRole) {
          targetRole = await guild.roles.create({
            name: targetRoleData.name,
            color: targetRoleData.color,
            reason: 'Auto-created Streak Role'
          });
        }
      }

      // Add target role if they don't have it
      if (targetRole && !member.roles.cache.has(targetRole.id)) {
        await member.roles.add(targetRole).catch(() => {});
      }

      // Remove all other streak roles (prevent duplicates)
      for (const roleDef of STREAK_ROLES) {
        if (!targetRoleData || roleDef.name !== targetRoleData.name) {
          const roleToRemove = guild.roles.cache.find(r => r.name === roleDef.name);
          if (roleToRemove && member.roles.cache.has(roleToRemove.id)) {
            await member.roles.remove(roleToRemove).catch(() => {});
          }
        }
      }
    } catch (err) {
      console.error(`[StreakRoleSync] Error syncing roles for ${discordId} in guild ${guild.id}:`, err.message);
    }
  }
}

module.exports = { startRatingSync, syncAllRatings, updateDashboard };
