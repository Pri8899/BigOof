// tasks/ratingSync.js — Hourly rating sync + dashboard update + rating change alerts
const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');
const {
  getAllUsers, upsertRating, getAllRatings,
  getRatings, getConfig, setConfig,
  insertRatingHistory, upsertStreak, getAllStreaks
} = require('../database/db');
const { getCFUser }              = require('../utils/codeforces');
const { getACUser }              = require('../utils/atcoder');
const { buildDashboardEmbed } = require('../utils/embeds');
const { computeLeaderboard }  = require('../commands/leaderboard');

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

  const platformName = { cf: 'Codeforces 🔵', ac: 'AtCoder 🔴' }[platform] ?? platform;

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
  console.log(`[RatingSync] Syncing ratings for ${users.length} users...`);

  for (const user of users) {
    const existing = {};
    for (const r of getRatings(user.discord_id)) existing[r.platform] = r;

    const tasks = [];

    if (user.cf_handle) {
      tasks.push(
        getCFUser(user.cf_handle).then(async stats => {
          if (!stats) return;
          const oldRating = existing['cf']?.rating ?? 0;
          upsertRating(user.discord_id, 'cf', stats);
          insertRatingHistory(user.discord_id, 'cf', stats.rating);
          if (client && oldRating && oldRating !== stats.rating) {
            await postRatingChange(client, user.discord_id, user.username, 'cf', oldRating, stats.rating, stats.rank_title, stats.lastContest);
          }
        }).catch(err => console.error(`[RatingSync] CF error ${user.cf_handle}:`, err.message))
      );
    }

    if (user.ac_handle) {
      tasks.push(
        getACUser(user.ac_handle).then(async stats => {
          if (!stats) return;
          const oldRating = existing['ac']?.rating ?? 0;
          upsertRating(user.discord_id, 'ac', stats);
          insertRatingHistory(user.discord_id, 'ac', stats.rating);
          if (client && oldRating && oldRating !== stats.rating) {
            await postRatingChange(client, user.discord_id, user.username, 'ac', oldRating, stats.rating, stats.rank_title, stats.lastContest);
          }
        }).catch(err => console.error(`[RatingSync] AC error ${user.ac_handle}:`, err.message))
      );
    }

    await Promise.all(tasks);
    await new Promise(r => setTimeout(r, 500)); // stagger
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
    const rows    = computeLeaderboard(users, ratings);
    const embed   = buildDashboardEmbed(rows, streaks);

    // Fetch recent messages in the channel to find any existing dashboard messages sent by the bot
    let existingMessages = [];
    try {
      const messages = await channel.messages.fetch({ limit: 50 });
      // Filter for messages sent by the bot that have the dashboard/leaderboard embed title
      existingMessages = [...messages.values()].filter(m => 
        m.author.id === client.user.id && 
        m.embeds.length > 0 && 
        (m.embeds[0].title?.includes('Leaderboard') || m.embeds[0].title?.includes('🏅 CP Server Leaderboard'))
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
      // Edit existing message instead of deleting and sending new!
      await msg.edit({ embeds: [embed] }).catch(async err => {
        if (err.message && err.message.includes('GOAWAY')) {
          console.warn('[Dashboard] Got GOAWAY on edit, retrying in 1 second...');
          await new Promise(r => setTimeout(r, 1000));
          return msg.edit({ embeds: [embed] }).catch(e => {
            console.error('[Dashboard] Message edit retry error:', e.message);
          });
        }
        console.error('[Dashboard] Message edit error:', err.message);
      });
      console.log('[Dashboard] Refreshed existing dashboard message.');
    } else {
      // Send a new message if it doesn't exist (with auto-retry for GOAWAY)
      const newMsg = await channel.send({ embeds: [embed] }).catch(async err => {
        if (err.message && err.message.includes('GOAWAY')) {
          console.warn('[Dashboard] Got GOAWAY on send, retrying in 1 second...');
          await new Promise(r => setTimeout(r, 1000));
          return channel.send({ embeds: [embed] }).catch(e => {
            console.error('[Dashboard] Message send retry error:', e.message);
            return null;
          });
        }
        console.error('[Dashboard] Message send error:', err.message);
        return null;
      });

      if (newMsg) {
        setConfig('dashboard_message_id', newMsg.id);
        console.log('[Dashboard] Created new dashboard message.');
      }
    }
  } catch (err) {
    console.error('[Dashboard] updateDashboard critical error:', err);
  }
}

// ─── Scheduler ───────────────────────────────────────────────
function startRatingSync(client) {
  const syncOnStartup = async () => {
    try {
      const lastSyncStr = getConfig('last_rating_sync_time');
      const lastSync = lastSyncStr ? parseInt(lastSyncStr, 10) : 0;
      const now = Math.floor(Date.now() / 1000);

      if (now - lastSync >= 3600) {
        console.log(`[RatingSync] Startup trigger: last sync was ${now - lastSync}s ago. Syncing ratings...`);
        await syncAllRatings(client);
        await updateDashboard(client);
        setConfig('last_rating_sync_time', now.toString());
      } else {
        console.log(`[RatingSync] Startup trigger: last sync was only ${now - lastSync}s ago. Loading dashboard from cache...`);
        await updateDashboard(client);
      }
    } catch (err) {
      console.error('[RatingSync Startup Error]', err);
    }
  };

  // Wait 10 seconds on startup to let the Discord REST HTTP/2 session establish
  setTimeout(() => {
    syncOnStartup();
  }, 10000);

  // Robust hourly checker: runs every 60 seconds
  // Immune to system/laptop sleep-wake cycles, container spin-downs, and timezone/drift errors.
  setInterval(async () => {
    try {
      const lastSyncStr = getConfig('last_rating_sync_time');
      const lastSync = lastSyncStr ? parseInt(lastSyncStr, 10) : 0;
      const now = Math.floor(Date.now() / 1000);
      
      // If 1 hour (3600 seconds) has elapsed since the last successful sync
      if (now - lastSync >= 3600) {
        console.log(`[RatingSync] Hourly check triggered: last sync was ${now - lastSync}s ago. Syncing...`);
        await syncAllRatings(client);
        await updateDashboard(client);
        setConfig('last_rating_sync_time', now.toString());
      }
    } catch (err) {
      console.error('[RatingSync Hourly Check Error]', err);
    }
  }, 60000);

  console.log('[RatingSync] Sleep-resistant, fail-safe scheduler started (guaranteed hourly).');
}

module.exports = { startRatingSync, syncAllRatings, updateDashboard };
