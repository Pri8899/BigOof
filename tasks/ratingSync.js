// tasks/ratingSync.js — Rating/streak sync, role sync, dashboard updater, and rank alerts
const cron = require('node-cron');
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const {
  getAllUsers,
  getUser,
  upsertRating,
  getAllRatings,
  getRatings,
  insertRatingHistory,
  upsertStreak,
  getAllStreaks,
  getWeeklySnapshot,
  setWeeklySnapshot
} = require('../database/db');
const { getCFUser, getCFStatus } = require('../utils/codeforces');
const { getTargetChannel, getGuildTargetChannels, replaceChannelBotMessage } = require('../utils/envHelper');
const { getACUser, calculateACStreak } = require('../utils/atcoder');
const { getTophUser, calculateTophStreak } = require('../utils/toph');
const { buildDashboardEmbed, PLATFORM_ICONS } = require('../utils/embeds');
const { computeLeaderboard } = require('../commands/leaderboard');
const { getTimeZone, getLocalParts, calculateStreakFromTimestamps } = require('../utils/time');

const STREAK_ROLES = [
  { name: '💫 30+ Day Streak', min: 30, color: 0xE0115F },
  { name: '👑 15+ Day Streak', min: 15, color: 0xF1C40F },
  { name: '🔥 7+ Day Streak',  min: 7,  color: 0xE67E22 }
];

const CF_ROLES = [
  { name: 'Legendary Grandmaster',     min: 3000, color: 0xFF0000 },
  { name: 'International Grandmaster', min: 2600, color: 0xFF0000 },
  { name: 'Grandmaster',               min: 2400, color: 0xFF0000 },
  { name: 'International Master',      min: 2300, color: 0xFF8C00 },
  { name: 'Master',                    min: 2100, color: 0xFF8C00 },
  { name: 'Candidate Master',          min: 1900, color: 0xAA00AA },
  { name: 'Expert',                    min: 1600, color: 0x0000FF },
  { name: 'Specialist',                min: 1400, color: 0x03A89E },
  { name: 'Pupil',                     min: 1200, color: 0x008000 },
  { name: 'Newbie',                    min: 0,    color: 0x808080 }
];

function ensureInitialWeeklySnapshot(discordId, platform, stats) {
  if (!getWeeklySnapshot(discordId, platform)) {
    const { dateStr } = getLocalParts(new Date(), getTimeZone());
    setWeeklySnapshot(discordId, platform, stats.rating ?? 0, stats.solved ?? 0, dateStr);
  }
}

function canManageRole(guild, role = null) {
  const me = guild.members.me;
  if (!me || !me.permissions.has(PermissionFlagsBits.ManageRoles)) return false;
  if (!role) return true;
  return role.editable && role.position < me.roles.highest.position;
}

// ─── Auto-Rank Roles ─────────────────────────────────────────
async function updateDiscordRole(client, discordId, rating) {
  if (!client) return;
  const targetRoleData = CF_ROLES.find(r => rating >= r.min) || CF_ROLES[CF_ROLES.length - 1];

  for (const guild of client.guilds.cache.values()) {
    try {
      if (!canManageRole(guild)) continue;
      const member = guild.members.cache.get(discordId) || await guild.members.fetch(discordId).catch(() => null);
      if (!member) continue;

      let targetRole = guild.roles.cache.find(r => r.name.toLowerCase() === targetRoleData.name.toLowerCase());
      if (!targetRole) {
        targetRole = await guild.roles.create({
          name: targetRoleData.name,
          color: targetRoleData.color,
          reason: 'Auto-created CF Rank Role'
        }).catch(() => null);
      }

      if (targetRole && canManageRole(guild, targetRole) && !member.roles.cache.has(targetRole.id)) {
        await member.roles.add(targetRole).catch(() => {});
      }

      for (const roleDef of CF_ROLES) {
        if (roleDef.name.toLowerCase() !== targetRoleData.name.toLowerCase()) {
          const roleToRemove = guild.roles.cache.find(r => r.name.toLowerCase() === roleDef.name.toLowerCase());
          if (roleToRemove && canManageRole(guild, roleToRemove) && member.roles.cache.has(roleToRemove.id)) {
            await member.roles.remove(roleToRemove).catch(() => {});
          }
        }
      }
    } catch (err) {
      console.error(`[RoleSync] Error for ${discordId}:`, err.message);
    }
  }
}

