// tasks/contestFetcher.js — Fetch upcoming contests, update summary silently, and dispatch 24h / 1h reminders
const cron = require('node-cron');
const {
  upsertContest,
  getUpcomingContests,
  getContestsNeedingReminders,
  markContestNotified,
  getConfig,
  setConfig
} = require('../database/db');
const { getCFContests } = require('../utils/codeforces');
const { getACContests } = require('../utils/atcoder');
const { getTophContests } = require('../utils/toph');
const { buildContestEmbed, buildContestListEmbed } = require('../utils/embeds');
const { getGuildTargetChannels, replaceChannelBotMessage } = require('../utils/envHelper');
const { getTimeZone } = require('../utils/time');

let isRefreshing = false;
let isCheckingReminders = false;

async function getRadarTargets(client, specificGuildId = null) {
  return getGuildTargetChannels(client, 'contest_channel_id', 'CONTEST_CHANNEL_ID', specificGuildId);
}

/**
 * Fetch all upcoming contests from CF, AtCoder, and Toph and persist to SQLite.
 */
async function fetchAndStoreContests() {
  console.log('[ContestFetcher] Fetching from Codeforces, AtCoder, Toph...');
  const [cfRes, acRes, tophRes] = await Promise.allSettled([
    getCFContests(),
    getACContests(),
    getTophContests(true)
  ]);

  const cfList = cfRes.status === 'fulfilled' ? cfRes.value : [];
  const acList = acRes.status === 'fulfilled' ? acRes.value : [];
  const tophList = tophRes.status === 'fulfilled' ? tophRes.value : [];

  const cfSuccess = cfRes.status === 'fulfilled' && cfList.length > 0;
  const acSuccess = acRes.status === 'fulfilled' && acList.length > 0;
  const tophSuccess = tophRes.status === 'fulfilled';

  setConfig('cf_api_online', cfSuccess ? '1' : '0');
  setConfig('ac_api_online', acSuccess ? '1' : '0');
  setConfig('toph_api_online', tophSuccess ? '1' : '0');

  if (!cfSuccess) console.error('[ContestFetcher] CF fetch failed or returned empty.');
  if (!acSuccess) console.error('[ContestFetcher] AC fetch failed or returned empty.');
  if (!tophSuccess) console.error('[ContestFetcher] Toph fetch failed.');

  console.log(`[ContestFetcher] CF: ${cfList.length} | AC: ${acList.length} | Toph: ${tophList.length}`);

  const all = [...cfList, ...acList, ...tophList];
  for (const c of all) {
    upsertContest(c.id, c.platform, c.name, c.startTime, c.durationSec, c.url);
  }
  return all;
}

/**
 * Sends 24-hour and 1-hour reminder alerts for upcoming contests across configured channels.
 */
async function checkAndSendContestReminders(client) {
  if (isCheckingReminders) return;
  isCheckingReminders = true;

  try {
    const contests = getContestsNeedingReminders();
    if (contests.length === 0) return;

    const targets = await getRadarTargets(client);
    if (targets.length === 0) return;

    const now = Math.floor(Date.now() / 1000);

    for (const contest of contests) {
      const timeLeft = contest.start_time - now;
      if (timeLeft <= 0) continue;

      const is1h = contest.notified_1h === 0 && timeLeft <= 3900; // <= 65 min
      const is24h = !is1h && contest.notified_24h === 0 && timeLeft > 3900 && timeLeft <= (24 * 3600 + 300);

      if (!is1h && !is24h) continue;

      const label = is1h ? 'Starting in ~1 hour!' : 'Starting within 24 hours!';
      const embed = buildContestEmbed(contest, label);
      const alertHeader = is1h
        ? `🚨 **1-Hour Contest Reminder:** **${contest.name}** starts soon!`
        : `📅 **24-Hour Contest Reminder:** **${contest.name}** starts tomorrow!`;

      let delivered = false;
      for (const { channel } of targets) {
        try {
          await channel.send({ content: alertHeader, embeds: [embed] });
          delivered = true;
        } catch (err) {
          console.warn(`[ContestFetcher] Reminder send failed in #${channel.name}:`, err.message);
        }
      }

      if (delivered) {
        if (is1h) {
          markContestNotified(contest.contest_id, 'notified_1h');
          if (contest.notified_24h === 0) markContestNotified(contest.contest_id, 'notified_24h');
        } else {
          markContestNotified(contest.contest_id, 'notified_24h');
        }
        console.log(`[ContestFetcher] Sent ${is1h ? '1h' : '24h'} reminder for ${contest.name}.`);
      }
    }
  } catch (err) {
    console.error('[ContestFetcher] Reminder check error:', err.message);
  } finally {
    isCheckingReminders = false;
  }
}

