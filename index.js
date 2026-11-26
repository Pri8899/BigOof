// index.js — BigOof Discord Bot entry point
require('dotenv').config();

const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { checkpointWal, db } = require('./database/db');

const token = process.env.DISCORD_TOKEN?.trim();
if (!token || token.includes('your_')) {
  console.error('❌ Error: DISCORD_TOKEN is missing or still set to placeholder in .env!');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages
  ]
});

client.commands = new Collection();

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

const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(f => f.endsWith('.js'));

for (const file of eventFiles) {
  const event = require(path.join(eventsPath, file));
  const handler = (...args) => {
    Promise.resolve(event.execute(...args, client)).catch(err =>
      console.error(`[Event Error: ${event.name}]`, err)
    );
  };

  if (event.once) {
    client.once(event.name, handler);
  } else {
    client.on(event.name, handler);
  }
  console.log(`[Events] Registered: ${event.name}`);
}

client.once('ready', async () => {
  console.log(`\n✅ Bot online as ${client.user.tag}`);
  console.log(`   Serving ${client.guilds.cache.size} guild(s)\n`);

  // Fetch application owner/team metadata so owner checks work even if OWNER_ID is omitted
  await client.application?.fetch().catch(() => {});

  client.user.setActivity('CP Contests 🏆', { type: 3 });

  const { startContestFetcher } = require('./tasks/contestFetcher');
  const { startRatingSync } = require('./tasks/ratingSync');
  const { startDailyChallenge } = require('./tasks/dailyChallenge');
  const { startSubmissionFeed } = require('./tasks/submissionFeed');
  const { startWeeklyWrapup } = require('./tasks/weeklyWrapup');
  const { startVSPoller } = require('./tasks/vsPoller');
  const { startContestWrapup } = require('./tasks/contestWrapup');
  const { startAutoBackup } = require('./tasks/autoBackup');
  const { startGitHubFeed } = require('./tasks/githubFeed');
  const { startStudyTodo } = require('./tasks/studyTodo');
  const { initializeProblemCache } = require('./utils/codeforces');
  const { initVCRecovery } = require('./commands/vc');

  initializeProblemCache().catch(err => console.error('[Startup] Cache warm-up failed:', err.message));
  initVCRecovery(client).catch(err => console.error('[Startup] VC recovery failed:', err.message));

  startContestFetcher(client);
  startRatingSync(client);
  startDailyChallenge(client);
  startSubmissionFeed(client);
  startWeeklyWrapup(client);
  startVSPoller(client);
  startContestWrapup(client);
  startAutoBackup(client);
  startGitHubFeed(client);
  startStudyTodo(client);
});

client.on('error', err => console.error('[Client Error]', err));

process.on('unhandledRejection', err => {
  console.error('[Unhandled Rejection]', err);
});

function shutdown(signal, exitCode = 0) {
  console.log(`[Shutdown] Received ${signal}. Flushing SQLite WAL and closing client...`);
  try {
    checkpointWal();
    db.close();
  } catch (err) {
    console.error('[Shutdown] DB close notice:', err.message);
  }
  try {
    client.destroy();
  } catch (_) {}
  process.exit(exitCode);
}

process.on('SIGINT', () => shutdown('SIGINT', 0));
process.on('SIGTERM', () => shutdown('SIGTERM', 0));
process.on('uncaughtException', err => {
  console.error('[Uncaught Exception]', err);
  shutdown('uncaughtException', 1);
});

client.login(token).catch(err => {
  console.error('❌ Failed to login to Discord:', err.message);
  process.exit(1);
});
