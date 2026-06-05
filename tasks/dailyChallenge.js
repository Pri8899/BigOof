// tasks/dailyChallenge.js — Daily suggestions post at 9pm UTC+6 (15:00 UTC)
// Posts CF details to #cp-suggestions and tracks First Blood
const cron = require('node-cron');
const axios = require('axios');
const { EmbedBuilder } = require('discord.js');
const { getConfig, setDailyProblems, getDailyProblems, setFirstBlood, getAllUsers, setSweepAnnounced, getRatings } = require('../database/db');
const { getCFProblems }       = require('../utils/codeforces');

// CF tiers as requested
// Removed CF_TIERS global array to calculate tiers dynamically based on user ratings

// Helper to fetch solved problems from Codeforces for all server members
async function getMergedSolvedSet() {
  const users = getAllUsers().filter(u => u.cf_handle);
  const solvedSet = new Set();

  for (const user of users) {
    try {
      console.log(`[Daily] Fetching solved history for ${user.cf_handle} to filter recommendations...`);
      // Fetch up to 2000 submissions to be comprehensive
      const res = await axios.get(`https://codeforces.com/api/user.status?handle=${user.cf_handle}&from=1&count=2000`, { timeout: 8000 });
      if (res.data.status === 'OK') {
        for (const sub of res.data.result) {
          if (sub.verdict === 'OK' && sub.problem) {
            const pId = `${sub.problem.contestId}${sub.problem.index}`;
            solvedSet.add(pId);
          }
        }
      }
    } catch (err) {
      console.warn(`[Daily] Failed to fetch solves for ${user.cf_handle}:`, err.message);
    }
    // Respect Codeforces 1 request / 2 seconds limit
    await new Promise(r => setTimeout(r, 2500));
  }
  return solvedSet;
}

// ─── Post Daily Problem Recommendations ──────────────────────
async function postDailySuggestions(client, targetDate = null) {
  const channelId = getConfig('suggest_channel_id') || process.env.SUGGEST_CHANNEL_ID;
  if (!channelId) {
    console.log('[Suggest] No suggestions channel set. Use /set-suggest-channel');
    return;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  let activeDate = targetDate;
  if (!activeDate) {
    const now = new Date();
    const formatterHour = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dhaka', hour: 'numeric', hour12: false });
    const currentHour = parseInt(formatterHour.format(now), 10);
    activeDate = now;
    if (currentHour < 21) {
      activeDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }
  }

  const today = activeDate.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'Asia/Dhaka'
  });

  const formatterDate = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' });
  const todayDateStr = formatterDate.format(activeDate);

  // Check if suggestions are already generated in the database
  const existingDaily = getDailyProblems(todayDateStr);
  
  let p1 = null;
  let p2 = null;
  let p3 = null;

  if (existingDaily) {
    console.log(`[Suggest] Today's suggestions already exist in DB. Re-using original problems...`);
    try {
      const res = await axios.get('https://codeforces.com/api/problemset.problems', { timeout: 10000 });
      if (res && res.data && res.data.status === 'OK') {
        const problems = res.data.result.problems;
        const findProb = (id) => {
          if (!id) return null;
          const p = problems.find(prob => `${prob.contestId}${prob.index}` === id);
          if (!p) return null;
          return {
            id,
            name: p.name,
            rating: p.rating ?? '?',
            tags: (p.tags ?? []).slice(0, 4),
            url: `https://codeforces.com/problemset/problem/${p.contestId}/${p.index}`
          };
        };
        p1 = findProb(existingDaily.p1_id);
        p2 = findProb(existingDaily.p2_id);
        p3 = findProb(existingDaily.p3_id);
      }
    } catch (err) {
      console.error('[Suggest] Failed to fetch existing problem details from Codeforces:', err.message);
    }
  }

  // If they don't exist in DB (or if CF API failed to fetch details), generate new ones!
  if (!p1 && !p2 && !p3) {
    console.log(`[Suggest] Generating new daily recommendations...`);
    const solvedSet = await getMergedSolvedSet();

    // Determine dynamic ratings based on linked users' ratings
    let baseRating = 1200;
    const users = getAllUsers().filter(u => u.cf_handle);
    const ratedUsers = [];
    for (const u of users) {
      const userRatings = getRatings(u.discord_id);
      const cf = userRatings.find(r => r.platform === 'cf');
      if (cf && cf.rating > 0) {
        ratedUsers.push(cf.rating);
      }
    }
    if (ratedUsers.length > 0) {
      const avgRating = ratedUsers.reduce((sum, r) => sum + r, 0) / ratedUsers.length;
      baseRating = Math.round(avgRating / 100) * 100;
    }

    let easyRating = 800;
    let mediumRating = 1000;
    let hardRating = 1200;

    if (baseRating <= 900) {
      easyRating = 800;
      mediumRating = 900;
      hardRating = 1000;
    } else if (baseRating === 1000) {
      easyRating = 800;
      mediumRating = 1000;
      hardRating = 1100;
    } else {
      easyRating = Math.max(800, baseRating - 200);
      mediumRating = Math.max(800, baseRating);
      hardRating = Math.max(800, baseRating + 200);
    }

    const tiers = [
      { min: easyRating, max: easyRating },
      { min: mediumRating, max: mediumRating },
      { min: hardRating, max: hardRating }
    ];

    const cfResults = await Promise.all(tiers.map(tier => getCFProblems(tier.min, tier.max, null, 1, solvedSet)));
    p1 = cfResults[0]?.length > 0 ? cfResults[0][0] : null;
    p2 = cfResults[1]?.length > 0 ? cfResults[1][0] : null;
    p3 = cfResults[2]?.length > 0 ? cfResults[2][0] : null;
    
    // Save to DB
    setDailyProblems(todayDateStr, p1?.id || null, p2?.id || null, p3?.id || null);
  }

  // ── Codeforces Section ──
  const { getPlatformEmojis } = require('../utils/emojis');
  const emojis = await getPlatformEmojis(channel.guild);

  const cfEmbed = new EmbedBuilder()
    .setColor(0x1F8DD6)
    .setDescription(`# \u2003\u2003${emojis.cf} Codeforces — Daily Practice Problems\n### \u2003\u2003\u2003💡 Daily Problem Suggestions — ${today}\n\nSharpen your skills! The **First Person** to solve any of these gets a **First Blood 🩸** broadcast!\n\u200b`);

  if (p1) cfEmbed.addFields({ name: `🟢 Easy (Rating ${p1.rating})`, value: `**[${p1.name}](${p1.url})**\n🏷️ ${p1.tags.join(', ') || 'N/A'}`, inline: false });
  if (p2) cfEmbed.addFields({ name: `🔵 Medium (Rating ${p2.rating})`, value: `**[${p2.name}](${p2.url})**\n🏷️ ${p2.tags.join(', ') || 'N/A'}`, inline: false });
  if (p3) cfEmbed.addFields({ name: `🔴 Hard (Rating ${p3.rating})`, value: `**[${p3.name}](${p3.url})**\n🏷️ ${p3.tags.join(', ') || 'N/A'}`, inline: false });

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
      ((m.embeds[0].title && m.embeds[0].title.includes('Daily Problem Suggestions')) ||
       (m.embeds[0].description && m.embeds[0].description.includes('Daily Problem Suggestions')))
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

