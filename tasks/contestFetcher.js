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

  const TZ = process.env.TIMEZONE || 'UTC';

  // Exact 12-hour schedule (runs at 12:00 AM and 12:00 PM configured timezone)
  cron.schedule('0 0,12 * * *', async () => {
    try {
      console.log(`[ContestFetcher] 12-hour cron triggered (${TZ}). Refreshing...`);
      await performContestRefresh(client);
    } catch (err) {
      console.error('[ContestFetcher 12-Hour Cron Error]', err);
    }
  }, { timezone: TZ });
  console.log(`[ContestFetcher] Strict 12-hour cron scheduler started (Timezone: ${TZ}).`);
}

/**
 * Post / edit a pinned grouped contest overview across all configured servers
 */
async function postContestSummary(client, specificGuildId = null) {
  try {
    const { getAllGuildConfigs } = require('../database/db');
    const contests = getUpcomingContests(30 * 24 * 3600); // next 30 days
    
    // Read API status from DB config
    const cfStatus   = getConfig('cf_api_online')   !== '0';
    const acStatus   = getConfig('ac_api_online')   !== '0';
    const tophStatus = getConfig('toph_api_online') !== '0';

    const targets = [];
    if (specificGuildId) {
      const chId = getConfig('contest_channel_id', specificGuildId);
      if (chId) targets.push({ guild_id: specificGuildId, value: chId });
    } else {
      const configs = getAllGuildConfigs('contest_channel_id');
      targets.push(...configs);
      const globalChId = getConfig('contest_channel_id', 'global') || process.env.CONTEST_CHANNEL_ID;
      if (globalChId && !targets.some(t => t.value === globalChId)) {
        targets.push({ guild_id: 'global', value: globalChId });
      }
    }

    if (targets.length === 0) {
      console.log('[ContestFetcher] No contest radar channels configured across servers.');
      return;
    }

    const { getPlatformEmojis } = require('../utils/emojis');

    for (const { guild_id, value: channelId } of targets) {
      try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel || !channel.isTextBased()) continue;

        const emojis = await getPlatformEmojis(channel.guild);
        const embed = buildContestListEmbed(contests, 'all', { cf: cfStatus, ac: acStatus, toph: tophStatus }, emojis);

        // Fetch recent overview messages
        let existingMessages = [];
        try {
          const messages = await channel.messages.fetch({ limit: 25 });
          existingMessages = [...messages.values()].filter(m => 
            m.author.id === client.user.id && 
            m.embeds.length > 0 && 
            ((m.embeds[0].title && (m.embeds[0].title.includes('Upcoming Contests') || m.embeds[0].title.includes('Full Overview'))) ||
             (m.embeds[0].description && (m.embeds[0].description.includes('Upcoming Contests') || m.embeds[0].description.includes('Full Overview'))))
          );
        } catch (err) {
          console.warn(`[ContestFetcher] Failed to fetch recent messages in channel ${channelId}:`, err.message);
        }

        if (existingMessages.length > 0) {
          for (const oldMsg of existingMessages) {
            await oldMsg.delete().catch(() => {});
          }
        }

        const newMsg = await channel.send({ content: '@everyone', embeds: [embed] }).catch(err => {
          console.warn(`[ContestFetcher] Failed to send overview to channel ${channelId}: ${err.message}`);
          return null;
        });

        if (newMsg) {
          setConfig('contest_summary_msg_id', newMsg.id, guild_id);
          console.log(`[ContestFetcher] Posted fresh contest summary to #${channel.name} (${channel.guild.name}).`);
        }
      } catch (guildErr) {
        console.error(`[ContestFetcher] Error updating contest radar for channel ${channelId}:`, guildErr.message);
      }
    }
  } catch (err) {
    console.error('[ContestFetcher] postContestSummary critical error:', err);
  }
}

module.exports = { startContestFetcher, fetchAndStoreContests, postContestSummary, performContestRefresh };
