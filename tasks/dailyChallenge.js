// tasks/dailyChallenge.js — Daily problem suggestions at 9 PM & 5-min First Blood / Sweep tracker
const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');
const {
  getConfig,
  setConfig,
  setDailyProblems,
  getDailyProblems,
  tryClaimFirstBlood,
  tryMarkSweepAnnounced,
  getAllUsers,
  getRatings
} = require('../database/db');
const { getCFProblems, getCFStatus, getProblemsetCache, extractSolvedIds } = require('../utils/codeforces');
const { resolveChannelChain, getGuildTargetChannels, replaceChannelBotMessage } = require('../utils/envHelper');
const { getTimeZone, getLocalParts, zonedDateTimeToUnix } = require('../utils/time');
const { getCalendarEmoji } = require('../utils/calendarEmoji');

let isFirstBloodRunning = false;

function getActiveCycleDate(now = new Date(), tz = getTimeZone()) {
  const { hour } = getLocalParts(now, tz);
  if (hour < 21) {
    return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }
  return now;
}

function getActiveCycleWindow(activeDate, tz = getTimeZone()) {
  const { year, month, day } = getLocalParts(activeDate, tz);
  const startTimeUtc = zonedDateTimeToUnix(year, month, day, 21, 0, 0, tz);
  return { startTimeUtc, endTimeUtc: startTimeUtc + 24 * 60 * 60 };
}

async function getMergedSolvedSet() {
  const users = getAllUsers().filter(u => u.cf_handle);
  const solvedSet = new Set();

  for (const user of users) {
    const subs = await getCFStatus(user.cf_handle, 2000);
    extractSolvedIds(subs, solvedSet);
    await new Promise(r => setTimeout(r, 2000));
  }
  return solvedSet;
}

/**
 * Generates or re-posts today's 5 progressive daily challenges. Returns true if posted.
 */