/**
 * Deletes old contest radar overview embeds and posts a fresh upcoming contest summary.
 */
async function postContestSummary(client, specificGuildId = null) {
  try {
    const contests = getUpcomingContests(30 * 24 * 3600);
    const cfStatus = getConfig('cf_api_online') !== '0';
    const acStatus = getConfig('ac_api_online') !== '0';
    const tophStatus = getConfig('toph_api_online') !== '0';

    const targets = await getRadarTargets(client, specificGuildId);
    if (targets.length === 0) return;

    const { getPlatformEmojis } = require('../utils/emojis');

    for (const { guild_id, channel } of targets) {
      try {
        const emojis = await getPlatformEmojis(channel.guild);
        const embed = buildContestListEmbed(
          contests,
          'all',
          { cf: cfStatus, ac: acStatus, toph: tophStatus },
          emojis
        );

        await replaceChannelBotMessage(client, channel, {
          matchMessage: (m) =>
            m.embeds.length > 0 &&
            (m.embeds[0].title?.includes('Upcoming Competitive Programming Contests') ||
             m.embeds[0].title?.includes('Upcoming Contests') ||
             m.embeds[0].title?.includes('Full Overview')),
          storedConfigKey: 'contest_summary_msg_id',
          guildId: guild_id,
          payload: { embeds: [embed] },
          logLabel: 'ContestFetcher'
        });
      } catch (guildErr) {
        console.error(`[ContestFetcher] Error updating contest radar in #${channel.name}:`, guildErr.message);
      }
    }
  } catch (err) {
    console.error('[ContestFetcher] postContestSummary error:', err);
  }
}

async function performContestRefresh(client) {
  if (isRefreshing) return;
  isRefreshing = true;
  try {
    console.log('[ContestFetcher] Starting full contest refresh cycle...');
    await fetchAndStoreContests();
    await postContestSummary(client);
    await checkAndSendContestReminders(client);
    setConfig('last_contest_fetch_time', Math.floor(Date.now() / 1000).toString());
  } catch (err) {
    console.error('[ContestFetcher] Refresh error:', err.message);
  } finally {
    isRefreshing = false;
  }
}

function startContestFetcher(client) {
  const TZ = getTimeZone();

  setTimeout(() => {
    performContestRefresh(client).catch(err => console.error('[ContestFetcher Startup Error]', err));
  }, 5000);

  cron.schedule('0 0,12 * * *', () => {
    performContestRefresh(client).catch(err => console.error('[ContestFetcher 12h Cron Error]', err));
  }, { timezone: TZ, noOverlap: true });

  cron.schedule('*/10 * * * *', () => {
    checkAndSendContestReminders(client).catch(err => console.error('[ContestFetcher Reminder Cron Error]', err));
  }, { timezone: TZ, noOverlap: true });

  console.log(`[ContestFetcher] Started (12h refresh + 10m 24h/1h reminder checks, TZ: ${TZ}).`);
}

module.exports = {
  startContestFetcher,
  fetchAndStoreContests,
  postContestSummary,
  performContestRefresh,
  checkAndSendContestReminders
};
