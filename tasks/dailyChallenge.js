// tasks/dailyChallenge.js — Daily suggestions post at 9pm UTC+6 (15:00 UTC)
// Posts CF details to #cp-suggestions and tracks First Blood
const cron = require('node-cron');
const axios = require('axios');
const { EmbedBuilder } = require('discord.js');
const { getConfig, setDailyProblems, getDailyProblems, setFirstBlood, getAllUsers } = require('../database/db');
const { getCFProblems }       = require('../utils/codeforces');

// CF tiers as requested
const CF_TIERS = [
  { label: '🟢 Beginner (Rating 800)',     min: 800,  max: 800 },
  { label: '🔵 Intermediate (Rating 1000)', min: 1000, max: 1000 },
  { label: '🔴 Advanced (Rating 1200)',     min: 1200, max: 1200 }
];

// ─── Post Daily Problem Recommendations ──────────────────────
async function postDailySuggestions(client) {
  const channelId = getConfig('suggest_channel_id') || process.env.SUGGEST_CHANNEL_ID;
  if (!channelId) {
    console.log('[Suggest] No suggestions channel set. Use /set-suggest-channel');
    return;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'Asia/Dhaka'
  });

  // Fetch CF problems for all tiers
  const cfResults = await Promise.all(CF_TIERS.map(tier => getCFProblems(tier.min, tier.max, null, 1)));

  const p1 = cfResults[0]?.length > 0 ? cfResults[0][0] : null;
  const p2 = cfResults[1]?.length > 0 ? cfResults[1][0] : null;
  const p3 = cfResults[2]?.length > 0 ? cfResults[2][0] : null;

  // Save to DB for First Blood tracking
  const formatterDate = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' });
  const todayDateStr = formatterDate.format(new Date());
  setDailyProblems(todayDateStr, p1?.id || null, p2?.id || null, p3?.id || null);

  // ── Codeforces Section ──
  const cfEmbed = new EmbedBuilder()
    .setColor(0x1F8DD6)
    .setAuthor({ name: '🔵 Codeforces — Daily Practice Problems' })
    .setTitle(`💡 Daily Problem Suggestions — ${today}`)
    .setDescription('Sharpen your skills! The **First Person** to solve any of these today gets a **First Blood 🩸** broadcast!\n\u200b');

  if (p1) cfEmbed.addFields({ name: `${CF_TIERS[0].label}  ·  Rating ${p1.rating}`, value: `**[${p1.name}](${p1.url})**\n🏷️ ${p1.tags.join(', ') || 'N/A'}`, inline: false });
  if (p2) cfEmbed.addFields({ name: `${CF_TIERS[1].label}  ·  Rating ${p2.rating}`, value: `**[${p2.name}](${p2.url})**\n🏷️ ${p2.tags.join(', ') || 'N/A'}`, inline: false });
  if (p3) cfEmbed.addFields({ name: `${CF_TIERS[2].label}  ·  Rating ${p3.rating}`, value: `**[${p3.name}](${p3.url})**\n🏷️ ${p3.tags.join(', ') || 'N/A'}`, inline: false });

  cfEmbed
    .addFields({ name: '\u200b', value: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', inline: false })
    .setFooter({ text: 'Bot checks for First Blood automatically every 5 minutes!' })
    .setTimestamp();

  // Clean up old suggestion messages
  try {
    const messages = await channel.messages.fetch({ limit: 50 });
    const oldMessages = [...messages.values()].filter(m => 
      m.author.id === client.user.id && 
      m.embeds.length > 0 && 
      m.embeds[0].title?.includes('Daily Problem Suggestions')
    );
    for (const msg of oldMessages) {
      await msg.delete().catch(() => {});
    }
  } catch (err) {
    console.warn('[Suggest] Failed to clean up old messages:', err.message);
  }

  await channel.send({ content: '@everyone', embeds: [cfEmbed] }).catch(() => {});
  console.log('[Suggest] Posted daily suggestions.');
}

// ─── First Blood Checker ─────────────────────────────────────
async function checkFirstBloods(client) {
  try {
    const now = new Date();
    const formatterHour = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dhaka', hour: 'numeric', hour12: false });
    const currentHour = parseInt(formatterHour.format(now), 10);
    
    let activeDate = now;
    if (currentHour < 21) {
      activeDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }
    
    const formatterDate = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' });
    const activeDateStr = formatterDate.format(activeDate);
    
    const daily = getDailyProblems(activeDateStr);
    if (!daily) return; // No problems posted for active date

    // Check if there's any problem still missing First Blood
    if ((daily.p1_id && daily.first_blood_1) && 
        (daily.p2_id && daily.first_blood_2) && 
        (daily.p3_id && daily.first_blood_3)) {
      return; // All solved
    }

    const generalChannelId = process.env.GENERAL_CHANNEL_ID || '1505614835650658355';
    const channel = await client.channels.fetch(generalChannelId).catch(() => null);
    if (!channel) return;

    const users = getAllUsers().filter(u => u.cf_handle);
    const problemsToCheck = [
      { id: daily.p1_id, bloodField: 'first_blood_1', currentBlood: daily.first_blood_1, label: CF_TIERS[0].label },
      { id: daily.p2_id, bloodField: 'first_blood_2', currentBlood: daily.first_blood_2, label: CF_TIERS[1].label },
      { id: daily.p3_id, bloodField: 'first_blood_3', currentBlood: daily.first_blood_3, label: CF_TIERS[2].label }
    ];

    for (const user of users) {
      try {
        const res = await axios.get(`https://codeforces.com/api/user.status?handle=${user.cf_handle}&from=1&count=10`, { timeout: 6000 });
        if (res.data.status !== 'OK') continue;

        for (const sub of res.data.result) {
          if (sub.verdict === 'OK' && sub.problem) {
            const pId = `${sub.problem.contestId}${sub.problem.index}`;
            
            for (const p of problemsToCheck) {
              if (p.id === pId && !p.currentBlood) {
                // FIRST BLOOD!
                setFirstBlood(activeDateStr, p.bloodField, user.discord_id);
                p.currentBlood = user.discord_id; // prevent duplicate announcement in same loop

                const timeSec = sub.timeConsumedMillis / 1000;
                const memMb = (sub.memoryConsumedBytes / 1048576).toFixed(2);
                
                const embed = new EmbedBuilder()
                  .setColor(0xE74C3C)
                  .setTitle(`🩸 FIRST BLOOD! 🩸`)
                  .setDescription(`<@${user.discord_id}> is the absolute first person to solve today's **${p.label}** problem!`)
                  .addFields(
                    { name: 'Problem', value: `**[${sub.problem.name}](https://codeforces.com/problemset/problem/${sub.problem.contestId}/${sub.problem.index})**`, inline: false },
                    { name: 'Execution Time', value: `⏱️ ${timeSec} s`, inline: true },
                    { name: 'Memory', value: `💾 ${memMb} MB`, inline: true }
                  )
                  .setThumbnail('https://cdn-icons-png.flaticon.com/512/833/833472.png')
                  .setTimestamp();

                await channel.send({ content: `<@${user.discord_id}>`, embeds: [embed] }).catch(() => {});
                console.log(`[FirstBlood] Announced ${user.cf_handle} for problem ${pId}`);
              }
            }
          }
        }
      } catch (e) {
        // ignore CF API errors (rate limits, etc)
      }
      // slight delay to prevent rate limiting CF API
      await new Promise(r => setTimeout(r, 400));
    }
  } catch (err) {
    console.error('[FirstBlood Error]', err.message);
  }
}

// ─── Scheduler ───────────────────────────────────────────────
function startDailyChallenge(client) {
  // 9:00 PM (21:00) every day in Asia/Dhaka timezone
  cron.schedule('0 21 * * *', async () => {
    try {
      console.log('[Daily] Scheduled 9 PM daily suggestions trigger. Posting...');
      await postDailySuggestions(client);
      
      const { setConfig } = require('../database/db');
      const formatterDate = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' });
      setConfig('last_suggest_post_date', formatterDate.format(new Date()));
    } catch (err) {
      console.error('[Daily Scheduler Error]', err);
    }
  }, { timezone: 'Asia/Dhaka' });

  // Run immediately on boot with a 10s delay to perform catch-up if needed
  setTimeout(async () => {
    try {
      const formatterDate = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' });
      const formatterHour = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dhaka', hour: 'numeric', hour12: false });
      
      const todayDateStr = formatterDate.format(new Date());
      const currentHour = parseInt(formatterHour.format(new Date()), 10);
      const { getConfig, setConfig } = require('../database/db');
      const lastPostDate = getConfig('last_suggest_post_date');
      
      if (currentHour >= 21 && lastPostDate !== todayDateStr) {
        console.log('[Daily] Startup catch-up check: past 9:00 PM Dhaka and not posted today. Posting...');
        await postDailySuggestions(client);
        setConfig('last_suggest_post_date', todayDateStr);
      }
    } catch (err) {
      console.error('[Daily Startup Catch-up Error]', err);
    }
  }, 10000);

  // First Blood Checker: Runs every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    await checkFirstBloods(client);
  });

  console.log('[Daily] Strict 9 PM daily cron scheduler & 5-min First Blood checker started.');
}

module.exports = { startDailyChallenge, postDailySuggestions, checkFirstBloods };