async function postDailySuggestions(client, targetDate = null) {
  const TZ = getTimeZone();
  const activeDate = targetDate || getActiveCycleDate(new Date(), TZ);
  const { dateStr: todayDateStr } = getLocalParts(activeDate, TZ);

  const todayDisplay = activeDate.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: TZ
  });

  const existingDaily = getDailyProblems(todayDateStr);
  let p1 = null, p2 = null, p3 = null, p4 = null, p5 = null;

  if (existingDaily) {
    console.log(`[Daily] Reusing stored challenges for ${todayDateStr}...`);
    const cachedSet = await getProblemsetCache();
    if (Array.isArray(cachedSet)) {
      const findProb = (id) => {
        if (!id) return null;
        const p = cachedSet.find(prob => `${prob.contestId}${prob.index}` === id);
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
      p4 = findProb(existingDaily.p4_id);
      p5 = findProb(existingDaily.p5_id);
    }
  }

  if (!p1 && !p2 && !p3 && !p4 && !p5) {
    console.log('[Daily] Generating 5 new tiered recommendations...');
    const excludeSet = await getMergedSolvedSet();

    let baseRating = 1200;
    const users = getAllUsers().filter(u => u.cf_handle);
    const ratedUsers = [];
    for (const u of users) {
      const cf = getRatings(u.discord_id).find(r => r.platform === 'cf');
      if (cf && cf.rating > 0) ratedUsers.push(cf.rating);
    }
    if (ratedUsers.length > 0) {
      const avgRating = ratedUsers.reduce((sum, r) => sum + r, 0) / ratedUsers.length;
      baseRating = Math.round(avgRating / 100) * 100;
    }

    const r1 = 800;
    const r2 = Math.min(3500, Math.max(r1 + 100, baseRating));
    const r3 = Math.min(3500, Math.max(r2 + 200, baseRating + 200));
    const r4 = Math.min(3500, Math.max(r3 + 300, baseRating + 500));
    const r5 = Math.min(3500, Math.max(r4 + 400, baseRating + 900));

    let prevPrimaryTag = new Set();
    const fetchTier = async (rating) => {
      const res = await getCFProblems(rating, rating, null, 1, excludeSet, null, prevPrimaryTag);
      const prob = res?.length > 0 ? res[0] : null;
      if (prob) {
        excludeSet.add(prob.id);
        prevPrimaryTag = prob.tags?.[0] ? new Set([prob.tags[0].toLowerCase()]) : new Set();
      }
      return prob;
    };

    p1 = await fetchTier(r1);
    p2 = await fetchTier(r2);
    p3 = await fetchTier(r3);
    p4 = await fetchTier(r4);
    p5 = await fetchTier(r5);

    if (!p1 && !p2 && !p3 && !p4 && !p5) {
      console.error('[Daily] CF API failed and no problems were generated. Skipping DB save & post.');
      return false;
    }

    setDailyProblems(todayDateStr, p1?.id || null, p2?.id || null, p3?.id || null, p4?.id || null, p5?.id || null);
  }

  const dateCalEmoji = await getCalendarEmoji(client, activeDate, TZ);

  const cfEmbed = new EmbedBuilder()
    .setColor(0x7C4DFF)
    .setAuthor({
      name: 'Codeforces Daily Arena',
      iconURL: 'https://codeforces.org/s/0/images/codeforces-telegram-square.png'
    })
    .setTitle(`🎯 Daily Coding Quests — ${todayDisplay}`)
    .setDescription(
      `> ${dateCalEmoji} **Date:** **${todayDisplay}**\n` +
      '> 🎯 **Sharpen your algorithms with 5 tiered challenges for today!**\n' +
      '> 🩸 **First Blood**: Be the very first coder in the server to solve any level!\n' +
      '> 🏆 **Daily Sweep**: Solve all 5 to claim the daily champion crown!\n\n' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'
    )
    .setFooter({ text: 'BigOof Daily Arena · Verified automatically every 5m', iconURL: 'https://cdn-icons-png.flaticon.com/512/3112/3112946.png' })
    .setTimestamp();

  const formatProbField = (label, icon, p) => {
    if (!p) return null;
    const tagStr = p.tags?.length > 0 ? p.tags.slice(0, 3).join(' • ') : 'Implementation';
    return {
      name: `${icon} ${label} · ⭐ ${p.rating || 'Standard'}`,
      value: `**[${p.name}](${p.url})**\n\`🏷️ ${tagStr}\``,
      inline: false
    };
  };

  if (p1) cfEmbed.addFields(formatProbField('Level 1 (Novice)', '🌱', p1));
  if (p2) cfEmbed.addFields(formatProbField('Level 2 (Pupil)', '⚔️', p2));
  if (p3) cfEmbed.addFields(formatProbField('Level 3 (Specialist)', '🔥', p3));
  if (p4) cfEmbed.addFields(formatProbField('Level 4 (Expert)', '⚡', p4));
  if (p5) cfEmbed.addFields(formatProbField('Level 5 (Master)', '👑', p5));

  const targets = await getGuildTargetChannels(client, 'suggest_channel_id', 'SUGGEST_CHANNEL_ID');
  if (targets.length === 0) {
    console.log('[Daily] No suggest channels configured across guilds.');
    return false;
  }

  let postedAny = false;
  for (const { channel } of targets) {
    const sent = await replaceChannelBotMessage(client, channel, {
      matchMessage: (m) =>
        m.embeds.length > 0 &&
        (m.embeds[0].title?.includes('Daily Coding Quests') ||
         m.embeds[0].title?.includes('Daily Problem Suggestions') ||
         m.embeds[0].description?.includes('Daily Problem Suggestions')),
      payload: { content: '@everyone', embeds: [cfEmbed] },
      fallbackPayload: { embeds: [cfEmbed] },
      logLabel: 'Daily'
    });
    if (sent) postedAny = true;
  }

  if (postedAny) {
    console.log(`[Daily] Posted daily challenges to ${targets.length} channel(s).`);
  }
  return postedAny;
}

