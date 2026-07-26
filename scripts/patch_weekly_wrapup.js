// patch_weekly_wrapup.js — delete wrong weekly wrap-up and post correct one
require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { buildWeeklyWrapupEmbed } = require('../utils/embeds');

const CHANNEL_ID = process.env.RATING_CHANNEL_ID;
const OWNER_ID   = '1367493270703444078';

async function main() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(process.env.DISCORD_TOKEN);
  await new Promise(r => client.once('ready', r));
  console.log(`[Patch] Logged in as ${client.user.tag}`);

  const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
  if (!channel) { console.error('Channel not found'); process.exit(1); }

  // ── Delete all existing wrong weekly wrap-up messages by the bot ──
  const messages = await channel.messages.fetch({ limit: 20 });
  const wrapupMsgs = [...messages.values()].filter(m =>
    m.author.id === client.user.id &&
    m.embeds.length > 0 &&
    m.embeds[0].description &&
    m.embeds[0].description.includes('Weekly Wrap-Up')
  );
  console.log(`[Patch] Found ${wrapupMsgs.length} wrap-up message(s) to delete.`);
  for (const msg of wrapupMsgs) {
    await msg.delete().catch(() => {});
    console.log(`[Patch] Deleted message ${msg.id}`);
  }

  // ── Build correct embed with real values from the screenshot ──
  // CF=8, AC=2, Toph=10 → total=20
  const allSolved = [{
    discord_id:      OWNER_ID,
    solved_this_week: 20,   // 8 + 2 + 10
    cf_solved:        8,
    ac_solved:        2,
    toph_solved:      10
  }];

  const allRatingGains = [{
    discord_id:    OWNER_ID,
    rating_gained: 0,
    cf_gain:    0, cf_start:   0, cf_end:   0, cf_linked:   true,
    ac_gain:    0, ac_start:   0, ac_end:   0, ac_linked:   true,
    toph_gain:  0, toph_start: 0, toph_end: 0, toph_linked: true
  }];

  const { getPlatformEmojis } = require('../utils/emojis');
  const emojis = await getPlatformEmojis(channel.guild);

  const embed = buildWeeklyWrapupEmbed(allSolved, allRatingGains, emojis);
  await channel.send({ content: '@everyone', embeds: [embed] });
  console.log('[Patch] ✅ Posted corrected Weekly Wrap-Up (total = 20)!');
  await client.destroy();
}

main().catch(err => { console.error(err); process.exit(1); });
