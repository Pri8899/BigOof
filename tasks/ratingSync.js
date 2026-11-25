// tasks/ratingSync.js — Rating/streak sync, role sync, dashboard updater, and rank alerts
const cron = require('node-cron');
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const {
  getAllUsers,
  getUser,
  setConfig,
  upsertRating,
  getAllRatings,
  getRatings,
  insertRatingHistory,
  upsertStreak,
  getAllStreaks,
  getWeeklySnapshot,
  setWeeklySnapshot
} = require('../database/db');
const { getCFUser, calculateCFStreak } = require('../utils/codeforces');
const { getTargetChannel, getGuildTargetChannels, replaceChannelBotMessage } = require('../utils/envHelper');
const { getACUser } = require('../utils/atcoder');
const { getTophUser, calculateTophStreak } = require('../utils/toph');
const { buildDashboardEmbed, PLATFORM_ICONS, STREAK_ROLES, CF_ROLES } = require('../utils/embeds');
const { computeLeaderboard } = require('../commands/leaderboard');
const { getTimeZone, getLocalParts } = require('../utils/time');

function ensureInitialWeeklySnapshot(discordId, platform, stats) {
  if (!getWeeklySnapshot(discordId, platform)) {
    const { dateStr } = getLocalParts(new Date(), getTimeZone());
    setWeeklySnapshot(discordId, platform, stats.rating ?? 0, stats.solved ?? 0, dateStr);
  }
}

function canManageRole(guild, role = null) {
  const me = guild?.members?.me;
  if (!me || !me.permissions.has(PermissionFlagsBits.ManageRoles)) return false;
  if (!role) return true;
  return role.editable && role.position < me.roles.highest.position;
}

function findGuildRole(guild, name, caseInsensitive = false) {
  const target = caseInsensitive ? name.toLowerCase() : name;
  return guild.roles.cache.find(r => (caseInsensitive ? r.name.toLowerCase() : r.name) === target) || null;
}

/**
 * Ensures CP, CF Rank tier roles, and all Streak Milestone roles exist in the guild.
 */
async function ensureGuildRoles(guild) {
  await guild.roles.fetch().catch(() => guild.roles.cache);
  const me = guild.members.me;
  let createdCount = 0;

  let cpRole = findGuildRole(guild, 'CP');
  if (!cpRole) {
    cpRole = await guild.roles.create({
      name: 'CP',
      color: 0x5865F2,
      reason: 'Created by BigOof (Base Member Role)',
      mentionable: true
    });
    createdCount++;
  }
  setConfig('cp_role_id', cpRole.id, guild.id);

  const roleGroups = [
    { defs: CF_ROLES, reason: 'Created by BigOof (Rank Tier)', caseInsensitive: true },
    { defs: STREAK_ROLES, reason: 'Created by BigOof (Streak Milestone)', caseInsensitive: false }
  ];

  for (const { defs, reason, caseInsensitive } of roleGroups) {
    for (const def of defs) {
      if (!findGuildRole(guild, def.name, caseInsensitive)) {
        try {
          await guild.roles.create({ name: def.name, color: def.color, reason });
          createdCount++;
        } catch (_) {}
      }
    }
  }

  return { createdCount, cpRole, me };
}

async function syncTierRole(guild, member, roleDefs, targetDef, { reason, caseInsensitive = false, autoCreate = true } = {}) {
  if (targetDef) {
    let targetRole = findGuildRole(guild, targetDef.name, caseInsensitive);
    if (!targetRole && autoCreate) {
      targetRole = await guild.roles.create({
        name: targetDef.name,
        color: targetDef.color,
        reason
      }).catch(() => null);
    }
    if (targetRole && canManageRole(guild, targetRole) && !member.roles.cache.has(targetRole.id)) {
      await member.roles.add(targetRole).catch(() => {});
    }
  }

  const targetKey = targetDef ? (caseInsensitive ? targetDef.name.toLowerCase() : targetDef.name) : null;
  for (const def of roleDefs) {
    const defKey = caseInsensitive ? def.name.toLowerCase() : def.name;
    if (defKey !== targetKey) {
      const stale = findGuildRole(guild, def.name, caseInsensitive);
      if (stale && canManageRole(guild, stale) && member.roles.cache.has(stale.id)) {
        await member.roles.remove(stale).catch(() => {});
      }
    }
  }
}

/**
 * Syncs CP, CF Rank tier, and Streak Milestone roles for a single guild member cleanly.
 */
async function syncMemberRolesInGuild(guild, member, { assignCP = false, cpRole = null, cfRating = null, bestStreak = null, autoCreate = true } = {}) {
  if (!canManageRole(guild) || !member) return;

  if (assignCP && !member.user?.bot) {
    const baseRole = cpRole || findGuildRole(guild, 'CP');
    if (baseRole && canManageRole(guild, baseRole) && !member.roles.cache.has(baseRole.id)) {
      await member.roles.add(baseRole).catch(() => {});
    }
  }

  if (cfRating !== null && cfRating !== undefined) {
    const targetCFDef = CF_ROLES.find(r => cfRating >= r.min) || CF_ROLES[CF_ROLES.length - 1];
    await syncTierRole(guild, member, CF_ROLES, targetCFDef, {
      reason: 'Auto-created CF Rank Role',
      caseInsensitive: true,
      autoCreate
    });
  }

  if (bestStreak !== null && bestStreak !== undefined) {
    const targetStreakDef = STREAK_ROLES.find(s => bestStreak >= s.min) || null;
    await syncTierRole(guild, member, STREAK_ROLES, targetStreakDef, {
      reason: 'Auto-created Streak Role',
      caseInsensitive: false,
      autoCreate
    });
  }
}

