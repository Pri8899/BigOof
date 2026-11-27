// tasks/contestFetcher.js — Fetch upcoming contests, update summary silently, and dispatch 24h / 1h reminders
const cron = require('node-cron');
const {
  upsertContest,
  getUpcomingContests,
  getContestsNeedingReminders,
  markContestNotified,
  addContestReminderMessage,
  getExpiredContestReminderMessages,
  getContestReminderMessagesByHorizon,
  getContestReminderMessagesByContest,
  deleteContestReminderMessageRecord,
  deleteContestReminderMessagesByContest,
  deleteContestReminderMessagesByChannel,
  getContestByUrl,
  getConfig,
  setConfig
} = require('../database/db');
const { getCFContests } = require('../utils/codeforces');
const { getACContests } = require('../utils/atcoder');
const { getTophContests } = require('../utils/toph');
const { buildContestEmbed, buildContestListEmbed } = require('../utils/embeds');
const { getGuildTargetChannels, replaceChannelBotMessage } = require('../utils/envHelper');
const { getTimeZone } = require('../utils/time');
const { getCalendarEmoji, getCalendarEmojisForDates } = require('../utils/calendarEmoji');

let isRefreshing = false;
let isCheckingReminders = false;
let isCleaningReminders = false;
const reminderDeleteTimers = new Map();

function getContestEndTime(contest) {
  if (!contest?.start_time) return null;
  const dur = Number(contest.duration_sec) > 0 ? Number(contest.duration_sec) : 3600;
  return Number(contest.start_time) + dur;
}

