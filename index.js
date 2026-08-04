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


  // One-time direct announcement for missed 2249-A solve (bypasses CF API entirely)
  try {
    const announceKey = 'announced_cf_2249A_ImposterBhO0_v2';
    const alreadyDone = db.prepare('SELECT value FROM guild_config WHERE key = ?').get(announceKey);
    if (!alreadyDone) {
      const channelId = getConfig('feed_channel_id') || getConfig('dashboard_channel_id') || getConfig('rating_channel_id');
      if (channelId) {
        setTimeout(async () => {
          try {
            const channel = await client.channels.fetch(channelId).catch(() => null);
            if (!channel) { console.error('[Force Announce] Channel not found:', channelId); return; }
            const { EmbedBuilder } = require('discord.js');
            const embed = new EmbedBuilder()
              .setColor(0x1F8DD6)
              .setAuthor({ name: 'Codeforces — Live Accepted!' })
              .setTitle('🎉 _Parth0_ just got Accepted!')
              .setDescription('<@1367493270703444078> solved **[A. Rank Subsequence](https://codeforces.com/contest/2249/problem/A)**!')
              .setThumbnail('https://codeforces.org/s/0/images/codeforces-telegram-square.png')
              .addFields(
                { name: '📊 Difficulty', value: '🟢 Unrated', inline: true },
                { name: '🏷️ Tags', value: 'greedy, math, sorting', inline: true },
                { name: '🏆 Contest', value: 'Codeforces Round 1112 (Div. 1)', inline: false }
              )
              .setTimestamp()
              .setFooter({ text: 'Keep grinding! 💪' });
            await channel.send({ embeds: [embed] });
            db.prepare("INSERT OR IGNORE INTO processed_submissions (id, timestamp) VALUES (?, ?)").run('cf_prob_1367493270703444078_2249_A', Math.floor(Date.now() / 1000));
            db.prepare('INSERT INTO guild_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(announceKey, 'true');
            console.log('[Force Announce] Successfully posted 2249-A announcement.');
          } catch (err) {
            console.error('[Force Announce] Failed:', err.message);
          }
        }, 5000);
      }
    }
  } catch (err) {
    console.error('[Force Announce Error]', err.message);
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
