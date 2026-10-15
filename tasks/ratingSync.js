// tasks/ratingSync.js — Hourly rating sync + dashboard update + rating change alerts
const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');
const axios = require('axios');
const {
  getAllUsers, upsertRating, getAllRatings,
  getRatings, getConfig, setConfig,
  insertRatingHistory, upsertStreak, getAllStreaks
} = require('../database/db');
const { getCFUser, getRatingTitle } = require('../utils/codeforces');
const { getValidId, getTargetChannel } = require('../utils/envHelper');

const { getACUser }              = require('../utils/atcoder');
const { getTophUser, calculateTophStreak } = require('../utils/toph');
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
  if (oldRating === newRating) return;

  const diff  = newRating - oldRating;
  const isUp  = diff > 0;
  const sign  = isUp ? `+${diff}` : `${diff}`;
  const color = isUp ? 0x2ECC71 : 0xE74C3C;
  const trend = isUp ? '📈' : '📉';
  const bar   = isUp
    ? '🟩'.repeat(Math.min(5, Math.ceil(Math.abs(diff) / 50)))
    : '🟥'.repeat(Math.min(5, Math.ceil(Math.abs(diff) / 50)));

  const motiveLine = isUp
    ? `> 🎉 Amazing performance! Keep it up!\n`
    : `> 💪 Losses are lessons. Come back stronger!\n`;

  const { getPlatformEmojis } = require('../utils/emojis');

  for (const guild of client.guilds.cache.values()) {
    const isMember = guild.members.cache.has(discordId);
    if (!isMember) continue;

    const channel = await getTargetChannel(client, 'rating_channel_id', 'RATING_CHANNEL_ID', guild.id);
    if (!channel) continue;

    const emojis = await getPlatformEmojis(guild);
    const platEmoji = { cf: emojis.cf || '🔵', ac: emojis.ac || '🔴', toph: emojis.toph || '🟣' }[platform] ?? '🔵';
    const platName  = { cf: 'Codeforces', ac: 'AtCoder', toph: 'Toph' }[platform] ?? platform;

    const desc =
      `╭─ 👤 **Member**: <@${discordId}> (\`${username}\`)\n` +
      `├─ 🌐 **Platform**: ${platEmoji} **${platName}**\n` +
      `├─ 🏅 **Rank Tier**: **${rankTitle}**\n` +
      (lastContest ? `├─ 🏆 **Contest**: ${lastContest}\n` : '') +
      `╰─ 📊 **Rating Shift**: **${sign}** (\`${oldRating}\` ➔ \`${newRating}\`)\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      motiveLine;

    const platIcon = platform === 'cf'
      ? 'https://codeforces.org/s/0/images/codeforces-telegram-square.png'
      : platform === 'ac'
        ? 'https://img.atcoder.jp/assets/logo.png'
        : 'https://toph.co/images/appleicon.png';

    const embed = new EmbedBuilder()
      .setColor(color)
      .setAuthor({
        name: `${username} · ${platName} Rating Shift`,
        iconURL: platIcon
      })
      .setTitle(`${trend} ${isUp ? 'Rating Surge' : 'Rating Adjustment'}: ${sign} pts`)
      .setDescription(desc)
      .setFooter({ text: `BigOof Rating Engine · ${platName} Live Sync`, iconURL: platIcon })
      .setTimestamp();

    await channel.send({ content: `📣 <@${discordId}>`, embeds: [embed] }).catch(() => {});
  }
}



// Track last streak sync time so streaks only update once per hour
let lastStreakSyncTime = 0;

// ─── Sync All Ratings ────────────────────────────────────────
async function syncAllRatings(client) {
  const users = getAllUsers();
  console.log(`[RatingSync] Syncing ratings and streaks for ${users.length} users...`);

  const now = Date.now();
  const doStreaks = (now - lastStreakSyncTime) >= 60 * 60 * 1000; // Only every 1 hour
  if (doStreaks) lastStreakSyncTime = now;
  let ratingChanged = false;

  for (const user of users) {
    const existing = {};
    for (const r of getRatings(user.discord_id)) existing[r.platform] = r;

    if (user.cf_handle) {
      try {
        const stats = await getCFUser(user.cf_handle);
        if (stats) {
          const hasExisting = existing['cf'] !== undefined;
          const oldRating = existing['cf']?.rating ?? 0;
          const oldSolved = existing['cf']?.solved ?? 0;
          
          // Safety: Prevent API glitches from clearing rating or solved count
          if (stats.solved === undefined || stats.solved === null) stats.solved = oldSolved;
          if (stats.rating === 0 && oldRating > 0) stats.rating = oldRating;

          upsertRating(user.discord_id, 'cf', stats);
          insertRatingHistory(user.discord_id, 'cf', stats.rating);
          if (client) {
            await updateDiscordRole(client, user.discord_id, stats.rating);
            if (hasExisting && oldRating !== stats.rating) {
              ratingChanged = true;
              await postRatingChange(client, user.discord_id, user.username, 'cf', oldRating, stats.rating, stats.rank_title, stats.lastContest);
            } else if (hasExisting && stats.solved > oldSolved) {
              // Solve count increased — refresh dashboard
              ratingChanged = true;
            }
          }
        }
      } catch (err) {
        console.error(`[RatingSync] CF error ${user.cf_handle}:`, err.message);
      }

      await new Promise(r => setTimeout(r, 2500)); // Rate limit safety

      if (doStreaks) {
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
    }

    if (user.ac_handle) {
      if (doStreaks) {
        try {
          const streakInfo = await calculateACStreak(user.ac_handle);
          if (streakInfo && (streakInfo.current > 0 || streakInfo.max > 0)) {
            upsertStreak(user.discord_id, 'ac', streakInfo.current, streakInfo.max, new Date().toISOString().split('T')[0]);
          }
        } catch (err) {
          console.error(`[RatingSync] AC streak error for ${user.ac_handle}:`, err.message);
        }
      }

      try {
        const stats = await getACUser(user.ac_handle);
        if (stats) {
          const hasExisting = existing['ac'] !== undefined;
          const oldRating = existing['ac']?.rating ?? 0;
          const oldSolved = existing['ac']?.solved ?? 0;

          // Safety: Prevent API glitches / partial responses from dropping rating or solved count
          if (!stats.solved || stats.solved < oldSolved) stats.solved = oldSolved;
          if (stats.rating === 0 && oldRating > 0) stats.rating = oldRating;

          upsertRating(user.discord_id, 'ac', stats);
          insertRatingHistory(user.discord_id, 'ac', stats.rating);
          if (client) {
            if (hasExisting && oldRating !== stats.rating) {
              ratingChanged = true;
              await postRatingChange(client, user.discord_id, user.username, 'ac', oldRating, stats.rating, stats.rank_title, stats.lastContest);
            } else if (hasExisting && stats.solved > oldSolved) {
              ratingChanged = true;
            }
          }
        }
      } catch (err) {
        console.error(`[RatingSync] AC error ${user.ac_handle}:`, err.message);
      }

      await new Promise(r => setTimeout(r, 2500)); // Rate limit safety
    }

    if (user.toph_handle) {
      try {
        const stats = await getTophUser(user.toph_handle);
        if (stats) {
          const hasExisting = existing['toph'] !== undefined;
          const oldRating = existing['toph']?.rating ?? 0;
          const oldSolved = existing['toph']?.solved ?? 0;

          // Safety: Prevent API glitches / partial responses from dropping rating or solved count
          if (!stats.solved || stats.solved < oldSolved) stats.solved = oldSolved;
          if (stats.rating === 0 && oldRating > 0) stats.rating = oldRating;

          upsertRating(user.discord_id, 'toph', stats);
          insertRatingHistory(user.discord_id, 'toph', stats.rating);
          if (client) {
            if (hasExisting && oldRating !== stats.rating) {
              ratingChanged = true;
              await postRatingChange(client, user.discord_id, user.username, 'toph', oldRating, stats.rating, stats.rank_title, null);
            } else if (hasExisting && stats.solved > oldSolved) {
              ratingChanged = true;
            }
          }
        }
      } catch (err) {
        console.error(`[RatingSync] Toph error ${user.toph_handle}:`, err.message);
      }

      if (doStreaks) {
        try {
          const streakInfo = await calculateTophStreak(user.toph_handle);
          if (streakInfo && (streakInfo.current > 0 || streakInfo.max > 0)) {
            upsertStreak(user.discord_id, 'toph', streakInfo.current, streakInfo.max, new Date().toISOString().split('T')[0]);
          }
        } catch (err) {
          console.error(`[RatingSync] Toph streak error for ${user.toph_handle}:`, err.message);
        }
      }

      await new Promise(r => setTimeout(r, 1000)); // Rate limit safety
    }
  }

  console.log(`[RatingSync] Sync complete. Rating changed: ${ratingChanged}`);
  return ratingChanged; // caller decides whether to refresh dashboard
}

// ─── Update Dashboard ────────────────────────────────────────
async function updateDashboard(client, specificGuildId = null) {
  try {
    const { getAllGuildConfigs } = require('../database/db');
    const allUsers = getAllUsers();
    const ratings  = getAllRatings();
    const streaks  = getAllStreaks();
    const { getPlatformEmojis } = require('../utils/emojis');

    const targets = [];
    if (specificGuildId) {
      const chId = getConfig('dashboard_channel_id', specificGuildId);
      if (chId) targets.push({ guild_id: specificGuildId, value: chId });
    } else {
      const configs = getAllGuildConfigs('dashboard_channel_id');
      targets.push(...configs);
      const globalChId = getConfig('dashboard_channel_id', 'global') || process.env.DASHBOARD_CHANNEL_ID;
      if (globalChId && !targets.some(t => t.value === globalChId)) {
        targets.push({ guild_id: 'global', value: globalChId });
      }
    }

    if (targets.length === 0) return;

    for (const { guild_id, value: channelId } of targets) {
      try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel || !channel.isTextBased()) continue;

        // Filter users to members of this specific server
        const guildMembers = channel.guild.members.cache;
        const serverUsers = allUsers.filter(u => guildMembers.has(u.discord_id));

        const rows   = computeLeaderboard(serverUsers, ratings, streaks);
        const emojis = await getPlatformEmojis(channel.guild);
        const embed  = buildDashboardEmbed(rows, streaks, emojis);

        // Fetch recent messages to find previous dashboard message
        let existingMessages = [];
        try {
          const messages = await channel.messages.fetch({ limit: 25 });
          existingMessages = [...messages.values()].filter(m =>
            m.author.id === client.user.id &&
            m.embeds.length > 0 &&
            ((m.embeds[0].title && m.embeds[0].title.includes('Leaderboard')) ||
             (m.embeds[0].description && m.embeds[0].description.includes('Leaderboard')))
          );
        } catch (err) {
          console.warn(`[Dashboard] Failed to fetch messages in channel ${channelId}:`, err.message);
        }

        if (existingMessages.length > 0) {
          for (const oldMsg of existingMessages) {
            await oldMsg.delete().catch(() => {});
          }
        }

        const newMsg = await channel.send({ embeds: [embed] }).catch(err => {
          console.warn(`[Dashboard] Failed to send dashboard to channel ${channelId}: ${err.message}`);
          return null;
        });

        if (newMsg) {
          setConfig('dashboard_message_id', newMsg.id, guild_id);
          console.log(`[Dashboard] Updated dashboard in #${channel.name} (${channel.guild.name}).`);
        }
      } catch (guildErr) {
        console.error(`[Dashboard] Error updating dashboard for channel ${channelId}:`, guildErr.message);
      }
    }
  } catch (err) {
    console.error('[Dashboard] updateDashboard critical error:', err);
  }
}

