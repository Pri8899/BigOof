// tasks/weeklyWrapup.js — Sunday 9 PM weekly digest (computes delta BEFORE saving next week's baseline)
const cron = require('node-cron');
const {
  getAllUsers,
  getRatings,
  getWeeklySnapshot,
  setWeeklySnapshot,
  getConfig,
  setConfig
} = require('../database/db');
const { buildWeeklyWrapupEmbed } = require('../utils/embeds');
const { resolveChannelChain } = require('../utils/envHelper');
const { getTimeZone, getLocalParts } = require('../utils/time');

function computeStats(userList) {
  const allSolved = [];
  const allRatingGains = [];

  for (const user of userList) {
    const ratings = getRatings(user.discord_id);
    let userTotalSolved = 0;
    let cfStart = 0, cfEnd = 0, cfGain = 0, cfSolved = 0;
    let acStart = 0, acEnd = 0, acGain = 0, acSolved = 0;
    let tophStart = 0, tophEnd = 0, tophGain = 0, tophSolved = 0;

    if (user.cf_handle) {
      const dbRating = ratings.find(r => r.platform === 'cf');
      const snap = getWeeklySnapshot(user.discord_id, 'cf');
      if (dbRating && snap) {
        cfSolved = Math.max(0, dbRating.solved - snap.solved);
        cfGain = dbRating.rating - snap.rating;
        cfStart = snap.rating;
        cfEnd = dbRating.rating;
      } else if (dbRating) {
        cfStart = dbRating.rating;
        cfEnd = dbRating.rating;
      }
      userTotalSolved += cfSolved;
    }

    if (user.ac_handle) {
      const dbRating = ratings.find(r => r.platform === 'ac');
      const snap = getWeeklySnapshot(user.discord_id, 'ac');
      if (dbRating && snap) {
        acSolved = Math.max(0, dbRating.solved - snap.solved);
        acGain = dbRating.rating - snap.rating;
        acStart = snap.rating;
        acEnd = dbRating.rating;
      } else if (dbRating) {
        acStart = dbRating.rating;
        acEnd = dbRating.rating;
      }
      userTotalSolved += acSolved;
    }

    if (user.toph_handle) {
      const dbRating = ratings.find(r => r.platform === 'toph');
      const snap = getWeeklySnapshot(user.discord_id, 'toph');
      if (dbRating && snap) {
        tophSolved = Math.max(0, dbRating.solved - snap.solved);
        tophGain = dbRating.rating - snap.rating;
        tophStart = snap.rating;
        tophEnd = dbRating.rating;
      } else if (dbRating) {
        tophStart = dbRating.rating;
        tophEnd = dbRating.rating;
      }
      userTotalSolved += tophSolved;
    }

    // Highlight primary platform rating gain (CF first, otherwise AC or Toph) without mixing platform scales
    let primaryStart = cfStart, primaryEnd = cfEnd, primaryGain = cfGain;
    if (cfGain <= 0) {
      if (acGain > primaryGain && acGain > 0) {
        primaryStart = acStart;
        primaryEnd = acEnd;
        primaryGain = acGain;
      } else if (tophGain > primaryGain && tophGain > 0) {
        primaryStart = tophStart;
        primaryEnd = tophEnd;
        primaryGain = tophGain;
      }
    }

    allSolved.push({
      discord_id: user.discord_id,
      username: user.username,
      cf_solved: cfSolved,
      ac_solved: acSolved,
      toph_solved: tophSolved,
      solved_this_week: userTotalSolved
    });

    allRatingGains.push({
      discord_id: user.discord_id,
      username: user.username,
      gain: Math.max(0, primaryGain),
      rating_gained: Math.max(0, primaryGain),
      start: primaryStart,
      end: primaryEnd,
      cf_gain: Math.max(0, cfGain), cf_start: cfStart, cf_end: cfEnd, cf_linked: Boolean(user.cf_handle),
      ac_gain: Math.max(0, acGain), ac_start: acStart, ac_end: acEnd, ac_linked: Boolean(user.ac_handle),
      toph_gain: Math.max(0, tophGain), toph_start: tophStart, toph_end: tophEnd, toph_linked: Boolean(user.toph_handle)
    });
  }

  allSolved.sort((a, b) => b.solved_this_week - a.solved_this_week);
  allRatingGains.sort((a, b) => b.rating_gained - a.rating_gained);
  return { allSolved, allRatingGains };
}