async function updateDiscordStreakRole(client, discordId, currentStreak) {
  if (!client) return;
  const targetRoleData = STREAK_ROLES.find(r => currentStreak >= r.min);

  for (const guild of client.guilds.cache.values()) {
    try {
      if (!canManageRole(guild)) continue;
      const member = guild.members.cache.get(discordId) || await guild.members.fetch(discordId).catch(() => null);
      if (!member) continue;

      let targetRole = null;
      if (targetRoleData) {
        targetRole = guild.roles.cache.find(r => r.name === targetRoleData.name);
        if (!targetRole) {
          targetRole = await guild.roles.create({
            name: targetRoleData.name,
            color: targetRoleData.color,
            reason: 'Auto-created Streak Role'
          }).catch(() => null);
        }
      }

      if (targetRole && canManageRole(guild, targetRole) && !member.roles.cache.has(targetRole.id)) {
        await member.roles.add(targetRole).catch(() => {});
      }

      for (const roleDef of STREAK_ROLES) {
        if (!targetRoleData || roleDef.name !== targetRoleData.name) {
          const roleToRemove = guild.roles.cache.find(r => r.name === roleDef.name);
          if (roleToRemove && canManageRole(guild, roleToRemove) && member.roles.cache.has(roleToRemove.id)) {
            await member.roles.remove(roleToRemove).catch(() => {});
          }
        }
      }
    } catch (err) {
      console.error(`[StreakRoleSync] Error syncing roles for ${discordId}:`, err.message);
    }
  }
}

function formatContestLabel(lastContest) {
  if (!lastContest) return '';
  if (typeof lastContest === 'string') return lastContest;
  if (lastContest.contestName) {
    return lastContest.rank
      ? `${lastContest.contestName} *(Rank #${lastContest.rank})*`
      : lastContest.contestName;
  }
  return '';
}

// ─── Rating Change Alert ─────────────────────────────────────
async function postRatingChange(client, discordId, username, platform, oldRating, newRating, rankTitle, lastContest) {
  if (oldRating === newRating) return;

  const diff = newRating - oldRating;
  const isUp = diff > 0;
  const sign = isUp ? `+${diff}` : `${diff}`;
  const color = isUp ? 0x2ECC71 : 0xE74C3C;
  const trend = isUp ? '📈' : '📉';

  const motiveLine = isUp
    ? '> 🎉 Amazing performance! Keep it up!\n'
    : '> 💪 Losses are lessons. Come back stronger!\n';

  const platName = { cf: 'Codeforces', ac: 'AtCoder', toph: 'Toph' }[platform] ?? platform;
  const contestLabel = formatContestLabel(lastContest);
  const platIcon = PLATFORM_ICONS[platform] || PLATFORM_ICONS.toph;

  for (const guild of client.guilds.cache.values()) {
    const member = guild.members.cache.get(discordId) || await guild.members.fetch(discordId).catch(() => null);
    if (!member) continue;

    const channel = await getTargetChannel(client, 'rating_channel_id', 'RATING_CHANNEL_ID', guild.id);
    if (!channel) continue;

    const desc = [
      isUp
        ? `🎉 **<@${discordId}>** gained rating in the latest contest!`
        : `📉 **<@${discordId}>** completed a contest round.`,
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      `> 📊 **Rating Change:** **\`${oldRating}\` ➔ \`${newRating}\`** (**${sign} pts**)`,
      `> 🏅 **Rank Tier:** **${rankTitle}**`,
      contestLabel ? `> 🏆 **Contest:** ${contestLabel}` : '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      motiveLine
    ].filter(Boolean).join('\n');

    const embed = new EmbedBuilder()
      .setColor(color)
      .setAuthor({ name: `${username} · ${platName} Rating Shift`, iconURL: platIcon })
      .setTitle(`${trend} ${isUp ? 'Rating Surge' : 'Rating Adjustment'}: ${sign} pts`)
      .setDescription(desc)
      .setFooter({ text: `BigOof Rating Engine · ${platName} Live Sync`, iconURL: platIcon })
      .setTimestamp();

    await channel.send({ content: `📣 <@${discordId}>`, embeds: [embed] }).catch(() => {});
  }
}

// Track last streak sync time so streaks only update once per hour during global polling
let lastStreakSyncTime = 0;
let isGlobalSyncing = false;