// Calculate active cycle window (9pm Dhaka to 9pm Dhaka next day, which corresponds to 15:00 UTC to 15:00 UTC)
function getActiveCycleWindow(activeDate) {
  const activeYear = parseInt(activeDate.toLocaleDateString('en-US', { timeZone: 'Asia/Dhaka', year: 'numeric' }), 10);
  const activeMonth = parseInt(activeDate.toLocaleDateString('en-US', { timeZone: 'Asia/Dhaka', month: 'numeric' }), 10);
  const activeDay = parseInt(activeDate.toLocaleDateString('en-US', { timeZone: 'Asia/Dhaka', day: 'numeric' }), 10);
  
  const startTimeUtc = Date.UTC(activeYear, activeMonth - 1, activeDay, 15, 0, 0) / 1000;
  const endTimeUtc = startTimeUtc + 24 * 60 * 60;
  return { startTimeUtc, endTimeUtc };
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

    const { startTimeUtc, endTimeUtc } = getActiveCycleWindow(activeDate);

    const generalChannelId = process.env.GENERAL_CHANNEL_ID || '1505614835650658355';
    const channel = await client.channels.fetch(generalChannelId).catch(() => null);
    if (!channel) return;

    const users = getAllUsers().filter(u => u.cf_handle);
    const problemsToCheck = [
      { id: daily.p1_id, bloodField: 'first_blood_1', currentBlood: daily.first_blood_1, label: '🟢 Easy' },
      { id: daily.p2_id, bloodField: 'first_blood_2', currentBlood: daily.first_blood_2, label: '🔵 Medium' },
      { id: daily.p3_id, bloodField: 'first_blood_3', currentBlood: daily.first_blood_3, label: '🔴 Hard' }
    ];

    const problemDetails = {};

    for (const user of users) {
      try {
        const res = await axios.get(`https://codeforces.com/api/user.status?handle=${user.cf_handle}&from=1&count=100`, { timeout: 8000 });
        if (res.data.status !== 'OK') continue;

        const solvedInWindow = new Set();

        for (const sub of res.data.result) {
          if (sub.verdict === 'OK' && sub.problem) {
            const pId = `${sub.problem.contestId}${sub.problem.index}`;
            
            // Validate that submission is within active window
            if (sub.creationTimeSeconds >= startTimeUtc && sub.creationTimeSeconds < endTimeUtc) {
              if (pId === daily.p1_id || pId === daily.p2_id || pId === daily.p3_id) {
                solvedInWindow.add(pId);
                if (!problemDetails[pId]) {
                  problemDetails[pId] = {
                    name: sub.problem.name,
                    url: `https://codeforces.com/problemset/problem/${sub.problem.contestId}/${sub.problem.index}`
                  };
                }
              }

              // Check First Blood
              for (const p of problemsToCheck) {
                if (p.id === pId && !p.currentBlood) {
                  // FIRST BLOOD!
                  setFirstBlood(activeDateStr, p.bloodField, user.discord_id);
                  p.currentBlood = user.discord_id;

                  const timeSec = sub.timeConsumedMillis / 1000;
                  const memMb = (sub.memoryConsumedBytes / 1048576).toFixed(2);
                  
                  const embed = new EmbedBuilder()
                    .setColor(0xE74C3C)
                    .setTitle(`🩸 FIRST BLOOD! 🩸`)
                    .setDescription(`<@${user.discord_id}> is the absolute first person to solve the daily **${p.label}** problem!`)
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
        }

        // Check if user solved all suggested problems
        const suggestedProblemIds = [daily.p1_id, daily.p2_id, daily.p3_id].filter(Boolean);
        if (suggestedProblemIds.length > 0 && suggestedProblemIds.every(id => solvedInWindow.has(id))) {
          let sweepAnnounced = [];
          try {
            sweepAnnounced = JSON.parse(daily.sweep_announced || '[]');
          } catch (_) {}

          if (!sweepAnnounced.includes(user.discord_id)) {
            sweepAnnounced.push(user.discord_id);
            const updatedJson = JSON.stringify(sweepAnnounced);
            setSweepAnnounced(activeDateStr, updatedJson);
            daily.sweep_announced = updatedJson; // update cache

            const getProbLink = (id, defaultLabel) => {
              if (problemDetails[id]) {
                return `**[${problemDetails[id].name}](${problemDetails[id].url})**`;
              }
              const match = id.match(/^(\d+)(.+)$/);
              if (match) {
                return `**[Problem ${match[1]}${match[2]}](https://codeforces.com/problemset/problem/${match[1]}/${match[2]})**`;
              }
              return `**[${defaultLabel}](https://codeforces.com/problemset/problem)**`;
            };

            const sweepEmbed = new EmbedBuilder()
              .setColor(0xF1C40F) // Gold
              .setTitle('🏆 DAILY CHALLENGE SWEEP! 🏆')
              .setDescription(`🎉 **Congratulations to <@${user.discord_id}>!** 🎉\n\nThey have successfully solved **all 3** of the daily practice problems within the active daily cycle!`)
              .addFields(
                { name: `🟢 Easy`, value: getProbLink(daily.p1_id, 'Easy Problem'), inline: false },
                { name: `🔵 Medium`, value: getProbLink(daily.p2_id, 'Medium Problem'), inline: false },
                { name: `🔴 Hard`, value: getProbLink(daily.p3_id, 'Hard Problem'), inline: false }
              )
              .setThumbnail('https://cdn-icons-png.flaticon.com/512/3112/3112946.png')
              .setFooter({ text: 'Daily Sweep achieved!' })
              .setTimestamp();

            await channel.send({ content: `🏆 **Daily Sweep!** <@${user.discord_id}> has cleared all 3 daily problems!`, embeds: [sweepEmbed] }).catch(() => {});
            console.log(`[Sweep] Announced ${user.cf_handle} for daily sweep of date ${activeDateStr}`);
          }
        }
      } catch (e) {
        console.warn(`[FirstBlood] Error checking handle ${user.cf_handle}:`, e.message);
      }
      // slight delay to prevent rate limiting CF API (respecting 1 request / 2 seconds limit)
      await new Promise(r => setTimeout(r, 2500));
    }
  } catch (err) {
    console.error('[FirstBlood Error]', err.message);
  }
}

// One-time startup resets (no-op now)
async function runOneTimeStartupReset(client) {}

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
      // 1. Run one-time startup reset first
      await runOneTimeStartupReset(client);

      // 2. Then perform the catch-up check
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