async function broadcastToUserGuilds(client, discordId, payloadBuilder) {
  for (const guild of client.guilds.cache.values()) {
    try {
      const member = guild.members.cache.get(discordId) || await guild.members.fetch(discordId).catch(() => null);
      if (!member) continue;

      const targetChannel = await resolveChannelChain(
        client,
        [
          { key: 'general_channel_id', env: 'GENERAL_CHANNEL_ID' },
          { key: 'feed_channel_id', env: 'FEED_CHANNEL_ID' },
          { key: 'suggest_channel_id', env: 'SUGGEST_CHANNEL_ID' }
        ],
        guild.id
      );

      if (targetChannel) {
        await targetChannel.send(payloadBuilder()).catch(() => {});
      }
    } catch (_) {}
  }
}

// ─── First Blood & Sweep Checker ──────────────────────────────
async function checkFirstBloods(client) {
  if (isFirstBloodRunning) return;
  isFirstBloodRunning = true;

  try {
    const TZ = getTimeZone();
    const activeDate = getActiveCycleDate(new Date(), TZ);
    const { dateStr: activeDateStr } = getLocalParts(activeDate, TZ);

    const daily = getDailyProblems(activeDateStr);
    if (!daily) return;

    const { startTimeUtc, endTimeUtc } = getActiveCycleWindow(activeDate, TZ);
    const users = getAllUsers().filter(u => u.cf_handle);
    if (users.length === 0) return;

    const problemsToCheck = [
      { id: daily.p1_id, bloodField: 'first_blood_1', currentBlood: daily.first_blood_1, label: '🌱 Level 1' },
      { id: daily.p2_id, bloodField: 'first_blood_2', currentBlood: daily.first_blood_2, label: '⚔️ Level 2' },
      { id: daily.p3_id, bloodField: 'first_blood_3', currentBlood: daily.first_blood_3, label: '🔥 Level 3' },
      { id: daily.p4_id, bloodField: 'first_blood_4', currentBlood: daily.first_blood_4, label: '⚡ Level 4' },
      { id: daily.p5_id, bloodField: 'first_blood_5', currentBlood: daily.first_blood_5, label: '👑 Level 5' }
    ];

    const problemDetails = {};

    for (const user of users) {
      try {
        const subs = await getCFStatus(user.cf_handle, 100);
        if (!subs) continue;

        const solvedInWindow = new Set();

        for (const sub of subs) {
          if (sub.verdict !== 'OK' || !sub.problem) continue;
          if (sub.creationTimeSeconds < startTimeUtc || sub.creationTimeSeconds >= endTimeUtc) continue;

          const pId = `${sub.problem.contestId}${sub.problem.index}`;
          const isDailyProb = problemsToCheck.some(p => p.id === pId);
          if (!isDailyProb) continue;

          solvedInWindow.add(pId);
          if (!problemDetails[pId]) {
            problemDetails[pId] = {
              name: sub.problem.name,
              url: `https://codeforces.com/problemset/problem/${sub.problem.contestId}/${sub.problem.index}`
            };
          }

          for (const p of problemsToCheck) {
            if (p.id === pId && !p.currentBlood) {
              // Claim atomically in DB before sending messages
              const claimed = tryClaimFirstBlood(activeDateStr, p.bloodField, user.discord_id);
              if (!claimed) {
                p.currentBlood = 'claimed';
                continue;
              }
              p.currentBlood = user.discord_id;

              const timeSec = sub.timeConsumedMillis / 1000;
              const memMb = (sub.memoryConsumedBytes / 1048576).toFixed(2);
              const embed = new EmbedBuilder()
                .setColor(0xFF1744)
                .setAuthor({
                  name: 'FIRST BLOOD CLAIMED! 🩸',
                  iconURL: 'https://cdn-icons-png.flaticon.com/512/3112/3112946.png'
                })
                .setTitle(`⚡ ${p.label} Solved First by @${user.cf_handle}!`)
                .setURL(`https://codeforces.com/problemset/problem/${sub.problem.contestId}/${sub.problem.index}`)
                .setDescription(
                  `🔥 **<@${user.discord_id}>** was the **absolute first person** in the server to conquer the **${p.label}** daily challenge!\n\n` +
                  `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                  `**Problem:** [**${sub.problem.name}**](https://codeforces.com/problemset/problem/${sub.problem.contestId}/${sub.problem.index})\n` +
                  `**Runtime:** \`${timeSec}s\` · **Memory:** \`${memMb} MB\`\n` +
                  `**Verdict:** \`Accepted (AC)\` 🩸\n` +
                  `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
                )
                .setThumbnail('https://cdn-icons-png.flaticon.com/512/3112/3112946.png')
                .setFooter({ text: 'BigOof First Blood Tracker · Speed & Accuracy Honor', iconURL: 'https://codeforces.org/s/0/images/codeforces-telegram-square.png' })
                .setTimestamp();

              await broadcastToUserGuilds(client, user.discord_id, () => ({
                content: `<@${user.discord_id}>`,
                embeds: [embed]
              }));
              console.log(`[FirstBlood] Announced ${user.cf_handle} for ${pId}`);
            }
          }
        }

        const suggestedIds = [daily.p1_id, daily.p2_id, daily.p3_id, daily.p4_id, daily.p5_id].filter(Boolean);
        if (suggestedIds.length > 0 && suggestedIds.every(id => solvedInWindow.has(id))) {
          const claimedSweep = tryMarkSweepAnnounced(activeDateStr, user.discord_id);
          if (claimedSweep) {
            const getProbLink = (id, defaultLabel) => {
              if (problemDetails[id]) return `**[${problemDetails[id].name}](${problemDetails[id].url})**`;
              const match = id.match(/^(\d+)(.+)$/);
              return match
                ? `**[Problem ${match[1]}${match[2]}](https://codeforces.com/problemset/problem/${match[1]}/${match[2]})**`
                : `**[${defaultLabel}](https://codeforces.com/problemset/problem)**`;
            };

            const sweepEmbed = new EmbedBuilder()
              .setColor(0xFFD700)
              .setAuthor({
                name: '🏆 ULTIMATE DAILY SWEEP ACHIEVED! 🏆',
                iconURL: 'https://cdn-icons-png.flaticon.com/512/3112/3112946.png'
              })
              .setTitle(`👑 Grand Slam Solver — @${user.cf_handle}!`)
              .setDescription(
                '> 🌟 **Unstoppable Performance!**\n' +
                `> <@${user.discord_id}> has conquered **all ${suggestedIds.length} daily challenges** for **${activeDateStr}**!\n\n` +
                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'
              )
              .setImage('https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExM3ZhcHhqMmxzbHoxMWh6dmd3NXl1OG1lMnNweWhkZWxobDcwcmJ5ZiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/26n6WvwCRGC16EqyQ/giphy.gif')
              .setFooter({ text: 'BigOof Hall of Fame · Pure Algorithmic Mastery', iconURL: 'https://codeforces.org/s/0/images/codeforces-telegram-square.png' })
              .setTimestamp();

            [
              { id: daily.p1_id, name: '🌱 Level 1 (Novice)' },
              { id: daily.p2_id, name: '⚔️ Level 2 (Pupil)' },
              { id: daily.p3_id, name: '🔥 Level 3 (Specialist)' },
              { id: daily.p4_id, name: '⚡ Level 4 (Expert)' },
              { id: daily.p5_id, name: '👑 Level 5 (Master)' }
            ].forEach(lvl => {
              if (lvl.id) sweepEmbed.addFields({ name: lvl.name, value: `✅ ${getProbLink(lvl.id, 'Problem')}`, inline: false });
            });

            await broadcastToUserGuilds(client, user.discord_id, () => ({
              content: `**<@${user.discord_id}> just swept the daily challenges!** 🔥`,
              embeds: [sweepEmbed]
            }));
            console.log(`[Sweep] Announced ${user.cf_handle} for daily sweep of ${activeDateStr}`);
          }
        }
      } catch (e) {
        console.warn(`[FirstBlood] Error checking ${user.cf_handle}:`, e.message);
      }
      await new Promise(r => setTimeout(r, 2000));
    }
  } catch (err) {
    console.error('[FirstBlood Error]', err.message);
  } finally {
    isFirstBloodRunning = false;
  }
}

function startDailyChallenge(client) {
  const TZ = getTimeZone();

  cron.schedule('0 21 * * *', async () => {
    try {
      console.log(`[Daily] Scheduled 9:00 PM trigger (${TZ}). Posting...`);
      const posted = await postDailySuggestions(client);
      if (posted) {
        setConfig('last_suggest_post_date', getLocalParts(new Date(), TZ).dateStr, 'global');
      }
    } catch (err) {
      console.error('[Daily Scheduler Error]', err);
    }
  }, { timezone: TZ, noOverlap: true });

  setTimeout(async () => {
    try {
      const { hour, dateStr: todayDateStr } = getLocalParts(new Date(), TZ);
      const lastPostDate = getConfig('last_suggest_post_date', 'global');

      if (hour >= 21 && lastPostDate !== todayDateStr) {
        console.log(`[Daily] Startup catch-up: past 9:00 PM (${TZ}). Posting today's quests...`);
        const posted = await postDailySuggestions(client);
        if (posted) {
          setConfig('last_suggest_post_date', todayDateStr, 'global');
        }
      } else {
        // Silently upgrade any active daily message that still carries a static Unicode calendar emoji
        const targets = await getGuildTargetChannels(client, 'suggest_channel_id', 'SUGGEST_CHANNEL_ID');
        const activeDate = getActiveCycleDate(new Date(), TZ);
        const dateCalEmoji = await getCalendarEmoji(client, activeDate, TZ);
        const activeDisplay = activeDate.toLocaleDateString('en-US', {
          weekday: 'long', month: 'long', day: 'numeric', timeZone: TZ
        });
        for (const { channel } of targets) {
          const recent = await channel.messages.fetch({ limit: 15 }).catch(() => null);
          if (!recent) continue;
          for (const m of recent.values()) {
            if (m.author.id !== client.user.id || !m.embeds?.length) continue;
            const e = m.embeds[0];
            if (!e.title?.includes('Daily Coding Quests')) continue;
            if (!/[\u{1F4C5}\u{1F4C6}\u{1F5D3}]/u.test(e.title || '') && e.description?.includes(dateCalEmoji)) continue;
            const json = typeof e.toJSON === 'function' ? e.toJSON() : { ...e };
            json.title = (json.title || '').replace(/^[\u{1F4C5}\u{1F4C6}\u{1F5D3}\u{FE0F}\s]+/u, '🎯 ');
            if (!json.description?.includes('**Date:**')) {
              json.description = `> ${dateCalEmoji} **Date:** **${activeDisplay}**\n${json.description || ''}`;
            } else {
              json.description = json.description.replace(/^> [^\s]+\s+\*\*Date:\*\*/m, `> ${dateCalEmoji} **Date:**`);
            }
            await m.edit({ embeds: [EmbedBuilder.from(json)] }).catch(() => {});
          }
        }
      }
    } catch (err) {
      console.error('[Daily Startup Catch-up Error]', err);
    }
  }, 10000);

  cron.schedule('*/5 * * * *', async () => {
    await checkFirstBloods(client);
  }, { timezone: TZ, noOverlap: true });

  console.log(`[Daily] Daily cron (${TZ}) & 5-min First Blood tracker started.`);
}

module.exports = { startDailyChallenge, postDailySuggestions, checkFirstBloods };
