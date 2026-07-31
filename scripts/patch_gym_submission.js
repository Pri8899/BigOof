// patch_gym_submission.js — delete wrong CF gym embed and post corrected one
require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const { buildSubmissionEmbed } = require('../utils/embeds');
const { getPlatformEmojis } = require('../utils/emojis');

const OWNER_ID  = '1367493270703444078';
const USERNAME  = 'parth0_paul';
const CF_HANDLE = 'ImposterBhO0';

const CHANNEL_ID = process.env.FEED_CHANNEL_ID || process.env.GENERAL_CHANNEL_ID;

const CF_BASE = 'https://codeforces.com/api';

async function main() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(process.env.DISCORD_TOKEN);
  await new Promise(r => client.once('ready', r));
  console.log(`[Patch] Logged in as ${client.user.tag}`);

  const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
  if (!channel) { console.error('Channel not found:', CHANNEL_ID); process.exit(1); }

  // ── Fetch recent CF submissions to find "Fraction Again" ──────────
  console.log('[Patch] Fetching CF submissions for ImposterBhO0...');
  const res = await axios.get(`${CF_BASE}/user.status?handle=${CF_HANDLE}&from=1&count=50`, { timeout: 10000 });
  if (res.data.status !== 'OK') { console.error('CF API error'); process.exit(1); }

  const sub = res.data.result.find(s =>
    s.verdict === 'OK' && s.problem && s.problem.name.includes('Fraction Again')
  );
  if (!sub) { console.error('Submission not found'); process.exit(1); }

  const prob = sub.problem;
  console.log(`[Patch] Found: ${prob.index}. ${prob.name} | contest=${prob.contestId}`);

  // Gym contest 106631 = "IUT 12th ICT Fest Inter University Programming Contest 2026"
  // (contest.standings API returns 400 for this private/protected gym — hardcoded from screenshot)
  let contestName = 'IUT 12th ICT Fest Inter University Programming Contest 2026';
  try {
    const cn = await axios.get(
      `${CF_BASE}/contest.standings?contestId=${prob.contestId}&from=1&count=1&showUnofficial=true`,
      { timeout: 10000 }
    );
    if (cn.data.status === 'OK' && cn.data.result?.contest) {
      contestName = cn.data.result.contest.name;
    }
  } catch (e) {
    console.warn('[Patch] Could not fetch contest name from API, using known name.');
  }
  console.log(`[Patch] Contest name: ${contestName}`);

  const isGym = Number(prob.contestId) >= 100000;
  const problemUrl = isGym
    ? `https://codeforces.com/gym/${prob.contestId}/problem/${prob.index}`
    : `https://codeforces.com/problemset/problem/${prob.contestId}/${prob.index}`;

  // ── Delete wrong bot messages about Fraction Again ────────────────
  const messages = await channel.messages.fetch({ limit: 50 });
  const oldMsgs = [...messages.values()].filter(m =>
    m.author.id === client.user.id &&
    m.embeds.length > 0 &&
    m.embeds[0].description &&
    m.embeds[0].description.includes('Fraction Again')
  );
  console.log(`[Patch] Deleting ${oldMsgs.length} old message(s)...`);
  for (const msg of oldMsgs) {
    await msg.delete().catch(() => {});
    console.log(`[Patch] Deleted ${msg.id}`);
  }

  // ── Post corrected embed ──────────────────────────────────────────
  const fakeUser = { discord_id: OWNER_ID, username: USERNAME };
  const problem  = {
    name:        prob.name,
    index:       prob.index,
    url:         problemUrl,
    rating:      prob.rating || null,
    tags:        prob.tags   || [],
    contestId:   prob.contestId,
    contestName: contestName
  };

  const emojis = await getPlatformEmojis(channel.guild);
  const embed  = buildSubmissionEmbed(fakeUser, problem, 'cf', emojis);
  await channel.send({ embeds: [embed] });

  console.log(`[Patch] ✅ Posted: ${prob.index}. ${prob.name} | contest=${contestName}`);
  await client.destroy();
}

main().catch(err => { console.error(err); process.exit(1); });
