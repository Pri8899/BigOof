// tasks/contestFetcher.js — Cron job: fetch contests, send notifications, DM reminders
const cron = require('node-cron');
const {
  upsertContest, getUpcomingContests,
  getConfig, setConfig, db
} = require('../database/db');
const { getCFContests }     = require('../utils/codeforces');
const { getACContests }     = require('../utils/atcoder');
const { buildContestEmbed, buildContestListEmbed } = require('../utils/embeds');

/**
 * Fetch all contests from all platforms and store new ones
 */
async function fetchAndStoreContests() {
  console.log('[ContestFetcher] Fetching from Codeforces, AtCoder...');
  const [cfRes, acRes] = await Promise.allSettled([
    getCFContests(),
    getACContests()
  ]);

  const cfList = cfRes.status === 'fulfilled' ? cfRes.value : [];
  const acList = acRes.status === 'fulfilled' ? acRes.value : [];

  // Update API status in DB config
  const cfSuccess = cfRes.status === 'fulfilled' && cfList.length > 0;
  const acSuccess = acRes.status === 'fulfilled' && acList.length > 0;
  setConfig('cf_api_online', cfSuccess ? '1' : '0');
  setConfig('ac_api_online', acSuccess ? '1' : '0');

  // Log per-platform results
  if (!cfSuccess) console.error('[ContestFetcher] CF fetch failed or returned empty.');
  if (!acSuccess) console.error('[ContestFetcher] AC fetch failed or returned empty.');

  console.log(`[ContestFetcher] 🔵 Codeforces: ${cfList.length} | 🔴 AtCoder: ${acList.length}`);

  const all = [...cfList, ...acList];
  for (const c of all) {
    upsertContest(c.id, c.platform, c.name, c.startTime, c.durationSec, c.url);
  }

  console.log(`[ContestFetcher] Total stored/updated: ${all.length} contests.`);
  return all;
}




/**
 * Run a full contest refresh cycle: fetch APIs, post overview.
 * Updates the last fetch timestamp in SQLite ONLY if everything completes successfully.
 */
async function performContestRefresh(client) {
  console.log('[ContestFetcher] Starting full contest refresh cycle...');
  await fetchAndStoreContests();
  await postContestSummary(client);
  
  try {
    setConfig('last_contest_fetch_time', Math.floor(Date.now() / 1000).toString());
    console.log('[ContestFetcher] Full refresh completed successfully. Timestamp updated.');
  } catch (err) {
    console.error('[ContestFetcher] Failed to save last refresh time:', err.message);
  }
}

function startContestFetcher(client) {
  // Add discord_msg_id column if missing (safe migration)
  try {
    db.prepare(`ALTER TABLE notified_contests ADD COLUMN discord_msg_id TEXT`).run();
  } catch (_) {}

  // Run immediately on boot
  setTimeout(async () => {
    try {
      console.log(`[ContestFetcher] Startup trigger: Performing full refresh...`);
      await performContestRefresh(client);
    } catch (err) {
      console.error('[ContestFetcher Startup Error]', err);
    }
  }, 5000);

  // Exact hourly schedule at the top of the hour (e.g. 14:00, 15:00)
  cron.schedule('0 * * * *', async () => {
    try {
      console.log(`[ContestFetcher] Hourly cron triggered. Refreshing...`);
      await performContestRefresh(client);
    } catch (err) {
      console.error('[ContestFetcher Hourly Cron Error]', err);
    }
  });

  // Every day at 9am UTC+6 (03:00 UTC): refresh the grouped summary (fallback)
  cron.schedule('0 3 * * *', async () => {
    try {
      await postContestSummary(client);
    } catch (err) {
      console.error('[ContestFetcher Daily Cron Error]', err);
    }
  }, { timezone: 'UTC' });

  console.log('[ContestFetcher] Strict hourly cron scheduler started.');
}

/**
 * Post / edit a pinned grouped contest overview in #contest-radar
 */
