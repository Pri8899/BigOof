// tasks/contestFetcher.js — Cron job: fetch contests, send notifications, DM reminders
const cron = require('node-cron');
const {
  upsertContest, getUpcomingContests,
  getConfig, setConfig, db
} = require('../database/db');
const { getCFContests }     = require('../utils/codeforces');
const { getACContests }     = require('../utils/atcoder');
const { getTophContests }   = require('../utils/toph');
const { buildContestEmbed, buildContestListEmbed } = require('../utils/embeds');

/**
 * Fetch all contests from all platforms and store new ones
 */
async function fetchAndStoreContests() {
  console.log('[ContestFetcher] Fetching from Codeforces, AtCoder, Toph...');
  const [cfRes, acRes, tophRes] = await Promise.allSettled([
    getCFContests(),
    getACContests(),
    getTophContests()
  ]);

  const cfList   = cfRes.status === 'fulfilled'   ? cfRes.value   : [];
  const acList   = acRes.status === 'fulfilled'   ? acRes.value   : [];
  const tophList = tophRes.status === 'fulfilled' ? tophRes.value : [];

  // Update API status in DB config
  const cfSuccess   = cfRes.status === 'fulfilled'   && cfList.length > 0;
  const acSuccess   = acRes.status === 'fulfilled'   && acList.length > 0;
  const tophSuccess = tophRes.status === 'fulfilled' && tophList.length >= 0; // 0 is OK (no upcoming)
  setConfig('cf_api_online',   cfSuccess   ? '1' : '0');
  setConfig('ac_api_online',   acSuccess   ? '1' : '0');
  setConfig('toph_api_online', tophSuccess ? '1' : '0');

  // Log per-platform results
  if (!cfSuccess)   console.error('[ContestFetcher] CF fetch failed or returned empty.');
  if (!acSuccess)   console.error('[ContestFetcher] AC fetch failed or returned empty.');
  if (!tophSuccess) console.error('[ContestFetcher] Toph fetch failed.');

  console.log(`[ContestFetcher] 🔵 Codeforces: ${cfList.length} | 🔴 AtCoder: ${acList.length} | 🟣 Toph: ${tophList.length}`);

  const all = [...cfList, ...acList, ...tophList];
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

  // Exact 12-hour schedule (runs at 12:00 AM and 12:00 PM Dhaka time)
  cron.schedule('0 0,12 * * *', async () => {
    try {
      console.log(`[ContestFetcher] 12-hour cron triggered. Refreshing...`);
      await performContestRefresh(client);
    } catch (err) {
      console.error('[ContestFetcher 12-Hour Cron Error]', err);
    }
  }, { timezone: 'Asia/Dhaka' });
  console.log('[ContestFetcher] Strict 12-hour (12:00 AM/PM Dhaka time) cron scheduler started.');
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
    const cfStatus   = getConfig('cf_api_online')   !== '0';
    const acStatus   = getConfig('ac_api_online')   !== '0';
    const tophStatus = getConfig('toph_api_online') !== '0';
    console.log(`[ContestFetcher] API status - CF: ${cfStatus}, AC: ${acStatus}, Toph: ${tophStatus}`);

    const { getPlatformEmojis } = require('../utils/emojis');
    const emojis = await getPlatformEmojis(channel.guild);
    const embed = buildContestListEmbed(contests, 'all', { cf: cfStatus, ac: acStatus, toph: tophStatus }, emojis);

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
      // Delete the old message — new one will be posted below
      await msg.delete().catch(() => {});
      console.log('[ContestFetcher] Deleted old contest summary message.');
    }

    // Post fresh with @everyone ping — retry until it succeeds so the channel is never left empty
    let newMsg = null;
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        newMsg = await channel.send({ content: '@everyone', embeds: [embed] });
        break; // success
      } catch (err) {
        console.warn(`[ContestFetcher] Send attempt ${attempt}/10 failed: ${err.message}`);
        if (attempt < 10) await new Promise(r => setTimeout(r, 5000)); // wait 5s before retry
      }
    }

    if (newMsg) {
      setConfig('contest_summary_msg_id', newMsg.id);
      console.log('[ContestFetcher] Posted fresh contest summary.');
    } else {
      console.error('[ContestFetcher] Failed to post contest summary after 10 attempts!');
    }
  } catch (err) {
    console.error('[ContestFetcher] postContestSummary critical error:', err);
  }
}

module.exports = { startContestFetcher, fetchAndStoreContests, postContestSummary, performContestRefresh };
