require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once('ready', async () => {
  try {
    const channel = await client.channels.fetch('1505815433255587870');
    if (channel) {
      console.log(`Fetching messages from #${channel.name}...`);
      const messages = await channel.messages.fetch({ limit: 5 });
      for (const m of messages.values()) {
        console.log(`[${m.createdAt.toISOString()}] ${m.author.username}:`);
        if (m.embeds.length > 0) {
          console.log("Embed Description:", m.embeds[0].description);
        }
      }
    } else {
      console.log("Dashboard Channel not found!");
    }
  } catch (err) {
    console.error("Error fetching dashboard:", err.message);
  } finally {
    client.destroy();
  }
});

client.login(process.env.DISCORD_TOKEN);
