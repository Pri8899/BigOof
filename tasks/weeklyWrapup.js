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
const { getCalendarEmoji } = require('../utils/calendarEmoji');

const WEEKLY_PLATFORMS = ['cf', 'ac', 'toph'];

function computeStats(userList) {
  const allSolved = [];
  const allRatingGains = [];

  for (const user of userList) {
    const ratings = getRatings(user.discord_id);
    const perPlat = {};
    let userTotalSolved = 0;

    for (const plat of WEEKLY_PLATFORMS) {
      let solvedDelta = 0, gain = 0, start = 0, end = 0;
      if (user[`${plat}_handle`]) {
        const dbRating = ratings.find(r => r.platform === plat);
        const snap = getWeeklySnapshot(user.discord_id, plat);
        if (dbRating && snap) {
          solvedDelta = Math.max(0, dbRating.solved - snap.solved);
          gain = dbRating.rating - snap.rating;
          start = snap.rating;
          end = dbRating.rating;
        } else if (dbRating) {
          start = dbRating.rating;
          end = dbRating.rating;
        }
        userTotalSolved += solvedDelta;
      }
      perPlat[plat] = { solvedDelta, gain, start, end };
    }

    // Highlight primary platform rating gain (CF first, otherwise AC or Toph) without mixing platform scales
    let primary = perPlat.cf;
    if (primary.gain <= 0) {
      if (perPlat.ac.gain > primary.gain && perPlat.ac.gain > 0) {
        primary = perPlat.ac;
      } else if (perPlat.toph.gain > primary.gain && perPlat.toph.gain > 0) {
        primary = perPlat.toph;
      }
    }

    allSolved.push({
      discord_id: user.discord_id,
      username: user.username,
      cf_solved: perPlat.cf.solvedDelta,
      ac_solved: perPlat.ac.solvedDelta,
      toph_solved: perPlat.toph.solvedDelta,
      solved_this_week: userTotalSolved
    });

    allRatingGains.push({
      discord_id: user.discord_id,
      username: user.username,
      gain: Math.max(0, primary.gain),
      rating_gained: Math.max(0, primary.gain),
      start: primary.start,
      end: primary.end,
      cf_gain: Math.max(0, perPlat.cf.gain), cf_start: perPlat.cf.start, cf_end: perPlat.cf.end, cf_linked: Boolean(user.cf_handle),
      ac_gain: Math.max(0, perPlat.ac.gain), ac_start: perPlat.ac.start, ac_end: perPlat.ac.end, ac_linked: Boolean(user.ac_handle),
      toph_gain: Math.max(0, perPlat.toph.gain), toph_start: perPlat.toph.start, toph_end: perPlat.toph.end, toph_linked: Boolean(user.toph_handle)
    });
  }

  allSolved.sort((a, b) => b.solved_this_week - a.solved_this_week);
  allRatingGains.sort((a, b) => b.rating_gained - a.rating_gained);
  return { allSolved, allRatingGains };
}

const WEEKLY_CHANNEL_CHAIN = [
  { key: 'general_channel_id', env: 'GENERAL_CHANNEL_ID' },
  { key: 'rating_channel_id', env: 'RATING_CHANNEL_ID' },
  { key: 'dashboard_channel_id', env: 'DASHBOARD_CHANNEL_ID' }
];

async function runWeeklyWrapup(client, updateSnapshots = false) {
  const users = getAllUsers();
  const TZ = getTimeZone();
  const now = new Date();
  const { dateStr: todayStr } = getLocalParts(now, TZ);
  const weekLabel = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: TZ });
  const calEmoji = await getCalendarEmoji(client, now, TZ);

  let postedCount = 0;
  const sentChannels = new Set();

  // Compute and post per guild using EXISTING baseline snapshots BEFORE overwriting them
  for (const guild of client.guilds.cache.values()) {
    try {
      const channel = await resolveChannelChain(client, WEEKLY_CHANNEL_CHAIN, guild.id);

      if (!channel || sentChannels.has(channel.id)) continue;

      const guildMembers = await guild.members.fetch().catch(() => null);
      const guildUsers = guildMembers
        ? users.filter(u => guildMembers.has(u.discord_id))
        : users;

      if (guildUsers.length === 0) continue;

      const { allSolved, allRatingGains } = computeStats(guildUsers);
      const embed = buildWeeklyWrapupEmbed(allSolved, allRatingGains, { calEmoji, weekLabel });

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
    const globalChannel = await resolveChannelChain(client, WEEKLY_CHANNEL_CHAIN);

    if (globalChannel) {
      const { allSolved, allRatingGains } = computeStats(users);
      const embed = buildWeeklyWrapupEmbed(allSolved, allRatingGains, { calEmoji, weekLabel });
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
