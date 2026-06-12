// index.js — Bot entry point
require('dotenv').config();

const { Client, GatewayIntentBits, Collection, Partials } = require('discord.js');
const fs   = require('fs');
const path = require('path');

// ─── Create Client ───────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction
  ]
});

client.commands = new Collection();

// ─── Load Commands ───────────────────────────────────────────
function loadCommands(dir) {
  const files = fs.readdirSync(dir, { withFileTypes: true });
  for (const file of files) {
    const fullPath = path.join(dir, file.name);
    if (file.isDirectory()) {
      loadCommands(fullPath);
    } else if (file.name.endsWith('.js')) {
      const cmd = require(fullPath);
      if (cmd.data && cmd.execute) {
        client.commands.set(cmd.data.name, cmd);
        console.log(`[Commands] Loaded: /${cmd.data.name}`);
      }
    }
  }
}

loadCommands(path.join(__dirname, 'commands'));

// ─── Load Events ─────────────────────────────────────────────
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(f => f.endsWith('.js'));

for (const file of eventFiles) {
  const event = require(path.join(eventsPath, file));
  const handler = (...args) => event.execute(...args, client);

  if (event.once) {
    client.once(event.name, handler);
  } else {
    client.on(event.name, handler);
  }
  console.log(`[Events] Registered: ${event.name}`);
}

// ─── Ready Event ─────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`\n✅ Bot online as ${client.user.tag}`);
  console.log(`   Serving ${client.guilds.cache.size} guild(s)`);
  console.log('');




  // One-time startup check to restore June 5 suggestions in the database if missing
  try {
    const existing = db.prepare('SELECT 1 FROM daily_problems WHERE date_str = ?').get('06/05/2026');
    if (!existing) {
      db.prepare(`
        INSERT INTO daily_problems (date_str, p1_id, p2_id, p3_id)
        VALUES ('06/05/2026', '2148B', '1988B', '1676D')
      `).run();
      console.log('[Startup] Restored June 5 suggestions in database.');
    }
  } catch (err) {
    console.error('[Startup] Failed to restore June 5 suggestions in database:', err.message);
  }

  // One-time startup check to force-run the weekly wrap-up once on the production database
  try {
    const forcedKey = 'force_weekly_wrapup_0607_v1';
    const row = db.prepare('SELECT value FROM guild_config WHERE key = ?').get(forcedKey);
    if (!row) {
      const { runWeeklyWrapup } = require('./tasks/weeklyWrapup');
      console.log('[Startup] Forcing weekly wrap-up run to compile stats for all production users...');
      runWeeklyWrapup(client)
        .then(success => {
          if (success) {
            db.prepare('INSERT INTO guild_config (key, value) VALUES (?, ?)').run(forcedKey, 'true');
            console.log('[Startup] Forced weekly wrap-up completed and flag saved.');
          } else {
            console.error('[Startup] Forced weekly wrap-up skipped or failed (no channel resolved).');
          }
        })
        .catch(err => {
          console.error('[Startup] Forced weekly wrap-up failed:', err.message);
        });
    }
  } catch (err) {
    console.error('[Startup] Failed to run forced weekly wrap-up:', err.message);
  }

  // One-time startup check to delete the previous wrapped weekly wrap-up and repost it correctly
  try {
    const repostKey = 'repost_weekly_0607_v2';
    const row = db.prepare('SELECT value FROM guild_config WHERE key = ?').get(repostKey);
    if (!row) {
      const { getConfig } = require('./database/db');
      const channelId = getConfig('rating_channel_id') || getConfig('dashboard_channel_id') || process.env.RATING_CHANNEL_ID || process.env.DASHBOARD_CHANNEL_ID;
      if (channelId) {
        client.channels.fetch(channelId)
          .then(async channel => {
            if (channel) {
              console.log('[Startup Repost] Fetching messages to delete old weekly wrap-up...');
              const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
              if (messages) {
                // Find old weekly message containing @everyone and WEEKLY CHAMPIONS in the description
                const weeklyMsg = messages.find(m => m.author.id === client.user.id && m.embeds.some(e => e.description && e.description.includes('WEEKLY CHAMPIONS')));
                if (weeklyMsg) {
                  console.log(`[Startup Repost] Found old weekly wrap-up message (ID: ${weeklyMsg.id}). Deleting...`);
                  await weeklyMsg.delete().catch(err => console.error('[Startup Repost] Delete error:', err.message));
                } else {
                  console.log('[Startup Repost] No old weekly wrap-up message found.');
                }
              }
              
              // Post the new wrap-up
              const { runWeeklyWrapup } = require('./tasks/weeklyWrapup');
              console.log('[Startup Repost] Generating new weekly wrap-up message...');
              const success = await runWeeklyWrapup(client);
              if (success) {
                db.prepare('INSERT INTO guild_config (key, value) VALUES (?, ?)').run(repostKey, 'true');
                console.log('[Startup Repost] Reposted weekly wrap-up completed and flag saved.');
              } else {
                console.error('[Startup Repost] Repost failed (no channel or early exit).');
              }
            }
          })
          .catch(err => {
            console.error('[Startup Repost] Channel fetch failed:', err.message);
          });
      }
    }
  } catch (err) {
    console.error('[Startup Repost] Failed to run repost:', err.message);
  }

  // Live diagnostic logging to Railway console
  try {
    const users = getAllUsers();
    console.log(`\n=================== LIVE DIAGNOSTICS ===================`);
    console.log(`Registered users in DB: ${users.length}`);
    users.forEach(u => {
      console.log(`- User: ${u.username} (Discord: ${u.discord_id}) | CF: ${u.cf_handle || 'None'} | AC: ${u.ac_handle || 'None'}`);
    });
    console.log(`========================================================\n`);
  } catch (e) {
    console.error('[Diagnostic Error] Failed to run diagnostics:', e.message);
  }

  // Set bot activity
  client.user.setActivity('CP Contests 🏆', { type: 3 }); // 3 = Watching

  // Start background tasks
  const { startContestFetcher } = require('./tasks/contestFetcher');
  const { startRatingSync }     = require('./tasks/ratingSync');
  const { startDailyChallenge } = require('./tasks/dailyChallenge');
  const { startSubmissionFeed } = require('./tasks/submissionFeed');
  const { startWeeklyWrapup }   = require('./tasks/weeklyWrapup');
  const { startVSPoller }       = require('./tasks/vsPoller');
  const { initializeProblemCache } = require('./utils/codeforces');

  // Asynchronously warm up the CF problem cache on startup
  initializeProblemCache().catch(err => console.error('[Startup] Failed to warm up CF problem cache:', err.message));

  startContestFetcher(client);
  startRatingSync(client);
  startDailyChallenge(client);
  startSubmissionFeed(client);
  startWeeklyWrapup(client);
  startVSPoller(client);
});

// ─── Error Handling ───────────────────────────────────────────
client.on('error', err => console.error('[Client Error]', err));
process.on('unhandledRejection', err => console.error('[Unhandled Rejection]', err));
process.on('uncaughtException', err => console.error('[Uncaught Exception]', err));

// ─── Login ────────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN);
