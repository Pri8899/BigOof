require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages
  ]
});

client.once('ready', async () => {
  try {
    const channel = await client.channels.fetch('1505614835650658355'); // General
    if (channel) {
      const { db } = require('../database/db');
      const users = db.prepare('SELECT * FROM users').all();
      const ratings = db.prepare('SELECT * FROM ratings').all();
      
      await channel.send(`🔧 **Live Database State Check**\n**Users:**\n\`\`\`json\n${JSON.stringify(users, null, 2)}\n\`\`\`\n**Ratings:**\n\`\`\`json\n${JSON.stringify(ratings, null, 2)}\n\`\`\``);
      console.log("Sent live database state check to Discord.");
    }
  } catch (err) {
    console.error("Error sending state check:", err.message);
  } finally {
    client.destroy();
  }
});

client.login(process.env.DISCORD_TOKEN);