async function postContestSummary(client) {
  try {
    console.log('[ContestFetcher] postContestSummary started.');
    const channelId = getConfig('contest_channel_id') || process.env.CONTEST_CHANNEL_ID;
    console.log('[ContestFetcher] Channel ID:', channelId);
    if (!channelId) return;

    const channel = await client.channels.fetch(channelId).catch(err => {
      console.error('[ContestFetcher] Channel fetch error:', err.message);
      return null;
    });
    console.log('[ContestFetcher] Channel found:', !!channel);
    if (!channel) return;

    const contests = getUpcomingContests(30 * 24 * 3600); // next 30 days
    console.log(`[ContestFetcher] Found ${contests.length} upcoming/running contests.`);
    
    // Read API status from DB config
    const cfStatus = getConfig('cf_api_online') !== '0';
    const acStatus = getConfig('ac_api_online') !== '0';
    console.log(`[ContestFetcher] API status - CF: ${cfStatus}, AC: ${acStatus}`);

    const embed = buildContestListEmbed(contests, 'all', { cf: cfStatus, ac: acStatus });

    // Fetch recent messages in the channel to find any existing summary messages sent by the bot
    let existingMessages = [];
    try {
      const messages = await channel.messages.fetch({ limit: 50 });
      // Filter for messages sent by the bot that have the summary embed title or description
      existingMessages = [...messages.values()].filter(m => 
        m.author.id === client.user.id && 
        m.embeds.length > 0 && 
        ((m.embeds[0].title && (m.embeds[0].title.includes('Upcoming Contests') || m.embeds[0].title.includes('Full Overview'))) ||
         (m.embeds[0].description && (m.embeds[0].description.includes('Upcoming Contests') || m.embeds[0].description.includes('Full Overview'))))
      );
    } catch (err) {
      console.warn('[ContestFetcher] Failed to fetch recent channel messages:', err.message);
    }

    let msg = null;
    if (existingMessages.length > 0) {
      // Sort existingMessages by creation time descending (newest first)
      existingMessages.sort((a, b) => b.createdTimestamp - a.createdTimestamp);
      
      // Use the newest one as our primary message to edit
      msg = existingMessages[0];
      setConfig('contest_summary_msg_id', msg.id);

      // Clean up any extra/duplicate overview messages to enforce exactly one message in the channel
      if (existingMessages.length > 1) {
        console.log(`[ContestFetcher] Found ${existingMessages.length} overview messages. Cleaning up duplicates...`);
        for (let i = 1; i < existingMessages.length; i++) {
          await existingMessages[i].delete().catch(() => {});
        }
      }
    }

    if (msg) {
      // To trigger a notification while keeping only one message, we delete the old one
      await msg.delete().catch(() => {});
      console.log('[ContestFetcher] Deleted old contest summary message.');
    }

    // Post fresh with @everyone (with auto-retry for GOAWAY)
    const newMsg = await channel.send({ content: '@everyone', embeds: [embed] }).catch(async err => {
        if (err.message && err.message.includes('GOAWAY')) {
          console.warn('[ContestFetcher] Got GOAWAY on send, retrying in 1 second...');
          await new Promise(r => setTimeout(r, 1000));
          return channel.send({ content: '@everyone', embeds: [embed] }).catch(e => {
            console.error('[ContestFetcher] Message send retry error:', e.message);
            return null;
          });
        }
        console.error('[ContestFetcher] Message send error:', err.message);
        return null;
      });

      if (newMsg) {
        setConfig('contest_summary_msg_id', newMsg.id);
        console.log('[ContestFetcher] Posted fresh contest summary.');
      }

    // Clean up any other messages in the channel to keep it strictly limited to the overview summary
    try {
      const allMessages = await channel.messages.fetch({ limit: 50 });
      const summaryMsgId = (typeof newMsg !== 'undefined' && newMsg) ? newMsg.id : null;
      if (summaryMsgId) {
        const toDelete = [...allMessages.values()].filter(m => m.id !== summaryMsgId);
        if (toDelete.length > 0) {
          console.log(`[ContestFetcher] Cleaning up ${toDelete.length} non-summary messages from contest channel...`);
          for (const m of toDelete) {
            await m.delete().catch(() => {});
          }
        }
      }
    } catch (err) {
      console.warn('[ContestFetcher] Failed to clean up non-summary messages:', err.message);
    }
  } catch (err) {
    console.error('[ContestFetcher] postContestSummary critical error:', err);
  }
}

module.exports = { startContestFetcher, fetchAndStoreContests, postContestSummary, performContestRefresh };