async function runWeeklyWrapup(client, updateSnapshots = false) {
  const users = getAllUsers();
  const { dateStr: todayStr } = getLocalParts(new Date(), getTimeZone());

  let postedCount = 0;
  const sentChannels = new Set();

  // Compute and post per guild using EXISTING baseline snapshots BEFORE overwriting them
  for (const guild of client.guilds.cache.values()) {
    try {
      const channel = await resolveChannelChain(
        client,
        [
          { key: 'rating_channel_id', env: 'RATING_CHANNEL_ID' },
          { key: 'dashboard_channel_id', env: 'DASHBOARD_CHANNEL_ID' }
        ],
        guild.id
      );

      if (!channel || sentChannels.has(channel.id)) continue;

      const guildMembers = await guild.members.fetch().catch(() => null);
      const guildUsers = guildMembers
        ? users.filter(u => guildMembers.has(u.discord_id))
        : users;

      if (guildUsers.length === 0) continue;

      const { allSolved, allRatingGains } = computeStats(guildUsers);
      const embed = buildWeeklyWrapupEmbed(allSolved, allRatingGains);

      await channel.send({ content: '@everyone', embeds: [embed] }).catch(() =>
        channel.send({ embeds: [embed] })
      );

      sentChannels.add(channel.id);
      postedCount++;
      console.log(`[WeeklyWrapUp] Posted digest in ${guild.name} (#${channel.name}).`);
    } catch (err) {
      console.error(`[WeeklyWrapUp] Error in guild ${guild.name}:`, err.message);
    }
  }

  if (postedCount === 0) {
    const globalChannel = await resolveChannelChain(
      client,
      [
        { key: 'rating_channel_id', env: 'RATING_CHANNEL_ID' },
        { key: 'dashboard_channel_id', env: 'DASHBOARD_CHANNEL_ID' }
      ]
    );

    if (globalChannel) {
      const { allSolved, allRatingGains } = computeStats(users);
      const embed = buildWeeklyWrapupEmbed(allSolved, allRatingGains);
      await globalChannel.send({ content: '@everyone', embeds: [embed] }).catch(() =>
        globalChannel.send({ embeds: [embed] })
      );
      postedCount++;
      console.log(`[WeeklyWrapUp] Posted digest to fallback #${globalChannel.name}.`);
    }
  }

  // Save/update baseline snapshot AFTER computing & posting the weekly report
  if (updateSnapshots && postedCount > 0) {
    for (const user of users) {
      for (const r of getRatings(user.discord_id)) {
        setWeeklySnapshot(user.discord_id, r.platform, r.rating, r.solved, todayStr);
      }
    }
  }

  return postedCount > 0;
}

function getTargetWeeklyWrapupDate() {
  const { year, month, day, hour, dayOfWeek } = getLocalParts(new Date(), getTimeZone());
  const localMidnightUtc = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));

  const targetSunday = new Date(localMidnightUtc);
  if (dayOfWeek === 0) {
    if (hour < 21) targetSunday.setUTCDate(localMidnightUtc.getUTCDate() - 7);
  } else {
    targetSunday.setUTCDate(localMidnightUtc.getUTCDate() - dayOfWeek);
  }

  const ty = targetSunday.getUTCFullYear();
  const tm = String(targetSunday.getUTCMonth() + 1).padStart(2, '0');
  const td = String(targetSunday.getUTCDate()).padStart(2, '0');
  return `${tm}/${td}/${ty}`;
}

function startWeeklyWrapup(client) {
  const TZ = getTimeZone();

  setTimeout(async () => {
    try {
      const targetDateStr = getTargetWeeklyWrapupDate();
      const lastWrapupDate = getConfig('last_weekly_wrapup_date', 'global');

      if (!lastWrapupDate) {
        setConfig('last_weekly_wrapup_date', targetDateStr, 'global');
        return;
      }

      if (lastWrapupDate !== targetDateStr) {
        console.log(`[WeeklyWrapUp] Startup catch-up for Sunday ${targetDateStr}...`);
        const success = await runWeeklyWrapup(client, true);
        if (success) {
          setConfig('last_weekly_wrapup_date', targetDateStr, 'global');
        }
      }
    } catch (err) {
      console.error('[WeeklyWrapUp Startup Catch-up Error]', err);
    }
  }, 15000);

  cron.schedule('0 21 * * 0', async () => {
    try {
      console.log(`[WeeklyWrapUp] Sunday 9 PM triggered (${TZ}).`);
      const success = await runWeeklyWrapup(client, true);
      if (success) {
        setConfig('last_weekly_wrapup_date', getTargetWeeklyWrapupDate(), 'global');
      }
    } catch (err) {
      console.error('[WeeklyWrapUp] Cron Error:', err.message);
    }
  }, { timezone: TZ, noOverlap: true });

  console.log(`[WeeklyWrapUp] Started Sunday 9 PM cron scheduler (${TZ}).`);
}

module.exports = { startWeeklyWrapup, runWeeklyWrapup };
