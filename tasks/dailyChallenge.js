// tasks/dailyChallenge.js — Daily suggestions post at 9pm UTC+6 (15:00 UTC)
// Posts CF + AtCoder details to #cp-suggestions
const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');
const { getConfig }           = require('../database/db');
const { getCFProblems }       = require('../utils/codeforces');
const { getACContests }       = require('../utils/atcoder');

// CF tiers
const CF_TIERS = [
  { label: '🟢 Beginner',     min: 800,  max: 1200 },
  { label: '🔵 Intermediate', min: 1400, max: 1800 },
  { label: '🔴 Advanced',     min: 2000, max: 2400 }
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

  // ── Codeforces Section ──
  const cfEmbed = new EmbedBuilder()
    .setColor(0x1F8DD6)
    .setAuthor({ name: '🔵 Codeforces — Daily Practice Problems' })
    .setTitle(`💡 Daily Problem Suggestions — ${today}`)
    .setDescription('Sharpen your skills with today\'s picks across all platforms!\n\u200b');

  CF_TIERS.forEach((tier, i) => {
    const problems = cfResults[i];
    if (problems.length > 0) {
      const p = problems[0];
      cfEmbed.addFields({
        name:  `${tier.label}  ·  CF Rating ${p.rating}`,
        value: `**[${p.name}](${p.url})**\n🏷️ ${p.tags.join(', ') || 'N/A'}`,
        inline: false
      });
    }
  });

  cfEmbed
    .addFields({ name: '\u200b', value: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', inline: false })
    .setFooter({ text: 'React with your solve ✅ in this channel!' })
    .setTimestamp();

  await channel.send({ embeds: [cfEmbed] }).catch(() => {});

  // ── AtCoder Section ──
  // Fetch upcoming contests as a bonus — AC doesn't have an open problem API
  // So we show today's suggestion as "practice on these recent contests"
  const acEmbed = new EmbedBuilder()
    .setColor(0xE74C3C)
    .setAuthor({ name: '🔴 AtCoder — Practice Recommendation' })
    .addFields({
      name:  '📚 AtCoder Practice',
      value: `**[AtCoder Problems](https://kenkoooo.com/atcoder/#/table/)**\nUse AtCoder Problems to find recommended problems by difficulty rating!\n\n🔗 [Virtual Contest on AtCoder Problems](https://kenkoooo.com/atcoder/#/contest/recent)`,
      inline: false
    })
    .setFooter({ text: 'AtCoder problem API is not publicly available' })
    .setTimestamp();

  await channel.send({ embeds: [acEmbed] }).catch(() => {});

  console.log('[Suggest] Posted daily suggestions for all 3 platforms.');
}

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

  console.log('[Daily] Strict 9 PM daily cron scheduler started.');
}

module.exports = { startDailyChallenge, postDailySuggestions };
