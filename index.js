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

  // Set bot activity
  client.user.setActivity('CP Contests 🏆', { type: 3 }); // 3 = Watching

  // Start background tasks
  const { startContestFetcher } = require('./tasks/contestFetcher');
  const { startRatingSync }     = require('./tasks/ratingSync');
  const { startDailyChallenge } = require('./tasks/dailyChallenge');
  const { startSubmissionFeed } = require('./tasks/submissionFeed');
  const { startWeeklyWrapup }   = require('./tasks/weeklyWrapup');
  const { initializeProblemCache } = require('./utils/codeforces');

  // Asynchronously warm up the CF problem cache on startup
  initializeProblemCache().catch(err => console.error('[Startup] Failed to warm up CF problem cache:', err.message));

  startContestFetcher(client);
  startRatingSync(client);
  startDailyChallenge(client);
  startSubmissionFeed(client);
  startWeeklyWrapup(client);
});

// ─── Error Handling ───────────────────────────────────────────
client.on('error', err => console.error('[Client Error]', err));
process.on('unhandledRejection', err => console.error('[Unhandled Rejection]', err));
process.on('uncaughtException', err => console.error('[Uncaught Exception]', err));

// ─── Login ────────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN);
