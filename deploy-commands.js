// deploy-commands.js — Register slash commands with Discord API
require('dotenv').config();

const { REST, Routes } = require('discord.js');
const fs   = require('fs');
const path = require('path');

const commands = [];

// Recursively collect command data
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
        console.log(`  + ${cmd.data.name}`);
      }
    }
  }
}

console.log('\n📡 Collecting slash commands...');
collectCommands(path.join(__dirname, 'commands'));
console.log(`\nTotal: ${commands.length} command(s)\n`);

const CLIENT_ID = process.env.CLIENT_ID || '1505812368284717087';
const GUILD_ID  = process.env.GUILD_ID  || '1505604240612266176';

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('🚀 Registering commands with Discord API...');

    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );

    console.log('✅ All slash commands registered successfully!\n');
    console.log('You can now run: node index.js\n');
  } catch (err) {
    console.error('❌ Failed to register commands:', err);
    process.exit(1);
  }
})();
