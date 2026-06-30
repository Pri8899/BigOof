require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages
  ]
});

client.once('ready', async () => {
  try {
    console.log("Fetching DM history for owner 1367493270703444078...");
    const owner = await client.users.fetch('1367493270703444078');
    if (owner) {
      const dmChannel = await owner.createDM();
      const messages = await dmChannel.messages.fetch({ limit: 5 });
      for (const m of messages.values()) {
        console.log(`[${m.createdAt.toISOString()}] ${m.author.username}:`);
        console.log(m.content);
        console.log("-----------------------------------------");
      }
    } else {
      console.log("Owner not found!");
    }
  } catch (err) {
    console.error("Error fetching DMs:", err.message);
  } finally {
    client.destroy();
  }
});

client.login(process.env.DISCORD_TOKEN);
