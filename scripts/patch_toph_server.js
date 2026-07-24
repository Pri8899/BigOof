// patch_toph_server.js — post corrected "Unf-AI-r Task" embed to server feed channel
require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { buildSubmissionEmbed } = require('../utils/embeds');

const OWNER_ID    = '1367493270703444078';
const CHANNEL_ID  = process.env.FEED_CHANNEL_ID || process.env.GENERAL_CHANNEL_ID;

async function main() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(process.env.DISCORD_TOKEN);
  await new Promise(r => client.once('ready', r));
  console.log(`[Patch] Logged in as ${client.user.tag}`);

  const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
  if (!channel) {
    console.error(`[Patch] Could not fetch channel ${CHANNEL_ID}`);
    process.exit(1);
  }

  const fakeUser = { discord_id: OWNER_ID, username: 'parth0_paul' };

  // The problem that was solved — full real contest name
  const sub = {
    name: 'Unf-AI-r Task',
    url:  'https://toph.co/p/unf-ai-r-task',
    difficulty: 0,
    tags: [],
    contestName: 'IUT 12th ICT Fest Inter University Programming Contest 2026 - Mock'
  };

  const { getPlatformEmojis } = require('../utils/emojis');
  const emojis = await getPlatformEmojis(channel.guild);

  const embed = buildSubmissionEmbed(fakeUser, sub, 'toph', emojis);
  await channel.send({ embeds: [embed] });

  console.log('[Patch] ✅ Posted corrected Toph embed to server feed channel!');
  await client.destroy();
}

main().catch(err => { console.error(err); process.exit(1); });