// ─── Scheduler ───────────────────────────────────────────────
function startRatingSync(client) {
  let isRunning = false;

  const poll = async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      console.log(`[RatingSync] Polling ratings...`);
      const changed = await syncAllRatings(client);
      if (changed) {
        console.log('[RatingSync] Rating change detected — refreshing dashboards.');
        await updateDashboard(client);
      }
    } catch (err) {
      console.error('[RatingSync Poll Error]', err.message);
    } finally {
      isRunning = false;
    }
    setTimeout(poll, 5 * 60 * 1000);
  };

  setTimeout(async () => {
    try {
      console.log('[RatingSync] Startup dashboard refresh...');
      await updateDashboard(client);
    } catch (err) {
      console.error('[RatingSync] Startup dashboard refresh error:', err.message);
    }
  }, 5000);

  setTimeout(poll, 15000);

  const TZ = process.env.TIMEZONE || 'UTC';

  // Daily 9 AM dashboard refresh
  cron.schedule('0 9 * * *', async () => {
    try {
      console.log(`[RatingSync] Daily 9 AM dashboard refresh (${TZ}).`);
      await updateDashboard(client);
    } catch (err) {
      console.error('[RatingSync] Daily dashboard refresh error:', err.message);
    }
  }, { timezone: TZ });

  console.log(`[RatingSync] Started: ratings polled every 5 min (Timezone: ${TZ}).`);
}

