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
    const channel = await client.channels.fetch('1505614835650658355');
    if (channel) {
      console.log(`Fetching messages from #${channel.name}...`);
      const messages = await channel.messages.fetch({ limit: 10 });
      for (const m of messages.values()) {
        console.log(`[${m.createdAt.toISOString()}] ${m.author.username}: ${m.content}`);
        if (m.embeds.length > 0) {
          console.log("Embeds:", JSON.stringify(m.embeds, null, 2));
        }
      }
    } else {
      console.log("Channel not found!");
    }
  } catch (err) {
    console.error("Error fetching messages:", err.message);
  } finally {
    client.destroy();
  }
});

client.login(process.env.DISCORD_TOKEN);
