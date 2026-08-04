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


  // One-time direct announcement for August 4 Daily Suggestions (bypasses CF API entirely)
  try {
    const suggestPatchKey = 'patched_daily_suggest_aug4_v1';
    const alreadyDone = db.prepare('SELECT value FROM guild_config WHERE key = ?').get(suggestPatchKey);
    if (!alreadyDone) {
      const channelId = getConfig('suggest_channel_id');
      if (channelId) {
        setTimeout(async () => {
          try {
            const channel = await client.channels.fetch(channelId).catch(() => null);
            if (!channel) { console.error('[Force Suggest] Channel not found:', channelId); return; }
            
            // Delete the bad empty entry and insert the hardcoded problems
            db.prepare("DELETE FROM daily_problems WHERE date_str = ?").run('08/04/2026');
            db.prepare(`
              INSERT INTO daily_problems (date_str, p1_id, p2_id, p3_id, p4_id, p5_id)
              VALUES (?, ?, ?, ?, ?, ?)
            `).run('08/04/2026', '1955A', '1978B', '1915D', '1899E', '1872F');

            const { EmbedBuilder } = require('discord.js');
            const cfEmbed = new EmbedBuilder()
              .setColor(0x2B2D31)
              .setAuthor({ name: 'Codeforces Daily Challenges', iconURL: 'https://cdn-icons-png.flaticon.com/512/833/833472.png' })
              .setTitle(`🗓️ Daily Problem Suggestions — Tuesday, August 4`)
              .setDescription(`Sharpen your skills with today's progressive challenges! 🚀\nThe **First Person** to solve any of these gets a **First Blood 🩸** broadcast!\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`)
              .addFields(
                { name: `🌱 Level 1 (Rating 800)`, value: `**[Yogurt Sale](https://codeforces.com/problemset/problem/1955/A)**\n\`math, greedy\``, inline: false },
                { name: `⚔️ Level 2 (Rating 900)`, value: `**[New Bakery](https://codeforces.com/problemset/problem/1978/B)**\n\`math, greedy\``, inline: false },
                { name: `🔥 Level 3 (Rating 1100)`, value: `**[Unnatural Language Processing](https://codeforces.com/problemset/problem/1915/D)**\n\`strings, greedy\``, inline: false },
                { name: `⚡ Level 4 (Rating 1400)`, value: `**[Queue Sort](https://codeforces.com/problemset/problem/1899/E)**\n\`greedy, sorting\``, inline: false },
                { name: `👑 Level 5 (Rating 1800)`, value: `**[Selling a Menagerie](https://codeforces.com/problemset/problem/1872/F)**\n\`graphs, greedy\``, inline: false }
              )
              .setFooter({ text: 'Bot checks for First Blood automatically every 5 minutes!' })
              .setTimestamp();
              
            await channel.send({ content: '@everyone', embeds: [cfEmbed] });
            db.prepare('INSERT INTO guild_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(suggestPatchKey, 'true');
            console.log('[Force Suggest] Successfully posted Aug 4 suggestions.');
          } catch (err) {
            console.error('[Force Suggest] Failed:', err.message);
          }
        }, 5000);
      }
    }
  } catch (err) {
    console.error('[Force Suggest Error]', err.message);
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
