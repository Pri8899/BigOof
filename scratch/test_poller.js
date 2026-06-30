require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { getAllUsers, getLastSubmission, setLastSubmission, db } = require('../database/db');
const { runSubmissionFeed } = require('../tasks/submissionFeed');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages
  ]
});

client.once('ready', async () => {
  console.log("=== POLLER TEST START ===");
  try {
    const users = getAllUsers();
    console.log("Users in DB:", JSON.stringify(users, null, 2));
    
    for (const user of users) {
      console.log(`Checking user: ${user.username} (Discord ID: ${user.discord_id})`);
      const cfLast = getLastSubmission(user.discord_id, 'cf');
      const acLast = getLastSubmission(user.discord_id, 'ac');
      console.log(`- CF Last Submission ID: ${cfLast}`);
      console.log(`- AC Last Submission Time: ${acLast}`);
    }
    
    console.log("Running runSubmissionFeed(client)...");
    await runSubmissionFeed(client);
    console.log("runSubmissionFeed finished.");
    
    for (const user of users) {
      const cfLastNew = getLastSubmission(user.discord_id, 'cf');
      const acLastNew = getLastSubmission(user.discord_id, 'ac');
      console.log(`Checking user after run: ${user.username}`);
      console.log(`- CF Last Submission ID (new): ${cfLastNew}`);
      console.log(`- AC Last Submission Time (new): ${acLastNew}`);
    }
  } catch (err) {
    console.error("Error during test:", err);
  } finally {
    client.destroy();
    console.log("=== POLLER TEST END ===");
  }
});

client.login(process.env.DISCORD_TOKEN);