async function syncUserRecord(client, user, { forceStreaks = false, alertOnChange = true } = {}) {
  const existing = {};
  for (const r of getRatings(user.discord_id)) existing[r.platform] = r;

  let changed = false;
  const isoToday = getLocalParts(new Date(), getTimeZone()).isoDate;

  if (user.cf_handle) {
    try {
      const stats = await getCFUser(user.cf_handle);
      if (stats) {
        const hasExisting = existing.cf !== undefined;
        const oldRating = existing.cf?.rating ?? 0;
        const oldSolved = existing.cf?.solved ?? 0;

        if (stats.solved === null || stats.solved === undefined) stats.solved = oldSolved;
        if (stats.rating === 0 && oldRating > 0) stats.rating = oldRating;

        ensureInitialWeeklySnapshot(user.discord_id, 'cf', stats);
        upsertRating(user.discord_id, 'cf', stats);
        insertRatingHistory(user.discord_id, 'cf', stats.rating);

        if (client) {
          await updateDiscordRole(client, user.discord_id, stats.rating);
          if (alertOnChange && hasExisting && oldRating !== stats.rating) {
            changed = true;
            await postRatingChange(client, user.discord_id, user.username, 'cf', oldRating, stats.rating, stats.rank_title, stats.lastContest);
          } else if (hasExisting && stats.solved > oldSolved) {
            changed = true;
          }
        }
      }
    } catch (err) {
      console.error(`[RatingSync] CF error ${user.cf_handle}:`, err.message);
    }

    await new Promise(r => setTimeout(r, 1500));

    if (forceStreaks) {
      try {
        const streakInfo = await calculateCFStreak(user.cf_handle);
        upsertStreak(user.discord_id, 'cf', streakInfo.current, streakInfo.max, isoToday);
      } catch (err) {
        console.error(`[RatingSync] CF streak error for ${user.cf_handle}:`, err.message);
      }
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  if (user.ac_handle) {
    if (forceStreaks) {
      try {
        const streakInfo = await calculateACStreak(user.ac_handle);
        upsertStreak(user.discord_id, 'ac', streakInfo.current, streakInfo.max, isoToday);
      } catch (err) {
        console.error(`[RatingSync] AC streak error for ${user.ac_handle}:`, err.message);
      }
    }

    try {
      const stats = await getACUser(user.ac_handle);
      if (stats) {
        const hasExisting = existing.ac !== undefined;
        const oldRating = existing.ac?.rating ?? 0;
        const oldSolved = existing.ac?.solved ?? 0;

        if (!stats.solved || stats.solved < oldSolved) stats.solved = oldSolved;
        if (stats.rating === 0 && oldRating > 0) stats.rating = oldRating;

        ensureInitialWeeklySnapshot(user.discord_id, 'ac', stats);
        upsertRating(user.discord_id, 'ac', stats);
        insertRatingHistory(user.discord_id, 'ac', stats.rating);

        if (client) {
          if (alertOnChange && hasExisting && oldRating !== stats.rating) {
            changed = true;
            await postRatingChange(client, user.discord_id, user.username, 'ac', oldRating, stats.rating, stats.rank_title, stats.lastContest);
          } else if (hasExisting && stats.solved > oldSolved) {
            changed = true;
          }
        }
      }
    } catch (err) {
      console.error(`[RatingSync] AC error ${user.ac_handle}:`, err.message);
    }

    await new Promise(r => setTimeout(r, 1500));
  }

  if (user.toph_handle) {
    try {
      const stats = await getTophUser(user.toph_handle);
      if (stats) {
        const hasExisting = existing.toph !== undefined;
        const oldRating = existing.toph?.rating ?? 0;
        const oldSolved = existing.toph?.solved ?? 0;

        if (!stats.solved || stats.solved < oldSolved) stats.solved = oldSolved;
        if (stats.rating === 0 && oldRating > 0) stats.rating = oldRating;

        ensureInitialWeeklySnapshot(user.discord_id, 'toph', stats);
        upsertRating(user.discord_id, 'toph', stats);
        insertRatingHistory(user.discord_id, 'toph', stats.rating);

        if (client) {
          if (alertOnChange && hasExisting && oldRating !== stats.rating) {
            changed = true;
            await postRatingChange(client, user.discord_id, user.username, 'toph', oldRating, stats.rating, stats.rank_title, null);
          } else if (hasExisting && stats.solved > oldSolved) {
            changed = true;
          }
        }
      }
    } catch (err) {
      console.error(`[RatingSync] Toph error ${user.toph_handle}:`, err.message);
    }

    if (forceStreaks) {
      try {
        const streakInfo = await calculateTophStreak(user.toph_handle);
        upsertStreak(user.discord_id, 'toph', streakInfo.current, streakInfo.max, isoToday);
      } catch (err) {
        console.error(`[RatingSync] Toph streak error for ${user.toph_handle}:`, err.message);
      }
    }

    await new Promise(r => setTimeout(r, 800));
  }

  if (client && forceStreaks) {
    const bestStreak = getAllStreaks()
      .filter(s => s.discord_id === user.discord_id)
      .reduce((mx, s) => Math.max(mx, s.current_streak || 0), 0);
    await updateDiscordStreakRole(client, user.discord_id, bestStreak);
  }

  return changed;
}

/**
 * Syncs a single freshly linked user cleanly without scanning the whole DB.
 */
async function syncSingleUser(client, discordId) {
  const user = getUser(discordId);
  if (!user) return false;
  return syncUserRecord(client, user, { forceStreaks: true, alertOnChange: false });
}

async function syncAllRatings(client) {
  if (isGlobalSyncing) {
    console.log('[RatingSync] Sync already running; skipping overlapping run.');
    return false;
  }
  isGlobalSyncing = true;

  try {
    const users = getAllUsers();
    console.log(`[RatingSync] Syncing ratings & streaks for ${users.length} users...`);

    const now = Date.now();
    const doStreaks = (now - lastStreakSyncTime) >= 60 * 60 * 1000;
    if (doStreaks) lastStreakSyncTime = now;

    let ratingChanged = false;
    for (const user of users) {
      const userChanged = await syncUserRecord(client, user, { forceStreaks: doStreaks, alertOnChange: true });
      if (userChanged) ratingChanged = true;
    }

    console.log(`[RatingSync] Sync complete. Changed: ${ratingChanged}`);
    return ratingChanged;
  } finally {
    isGlobalSyncing = false;
  }
}

// ─── Update Dashboard (deletes old embed and posts fresh one) ─
async function updateDashboard(client, specificGuildId = null) {
  try {
    const allUsers = getAllUsers();
    const ratings = getAllRatings();
    const streaks = getAllStreaks();
    const { getPlatformEmojis } = require('../utils/emojis');

    const targets = await getGuildTargetChannels(client, 'dashboard_channel_id', 'DASHBOARD_CHANNEL_ID', specificGuildId);
    if (targets.length === 0) return;

    for (const { guild_id, channel } of targets) {
      try {
        const guildMembers = channel.guild
          ? await channel.guild.members.fetch().catch(() => channel.guild.members.cache)
          : null;
        const serverUsers = guildMembers
          ? allUsers.filter(u => guildMembers.has(u.discord_id))
          : allUsers;

        const rows = computeLeaderboard(serverUsers, ratings, streaks);
        const emojis = await getPlatformEmojis(channel.guild);
        const embed = buildDashboardEmbed(rows, streaks, emojis);

        await replaceChannelBotMessage(client, channel, {
          matchMessage: (m) =>
            m.embeds.length > 0 &&
            (m.embeds[0].title?.includes('Leaderboard') ||
             m.embeds[0].title?.includes('Community Standings') ||
             m.embeds[0].author?.name?.includes('Leaderboard')),
          storedConfigKey: 'dashboard_message_id',
          guildId: guild_id,
          payload: { embeds: [embed] },
          logLabel: 'Dashboard'
        });
      } catch (guildErr) {
        console.error(`[Dashboard] Error updating #${channel.name}:`, guildErr.message);
      }
    }
  } catch (err) {
    console.error('[Dashboard] updateDashboard error:', err);
  }
}

// ─── Scheduler ───────────────────────────────────────────────
function startRatingSync(client) {
  const TZ = getTimeZone();

  const poll = async () => {
    try {
      const changed = await syncAllRatings(client);
      if (changed) {
        console.log('[RatingSync] Rating/solve change detected — refreshing dashboards.');
        await updateDashboard(client);
      }
    } catch (err) {
      console.error('[RatingSync Poll Error]', err.message);
    }
    setTimeout(poll, 5 * 60 * 1000);
  };

  setTimeout(async () => {
    try {
      console.log('[RatingSync] Startup dashboard refresh...');
      await updateDashboard(client);
    } catch (err) {
      console.error('[RatingSync] Startup refresh error:', err.message);
    }
  }, 5000);

  setTimeout(poll, 15000);

  cron.schedule('0 9 * * *', async () => {
    try {
      console.log(`[RatingSync] Daily 9 AM dashboard refresh (${TZ}).`);
      await updateDashboard(client);
    } catch (err) {
      console.error('[RatingSync] Daily refresh error:', err.message);
    }
  }, { timezone: TZ, noOverlap: true });

  console.log(`[RatingSync] Started: ratings polled every 5m, streaks every 1h (TZ: ${TZ}).`);
}

async function calculateCFStreak(handle) {
  const subs = await getCFStatus(handle, 2000);
  if (!subs) return { current: 0, max: 0 };
  const timestamps = subs.filter(s => s.creationTimeSeconds).map(s => s.creationTimeSeconds);
  const { current, max } = calculateStreakFromTimestamps(timestamps);
  return { current, max };
}

module.exports = {
  startRatingSync,
  syncAllRatings,
  syncSingleUser,
  updateDashboard,
  calculateCFStreak,
  postRatingChange,
  STREAK_ROLES,
  CF_ROLES
};
