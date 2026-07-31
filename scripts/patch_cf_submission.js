// patch_cf_submission.js — delete old CF accepted embed and repost with correct problem index
require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const { buildSubmissionEmbed } = require('../utils/embeds');
const { getPlatformEmojis } = require('../utils/emojis');

const OWNER_ID   = '1367493270703444078';
const CF_HANDLE  = 'ImposterBhO0';
const USERNAME   = 'parth0_paul';
// Feed channel: try config DB (not available in sandbox), fallback to env
const CHANNEL_ID = process.env.FEED_CHANNEL_ID || process.env.GENERAL_CHANNEL_ID;

async function main() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(process.env.DISCORD_TOKEN);
  await new Promise(r => client.once('ready', r));
  console.log(`[Patch] Logged in as ${client.user.tag}`);

  const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
  if (!channel) { console.error('Channel not found:', CHANNEL_ID); process.exit(1); }

  // ── Fetch the real problem index from CF API ──────────────────────
  console.log('[Patch] Fetching CF submissions to find "Rank Subsequence"...');
  const res = await axios.get(`https://codeforces.com/api/user.status?handle=${CF_HANDLE}&from=1&count=50`, { timeout: 10000 });
  const submissions = res.data.result || [];
  const rankSub = submissions.find(s =>
    s.verdict === 'OK' && s.problem && s.problem.name === 'Rank Subsequence'
  );

  if (!rankSub) {
    console.error('[Patch] Could not find "Rank Subsequence" in recent submissions.');
    process.exit(1);
  }

  const prob = rankSub.problem;
  console.log(`[Patch] Found: ${prob.index}. ${prob.name} | rating=${prob.rating} | tags=${prob.tags?.join(', ')}`);

  const isGym = Number(prob.contestId) >= 100000;
  const problemUrl = isGym
    ? `https://codeforces.com/gym/${prob.contestId}/problem/${prob.index}`
    : `https://codeforces.com/problemset/problem/${prob.contestId}/${prob.index}`;

  // Fetch contest name
  let contestName = 'Codeforces Round 1112 (Div. 2)'; // known from screenshot
  try {
    const cnRes = await axios.get(`https://codeforces.com/api/contest.list?gym=false`, { timeout: 8000 });
    if (cnRes.data.status === 'OK') {
      const found = cnRes.data.result.find(c => c.id === Number(prob.contestId));
      if (found) contestName = found.name;
    }
  } catch (_) {}

  // ── Delete old bot accepted messages containing "Rank Subsequence" ──
  const messages = await channel.messages.fetch({ limit: 50 });
  const oldMsgs = [...messages.values()].filter(m =>
    m.author.id === client.user.id &&
    m.embeds.length > 0 &&
    m.embeds[0].description &&
    m.embeds[0].description.includes('Rank Subsequence')
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
    index:       prob.index,      // <── This is what was missing before!
    url:         problemUrl,
    rating:      prob.rating,
    tags:        prob.tags,
    contestName: contestName
  };

  const emojis = await getPlatformEmojis(channel.guild);
  const embed  = buildSubmissionEmbed(fakeUser, problem, 'cf', emojis);
  await channel.send({ embeds: [embed] });

  console.log(`[Patch] ✅ Posted corrected embed: ${prob.index}. ${prob.name}`);
  await client.destroy();
}

main().catch(err => { console.error(err); process.exit(1); });
