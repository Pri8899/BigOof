// deploy-commands.js — Register slash commands with Discord API
require('dotenv').config();

const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { getValidId } = require('./utils/envHelper');

const commands = [];

function collectCommands(dir) {
  const files = fs.readdirSync(dir, { withFileTypes: true });
  for (const file of files) {
    const fullPath = path.join(dir, file.name);
    if (file.isDirectory()) {
      collectCommands(fullPath);
    } else if (file.name.endsWith('.js')) {
      const cmd = require(fullPath);
      if (cmd.data) {
        commands.push(cmd.data.toJSON());
        console.log(`  + /${cmd.data.name}`);
      }
    }
  }
}

console.log('\n📡 Collecting slash commands...');
collectCommands(path.join(__dirname, 'commands'));
console.log(`\nTotal: ${commands.length} command(s)\n`);

const CLIENT_ID = getValidId(process.env.CLIENT_ID, null);
const GUILD_ID = getValidId(process.env.GUILD_ID, null);
const TOKEN = process.env.DISCORD_TOKEN?.trim();

if (!TOKEN || TOKEN.includes('your_')) {
  console.error('❌ Error: DISCORD_TOKEN is missing or invalid in your .env file!');
  process.exit(1);
}

if (!CLIENT_ID) {
  console.error('❌ Error: CLIENT_ID (Application ID) is missing or invalid in your .env file!');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    if (GUILD_ID) {
      console.log(`🚀 Registering commands for guild (${GUILD_ID})...`);
      await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        { body: commands }
      );
      console.log('✅ Guild slash commands registered successfully!\n');
    } else {
      console.log('🚀 Registering commands globally across all servers...');
      await rest.put(
        Routes.applicationCommands(CLIENT_ID),
        { body: commands }
      );
      console.log('✅ Global slash commands registered successfully!\n');
    }
  } catch (err) {
    console.error('❌ Failed to register commands:', err);
    process.exit(1);
  }
})();
