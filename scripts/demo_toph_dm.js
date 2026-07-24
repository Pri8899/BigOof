// demo_toph_dm.js — sends a demo Toph accepted embed to the owner's DM
require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { buildSubmissionEmbed } = require('../utils/embeds');

const OWNER_ID = '1367493270703444078';

async function main() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(process.env.DISCORD_TOKEN);
  await new Promise(r => client.once('ready', r));
  console.log(`[Demo] Logged in as ${client.user.tag}`);

  const owner = await client.users.fetch(OWNER_ID);
  const dm    = await owner.createDM();

  // --- Demo 1: Contest problem (with full contest name in header) ---
  const fakeTophContestSub = {
    name: 'Unf-AI-r Task',
    url:  'https://toph.co/p/unf-ai-r-task',
    difficulty: 100,
    tags: ['math', 'arithmetic'],
    contestName: 'IUT 12th ICT Fest Inter University Programming Contest 2026 - Mock'
  };

  const fakeUser = {
    discord_id: OWNER_ID,
    username: 'parth0_paul'
  };

  const embed1 = buildSubmissionEmbed(fakeUser, fakeTophContestSub, 'toph', { toph: '🟣' });
  await dm.send({ content: '📋 **Demo — Toph Contest Accepted (new style)**', embeds: [embed1] });

  // --- Demo 2: Practice problem ---
  const fakeTophPracticeSub = {
    name: 'The Last Submission',
    url:  'https://toph.co/p/the-last-submission',
    difficulty: 0,
    tags: [],
    contestName: 'Practice'
  };

  const embed2 = buildSubmissionEmbed(fakeUser, fakeTophPracticeSub, 'toph', { toph: '🟣' });
  await dm.send({ content: '📋 **Demo — Toph Practice Accepted (no contest in header)**', embeds: [embed2] });

  console.log('[Demo] ✅ Sent both demo embeds to DM!');
  await client.destroy();
}

main().catch(err => { console.error(err); process.exit(1); });