function getUserBestStreak(discordId) {
  return getAllStreaks()
    .filter(s => s.discord_id === discordId)
    .reduce((mx, s) => Math.max(mx, s.current_streak || 0), 0);
}

// ─── Auto-Rank & Streak Roles ────────────────────────────────
async function syncUserGuildRoles(client, discordId, { cfRating = null, bestStreak = null } = {}) {
  if (!client) return;

  for (const guild of client.guilds.cache.values()) {
    try {
      if (!canManageRole(guild)) continue;
      const member = guild.members.cache.get(discordId) || await guild.members.fetch(discordId).catch(() => null);
      if (!member) continue;
      await syncMemberRolesInGuild(guild, member, { cfRating, bestStreak, autoCreate: true });
    } catch (err) {
      console.error(`[RoleSync] Error for ${discordId}:`, err.message);
    }
  }
}

async function updateDiscordRole(client, discordId, rating) {
  return syncUserGuildRoles(client, discordId, { cfRating: rating });
}

async function updateDiscordStreakRole(client, discordId, currentStreak) {
  return syncUserGuildRoles(client, discordId, { bestStreak: currentStreak });
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

async function applyPlatformStats(client, user, platform, stats, existingMap, alertOnChange) {
  if (!stats) return false;
  const prev = existingMap[platform];
  const hasExisting = prev !== undefined;
  const oldRating = prev?.rating ?? 0;
  const oldSolved = prev?.solved ?? 0;

  if (stats.solved === null || stats.solved === undefined || (platform !== 'cf' && stats.solved < oldSolved)) {
    stats.solved = oldSolved;
  }
  if (stats.rating === 0 && oldRating > 0) stats.rating = oldRating;

  ensureInitialWeeklySnapshot(user.discord_id, platform, stats);
  upsertRating(user.discord_id, platform, stats);
  insertRatingHistory(user.discord_id, platform, stats.rating);

  let changed = false;
  if (client) {
    if (platform === 'cf') {
      await updateDiscordRole(client, user.discord_id, stats.rating);
    }
    if (alertOnChange && hasExisting && oldRating !== stats.rating) {
      changed = true;
      await postRatingChange(client, user.discord_id, user.username, platform, oldRating, stats.rating, stats.rank_title, stats.lastContest);
    } else if (hasExisting && stats.solved > oldSolved) {
      changed = true;
    }
  }
  return changed;
}

async function syncUserRecord(client, user, { forceStreaks = false, alertOnChange = true } = {}) {
  const existing = {};
  for (const r of getRatings(user.discord_id)) existing[r.platform] = r;

  let changed = false;
  const isoToday = getLocalParts(new Date(), getTimeZone()).isoDate;

  if (user.cf_handle) {
    try {
      const stats = await getCFUser(user.cf_handle, { includeStreak: forceStreaks });
      if (stats) {
        if (await applyPlatformStats(client, user, 'cf', stats, existing, alertOnChange)) changed = true;
        if (forceStreaks && stats.streak) {
          upsertStreak(user.discord_id, 'cf', stats.streak.current, stats.streak.max, isoToday);
        }
      } else if (forceStreaks) {
        const streakInfo = await calculateCFStreak(user.cf_handle);
        upsertStreak(user.discord_id, 'cf', streakInfo.current, streakInfo.max, isoToday);
      }
    } catch (err) {
      console.error(`[RatingSync] CF error ${user.cf_handle}:`, err.message);
    }
    await new Promise(r => setTimeout(r, 1500));
  }

  if (user.ac_handle) {
    try {
      const stats = await getACUser(user.ac_handle, { includeStreak: forceStreaks });
      if (stats) {
        if (await applyPlatformStats(client, user, 'ac', stats, existing, alertOnChange)) changed = true;
        if (forceStreaks && stats.streak) {
          upsertStreak(user.discord_id, 'ac', stats.streak.current, stats.streak.max, isoToday);
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
      if (await applyPlatformStats(client, user, 'toph', stats, existing, alertOnChange)) changed = true;
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
    await updateDiscordStreakRole(client, user.discord_id, getUserBestStreak(user.discord_id));
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

module.exports = {
  startRatingSync,
  syncAllRatings,
  syncSingleUser,
  syncUserRecord,
  updateDashboard,
  ensureGuildRoles,
  syncMemberRolesInGuild,
  updateDiscordRole,
  updateDiscordStreakRole,
  getUserBestStreak,
  calculateCFStreak,
  postRatingChange,
  STREAK_ROLES,
  CF_ROLES
};