function epochToDateStr(epoch, offset) {
  return new Date((epoch + offset * 3600) * 1000).toISOString().split('T')[0];
}

function todayInOffset(offset) {
  return epochToDateStr(Date.now() / 1000, offset);
}

function computeStreakFromActivity(activityMap, offset) {
  const todayStr = todayInOffset(offset);
  const todayCount = activityMap[todayStr] || 0;
  
  let streak = 0;
  let checkDate = new Date(todayStr + "T00:00:00Z");
  
  if (todayCount === 0) {
    checkDate.setUTCDate(checkDate.getUTCDate() - 1);
  }
  
  while (true) {
    const checkStr = checkDate.toISOString().split('T')[0];
    if ((activityMap[checkStr] || 0) > 0) {
      streak++;
      checkDate.setUTCDate(checkDate.getUTCDate() - 1);
    } else {
      break;
    }
  }
  
  return { streak, todayCount };
}

function calculateMaxStreakForActivity(activityMap) {
  const activeDates = Object.keys(activityMap).filter(d => activityMap[d] > 0).sort();
  if (activeDates.length === 0) return 0;
  
  let maxStreak = 0;
  let tempStreak = 0;
  let prevTime = null;
  
  for (const dateStr of activeDates) {
    const parts = dateStr.split('-');
    const currTime = Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    
    if (prevTime === null) {
      tempStreak = 1;
    } else {
      const diffDays = Math.round((currTime - prevTime) / (24 * 3600 * 1000));
      if (diffDays === 1) {
        tempStreak++;
      } else if (diffDays > 1) {
        maxStreak = Math.max(maxStreak, tempStreak);
        tempStreak = 1;
      }
    }
    prevTime = currTime;
  }
  maxStreak = Math.max(maxStreak, tempStreak);
  return maxStreak;
}