function parseEmbedDurationSec(desc) {
  if (!desc) return 0;
  const match = desc.match(/Duration:\*\*\s*`([^`]+)`/);
  if (!match) return 0;
  const raw = match[1].toLowerCase();
  const h = raw.match(/(\d+)\s*h/);
  const m = raw.match(/(\d+)\s*m/);
  let sec = 0;
  if (h) sec += parseInt(h[1], 10) * 3600;
  if (m) sec += parseInt(m[1], 10) * 60;
  return sec;
}

function resolveReminderEndTime(embed) {
  if (!embed) return 0;
  const dbContest = embed.url ? getContestByUrl(embed.url) : null;
  if (dbContest?.start_time) {
    return {
      contestId: dbContest.contest_id,
      endTs: getContestEndTime(dbContest)
    };
  }
  const tsMatch = embed.description?.match(/<t:(\d+):[FR]>/);
  const startTs = tsMatch ? parseInt(tsMatch[1], 10) : 0;
  if (!startTs) return { contestId: embed.url || 'legacy', endTs: 0 };
  const durSec = parseEmbedDurationSec(embed.description) || 3600;
  return {
    contestId: embed.url || `legacy_${startTs}`,
    endTs: startTs + durSec
  };
}

function clearReminderTimer(channelId, messageId) {
  const key = `${channelId}_${messageId}`;
  const existing = reminderDeleteTimers.get(key);
  if (existing) {
    clearTimeout(existing);
    reminderDeleteTimers.delete(key);
  }
}

async function deleteTrackedMessage(client, record) {
  clearReminderTimer(record.channel_id, record.message_id);
  try {
    const channel = client.channels.cache.get(record.channel_id)
      || await client.channels.fetch(record.channel_id).catch(() => null);
    if (channel && channel.isTextBased()) {
      await channel.messages.delete(record.message_id).catch(() => {});
    }
  } catch (_) {}
  if (record.id && typeof record.id === 'number') {
    deleteContestReminderMessageRecord(record.id);
  }
}

function scheduleReminderCleanup(client, record) {
  if (!record?.channel_id || !record?.message_id || !record?.expires_at) return;
  const key = `${record.channel_id}_${record.message_id}`;
  const delayMs = (record.expires_at * 1000) - Date.now();
  if (delayMs > 25 * 3600 * 1000) return;

  clearReminderTimer(record.channel_id, record.message_id);
  const timer = setTimeout(() => {
    reminderDeleteTimers.delete(key);
    cleanupExpiredContestReminders(client).catch(err =>
      console.warn('[ContestFetcher] Scheduled reminder delete error:', err.message)
    );
  }, Math.max(0, delayMs + 1500));
  reminderDeleteTimers.set(key, timer);
}

async function cleanupExpiredContestReminders(client) {
  if (isCleaningReminders) return;
  isCleaningReminders = true;
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const expired = getExpiredContestReminderMessages(nowSec);
    if (expired.length === 0) return;

    for (const rec of expired) {
      await deleteTrackedMessage(client, rec);
    }
    console.log(`[ContestFetcher] Auto-deleted ${expired.length} expired contest reminder message(s).`);
  } catch (err) {
    console.warn('[ContestFetcher] Reminder cleanup error:', err.message);
  } finally {
    isCleaningReminders = false;
  }
}

async function deleteContestRemindersFromDiscord(client, contestId) {
  const rows = getContestReminderMessagesByContest(contestId);
  for (const rec of rows) {
    await deleteTrackedMessage(client, rec);
  }
  deleteContestReminderMessagesByContest(contestId);
}

async function cleanupLegacyEndedReminders(client, channel, nowSec = Math.floor(Date.now() / 1000)) {
  try {
    const recent = await channel.messages.fetch({ limit: 35 }).catch(() => null);
    if (!recent) return;
    for (const m of recent.values()) {
      if (m.author.id !== client.user.id || !isContestReminderMessage(m) || !m.embeds?.length) continue;
      const { endTs } = resolveReminderEndTime(m.embeds[0]);
      if (endTs && endTs <= nowSec) {
        await m.delete().catch(() => {});
      }
    }
  } catch (_) {}
}

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
    const TZ = getTimeZone();

    for (const contest of contests) {
      const timeLeft = contest.start_time - now;
      if (timeLeft <= 0) continue;

      const is1h = contest.notified_1h === 0 && timeLeft <= 3900; // <= 65 min
      const is24h = !is1h && contest.notified_24h === 0 && timeLeft > 3900 && timeLeft <= (24 * 3600 + 300);

      if (!is1h && !is24h) continue;

      const label = is1h ? 'Starting in ~1 hour!' : 'Starting within 24 hours!';
      const calEmoji = await getCalendarEmoji(client, contest.start_time, TZ);
      const embed = buildContestEmbed(contest, label, { calEmoji });
      const alertHeader = is1h
        ? `🚨 **1-Hour Contest Reminder:** **${contest.name}** starts soon!`
        : `${calEmoji} **24-Hour Contest Reminder:** **${contest.name}** starts tomorrow!`;
      const expiresAt = getContestEndTime(contest);

      let delivered = false;
      for (const { guild_id, channel } of targets) {
        try {
          const sent = await channel.send({ content: alertHeader, embeds: [embed] });
          if (sent && expiresAt) {
            addContestReminderMessage(contest.contest_id, guild_id, channel.id, sent.id, expiresAt);
            scheduleReminderCleanup(client, {
              channel_id: channel.id,
              message_id: sent.id,
              expires_at: expiresAt
            });
          }
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

function isRadarOverviewMessage(msg) {
  return Boolean(
    msg.embeds?.length > 0 &&
    (msg.embeds[0].title?.includes('Upcoming Competitive Programming Contests') ||
     msg.embeds[0].title?.includes('Upcoming Contests') ||
     msg.embeds[0].title?.includes('Full Overview'))
  );
}

function isContestReminderMessage(msg) {
  return Boolean(
    msg.content?.includes('24-Hour Contest Reminder:') ||
    msg.content?.includes('1-Hour Contest Reminder:')
  );
}

/**
 * Deletes old contest radar/reminder messages, posts the fresh overview 1st, and re-posts active reminders 2nd.
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
    const TZ = getTimeZone();
    const nowDate = new Date();
    const nowSec = Math.floor(nowDate.getTime() / 1000);
    const todayLabel = nowDate.toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', timeZone: TZ
    });
    const [todayCal, dateEmojis] = await Promise.all([
      getCalendarEmoji(client, nowDate, TZ),
      getCalendarEmojisForDates(client, contests.map(c => c.start_time).filter(Boolean), TZ)
    ]);

    for (const { guild_id, channel } of targets) {
      try {
        const emojis = await getPlatformEmojis(channel.guild);
        const embed = buildContestListEmbed(
          contests,
          'all',
          { cf: cfStatus, ac: acStatus, toph: tophStatus },
          emojis,
          { todayCal, dateEmojis, todayLabel }
        );

        // Preserve still-upcoming or ongoing reminders so they sit below the refreshed radar overview and drop once over
        const activeReminders = [];
        const seenUrls = new Set();
        try {
          const recent = await channel.messages.fetch({ limit: 50 });
          const sortedDesc = [...recent.values()].sort((a, b) => (b.createdTimestamp || 0) - (a.createdTimestamp || 0));
          for (const m of sortedDesc) {
            if (m.author.id !== client.user.id || !isContestReminderMessage(m) || !m.embeds?.length) continue;
            const e = m.embeds[0];
            const { contestId, endTs } = resolveReminderEndTime(e);
            if (!endTs || endTs <= nowSec) continue; // Contest already over — drop cleanly
            const dedupKey = e.url || m.content;
            if (seenUrls.has(dedupKey)) continue;
            seenUrls.add(dedupKey);

            // Upgrade preserved reminder icons to the contest's actual date calendar emoji
            const dbContest = e.url ? getContestByUrl(e.url) : null;
            const tsMatch = e.description?.match(/<t:(\d+):[FR]>/);
            const startTs = dbContest?.start_time || (tsMatch ? parseInt(tsMatch[1], 10) : 0);
            const calEmoji = startTs ? await getCalendarEmoji(client, startTs, TZ) : null;

            let updatedContent = m.content;
            const updatedEmbeds = m.embeds.map(emb => {
              const json = typeof emb.toJSON === 'function' ? emb.toJSON() : { ...emb };
              if (calEmoji && json.description) {
                json.description = json.description.replace(
                  /^> [^\s]+\s+\*\*Starts At:\*\*/m,
                  `> ${calEmoji} **Starts At:**`
                );
              }
              return json;
            });
            if (calEmoji && updatedContent?.includes('24-Hour Contest Reminder:')) {
              updatedContent = updatedContent.replace(
                /^[^\s]+\s+\*\*24-Hour Contest Reminder:\*\*/,
                `${calEmoji} **24-Hour Contest Reminder:**`
              );
            }

            activeReminders.push({
              contestId,
              endTs,
              content: updatedContent,
              embeds: updatedEmbeds,
              createdAt: m.createdTimestamp || 0
            });
          }
          activeReminders.sort((a, b) => a.createdAt - b.createdAt);
        } catch (_) {}

        await replaceChannelBotMessage(client, channel, {
          matchMessage: (m) => isRadarOverviewMessage(m) || isContestReminderMessage(m),
          storedConfigKey: 'contest_summary_msg_id',
          guildId: guild_id,
          payload: { embeds: [embed] },
          logLabel: 'ContestFetcher'
        });

        deleteContestReminderMessagesByChannel(channel.id);

        for (const reminder of activeReminders) {
          const reposted = await channel.send({ content: reminder.content, embeds: reminder.embeds }).catch(() => null);
          if (reposted) {
            addContestReminderMessage(reminder.contestId, guild_id, channel.id, reposted.id, reminder.endTs);
            scheduleReminderCleanup(client, {
              channel_id: channel.id,
              message_id: reposted.id,
              expires_at: reminder.endTs
            });
          }
        }
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
    await cleanupExpiredContestReminders(client);
    await postContestSummary(client);
    await checkAndSendContestReminders(client);
    const targets = await getRadarTargets(client);
    const nowSec = Math.floor(Date.now() / 1000);
    for (const { channel } of targets) {
      await cleanupLegacyEndedReminders(client, channel, nowSec);
    }
    setConfig('last_contest_fetch_time', Math.floor(Date.now() / 1000).toString());
  } catch (err) {
    console.error('[ContestFetcher] Refresh error:', err.message);
  } finally {
    isRefreshing = false;
  }
}

function startContestFetcher(client) {
  const TZ = getTimeZone();

  setTimeout(async () => {
    await cleanupExpiredContestReminders(client).catch(() => {});
    const upcomingTracked = getContestReminderMessagesByHorizon(Math.floor(Date.now() / 1000) + 25 * 3600);
    for (const rec of upcomingTracked) scheduleReminderCleanup(client, rec);
    performContestRefresh(client).catch(err => console.error('[ContestFetcher Startup Error]', err));
  }, 5000);

  cron.schedule('0 0,12 * * *', () => {
    performContestRefresh(client).catch(err => console.error('[ContestFetcher 12h Cron Error]', err));
  }, { timezone: TZ, noOverlap: true });

  cron.schedule('*/10 * * * *', () => {
    checkAndSendContestReminders(client).catch(err => console.error('[ContestFetcher Reminder Cron Error]', err));
  }, { timezone: TZ, noOverlap: true });

  cron.schedule('* * * * *', () => {
    cleanupExpiredContestReminders(client).catch(err => console.error('[ContestFetcher Cleanup Cron Error]', err));
  }, { timezone: TZ, noOverlap: true });

  console.log(`[ContestFetcher] Started (12h refresh + 10m reminder alerts + 1m auto-cleanup, TZ: ${TZ}).`);
}

module.exports = {
  startContestFetcher,
  fetchAndStoreContests,
  postContestSummary,
  performContestRefresh,
  checkAndSendContestReminders,
  cleanupExpiredContestReminders,
  deleteContestRemindersFromDiscord,
  getContestEndTime
};
