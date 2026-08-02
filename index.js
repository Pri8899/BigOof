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

  const { db, getConfig } = require('./database/db');

  // Private DM diagnostics to owner on startup
  try {
    const owner = await client.users.fetch('1367493270703444078').catch(() => null);
    if (owner) {
      const debugLastSubs = db.prepare('SELECT * FROM last_submissions').all();
      const debugUsers = db.prepare('SELECT * FROM users').all();
      const channelId = getConfig('feed_channel_id') || process.env.FEED_CHANNEL_ID || process.env.GENERAL_CHANNEL_ID;
      const channelResolved = await client.channels.fetch(channelId).catch(() => null);
      
      let msg = `🤖 **Bot Startup Diagnostic (v1.0.3)**\n`;
      msg += `**Time:** ${new Date().toISOString()}\n`;
      msg += `**Feed Channel ID:** \`${channelId}\` (Resolved: \`${channelResolved ? '#' + channelResolved.name : 'null'}\`)\n`;
      const debugUsersFiltered = debugUsers.map(({ lc_handle, ...rest }) => rest);
      msg += `**Database Users:**\n\`\`\`json\n${JSON.stringify(debugUsersFiltered, null, 2)}\n\`\`\`\n`;
      msg += `**Last Submissions:**\n\`\`\`json\n${JSON.stringify(debugLastSubs, null, 2)}\n\`\`\``;
      await owner.send(msg).catch(() => {});
    }
  } catch (err) {
    console.error('[Startup DM] Failed:', err.message);
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

  // One-time startup check: Reset last_id and clear processed_submissions for 136-A to ensure solve is announced
  try {
    const targetId = '1367493270703444078';
    db.prepare("DELETE FROM processed_submissions WHERE id LIKE '%136_A%' OR id LIKE '%136%A%'").run();
    db.prepare("UPDATE last_submissions SET last_id = 385300000 WHERE discord_id = ? AND platform = 'cf'").run(targetId);
    console.log('[Startup] Reset last_id to 385300000 and cleared processed_submissions for 136-A.');
  } catch (err) {
    console.error('[Startup Reset Error]', err.message);
  }

  // Live diagnostic logging to Railway console
  try {
    const { getAllUsers } = require('./database/db');
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
process.on('unhandledRejection', (err) => {
  console.error('[Unhandled Rejection]', err);
  // Do NOT exit — let the bot keep running
});
process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]', err);
  // Do NOT exit — log and continue so the bot stays online
});

// ─── Login ────────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN);
