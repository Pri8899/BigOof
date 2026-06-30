require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMembers
  ]
});

client.once('ready', async () => {
  try {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    if (guild) {
      const botMember = await guild.members.fetch(process.env.CLIENT_ID).catch(() => null);
      if (botMember) {
        console.log(`Bot username: ${botMember.user.tag}`);
        console.log(`Bot status (presence): ${botMember.presence ? botMember.presence.status : 'offline/unknown'}`);
      } else {
        console.log("Bot member not found in guild!");
      }
    } else {
      console.log("Guild not found!");
    }
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    client.destroy();
  }
});

client.login(process.env.DISCORD_TOKEN);
