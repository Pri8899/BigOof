// scripts/set-bot-avatar.js — Sets the Discord bot avatar using assets/bot-avatar.png or custom image
require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

const avatarPath = process.argv[2] || path.join(__dirname, '..', 'assets', 'bot-avatar.png');

if (!process.env.DISCORD_TOKEN) {
  console.error('❌ Error: DISCORD_TOKEN is missing in your .env file!');
  process.exit(1);
}

if (!fs.existsSync(avatarPath)) {
  console.error(`❌ Error: Avatar image file not found at ${avatarPath}`);
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  try {
    console.log(`🖼️ Uploading new avatar from: ${avatarPath}...`);
    const imageBuffer = fs.readFileSync(avatarPath);
    await client.user.setAvatar(imageBuffer);
    console.log('✅ Success! Bot avatar has been updated on Discord.');
  } catch (err) {
    console.error('❌ Failed to update avatar:', err.message);
    if (err.message.includes('rate limit') || err.status === 429) {
      console.error('⚠️ Note: Discord strictly rate-limits bot avatar changes to 2 per 10 minutes.');
    }
  } finally {
    client.destroy();
    process.exit(0);
  }
});

client.login(process.env.DISCORD_TOKEN).catch(err => {
  console.error('❌ Login failed:', err.message);
  process.exit(1);
});