/**
 * Calculate the current and maximum consecutive days a Codeforces user has submitted at least one problem (any verdict).
 * Timezone-agnostic offset search is used to match Codeforces profile activity calendar and streaks exactly.
 */
function getTzOffsetHours() {
  try {
    const tz = process.env.TIMEZONE || 'UTC';
    const now = new Date();
    const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
    const tzDate = new Date(now.toLocaleString('en-US', { timeZone: tz }));
    return Math.round((tzDate.getTime() - utcDate.getTime()) / 3600000);
  } catch (_) {
    return 0;
  }
}

async function calculateCFStreak(handle) {
  try {
    const res = await axios.get(`${CF_BASE}/user.status?handle=${handle}&from=1&count=2000`, { timeout: 12000 });
    if (res.data.status !== 'OK') return { current: 0, max: 0 };

    const subs = res.data.result.filter(sub => sub.creationTimeSeconds);

    const offset = getTzOffsetHours();
    const activityMap = {};
    for (const sub of subs) {
      const dStr = epochToDateStr(sub.creationTimeSeconds, offset);
      activityMap[dStr] = (activityMap[dStr] || 0) + 1;
    }

    const current = computeStreakFromActivity(activityMap, offset).streak;
    const max = calculateMaxStreakForActivity(activityMap);

    return { current, max };
  } catch (err) {
    console.error(`[CF Streak] Error for ${handle}:`, err.message);
    return { current: 0, max: 0 };
  }
}

async function calculateACStreak(handle) {
  try {
    const allSubs = [];
    let fromSecond = 0;
    let pagesFetched = 0;
    while (pagesFetched < 50) {
      const res = await axios.get(
        `https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions?user=${handle}&from_second=${fromSecond}`,
        { timeout: 12000 }
      );
      if (!Array.isArray(res.data) || res.data.length === 0) break;
      for (const s of res.data) {
        allSubs.push(s);
      }
      if (res.data.length < 500) break;
      const maxEpoch = Math.max(...res.data.map(s => s.epoch_second));
      fromSecond = maxEpoch + 1;
      pagesFetched++;
    }

    if (allSubs.length === 0) return { current: 0, max: 0 };

    const offset = getTzOffsetHours();
    const activityMap = {};
    for (const sub of allSubs) {
      const dateStr = epochToDateStr(sub.epoch_second, offset);
      activityMap[dateStr] = (activityMap[dateStr] || 0) + 1;
    }

    const current = computeStreakFromActivity(activityMap, offset).streak;
    const max = calculateMaxStreakForActivity(activityMap);

    return { current, max };
  } catch (err) {
    console.error(`[StreakCalc] Error calculating AC streak for ${handle}:`, err.message);
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

module.exports = { startRatingSync, syncAllRatings, updateDashboard, calculateCFStreak, calculateACStreak, postRatingChange };
