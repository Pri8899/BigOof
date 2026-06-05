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
client.once('ready', () => {
  console.log(`\n✅ Bot online as ${client.user.tag}`);
  console.log(`   Serving ${client.guilds.cache.size} guild(s)`);
  console.log('');

  // One-time fix to clear last_submissions so 24-hour catchup triggers for existing users
  const { db, getAllUsers } = require('./database/db');
  try {
    const clearedKey = 'last_submissions_cleared_v3';
    const row = db.prepare('SELECT value FROM guild_config WHERE key = ?').get(clearedKey);
    if (!row) {
      db.prepare('DELETE FROM last_submissions').run();
      db.prepare('INSERT INTO guild_config (key, value) VALUES (?, ?)').run(clearedKey, 'true');
      console.log('[Startup Fix] Successfully cleared last_submissions to trigger 24-hour catchup.');
    }
  } catch (err) {
    console.error('[Startup Fix] Failed to run one-time clear:', err.message);
  }

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

  // Live diagnostic logging to Railway console and Discord
  try {
    const axios = require('axios');
    const users = getAllUsers();
    console.log(`\n=================== LIVE DIAGNOSTICS ===================`);
    console.log(`Registered users in DB: ${users.length}`);
    
    let report = `📊 **Startup Database Diagnostic Report**\n`;
    report += `• **Total users in DB**: \`${users.length}\`\n`;
    
    users.forEach(u => {
      console.log(`- User: ${u.username} (Discord: ${u.discord_id}) | CF: ${u.cf_handle || 'None'} | AC: ${u.ac_handle || 'None'}`);
      report += `- <@${u.discord_id}> | Username: \`${u.username}\` | CF: \`${u.cf_handle || 'None'}\` | AC: \`${u.ac_handle || 'None'}\`\n`;
    });
    
    const generalChannelId = process.env.GENERAL_CHANNEL_ID || '1505614835650658355';
    client.channels.fetch(generalChannelId)
      .then(channel => {
        if (channel) channel.send(report).catch(() => {});
      })
      .catch(() => {});
    
    // Check if anyone solved problems on CF in the last 2 hours
    const nowSec = Math.floor(Date.now() / 1000);
    for (const u of users) {
      if (u.cf_handle) {
        axios.get(`https://codeforces.com/api/user.status?handle=${u.cf_handle}&from=1&count=10`)
          .then(res => {
            if (res.data.status === 'OK') {
              const recent = res.data.result.filter(sub => sub.creationTimeSeconds >= nowSec - 7200);
              console.log(`[CF Diagnostic] User ${u.username} (${u.cf_handle}) has ${recent.length} submissions in the last 2 hours:`);
              recent.forEach(sub => {
                console.log(`  • ID: ${sub.id} | Problem: ${sub.problem.name} | Verdict: ${sub.verdict}`);
              });
            }
          })
          .catch(err => {
            console.error(`[CF Diagnostic Error] Failed to fetch for ${u.username}:`, err.message);
          });
      }
    }
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
