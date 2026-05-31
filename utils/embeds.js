// utils/embeds.js — Discord embed builders
const { EmbedBuilder } = require('discord.js');

// Platform colors
const COLORS = {
  Codeforces: 0x1F8DD6,
  AtCoder:    0x222222,
  Custom:     0xD4AF37,
  default:    0x5865F2
};

// Platform emojis
const PLATFORM_EMOJI = {
  cf: '🔵',
  ac: '🔴',
  custom: '🏆'
};

// Platform labels + badge
const PLATFORM_BADGE = {
  Codeforces: '🔵 Codeforces',
  AtCoder:    '🔴 AtCoder',
  Custom:     '🏆 Custom'
};

/**
 * Build a professional contest notification embed
 * Handles both camelCase (from API) and snake_case (from DB)
 */
function buildContestEmbed(contest, timeUntilLabel) {
  // ── Normalize field names (DB = snake_case, API = camelCase) ──
  const startTime  = contest.startTime   ?? contest.start_time;
  const durSec     = contest.durationSec ?? contest.duration_sec;
  const platform   = contest.platform;
  const name       = contest.name;
  const url        = contest.url;

  // ── Duration string ──
  const durationH  = Math.floor(durSec / 3600);
  const durationM  = Math.floor((durSec % 3600) / 60);
  let durationStr  = '';
  if (durationH > 0) durationStr += `${durationH} hour${durationH > 1 ? 's' : ''}`;
  if (durationM > 0) durationStr += ` ${durationM} min`;
  if (!durationStr)  durationStr = 'N/A';

  // ── Color ──
  const color = COLORS[platform] ?? COLORS.default;

  // ── Starts-in label color hint ──
  const urgency = timeUntilLabel.includes('1 hour') ? '🔴' : '🟡';

  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: PLATFORM_BADGE[platform] ?? platform })
    .setTitle(`🏆  ${name}`)
    .setURL(url)
    .setDescription(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    .addFields(
      {
        name:   '📅  Start Time',
        value:  startTime ? `<t:${startTime}:F>` : 'N/A',
        inline: true
      },
      {
        name:   '⏱️  Duration',
        value:  durationStr,
        inline: true
      },
      {
        name:   '⏳  Countdown',
        value:  startTime
          ? `**<t:${startTime}:R>**\n> 🔴 Live · updates automatically`
          : 'N/A',
        inline: true
      },
      {
        name:   '🔗  Register / Participate',
        value:  `[**Click here to open the contest →**](${url})`,
        inline: false
      }
    )
    .setTimestamp();
}


/**
 * Build user profile embed
 */
function buildProfileEmbed(member, user, ratings) {
  const ratingMap = {};
  for (const r of ratings) ratingMap[r.platform] = r;

  const cf = ratingMap['cf'];
  const lc = ratingMap['lc'];
  const ac = ratingMap['ac'];

  const embed = new EmbedBuilder()
    .setColor(COLORS.default)
    .setTitle(`📊 CP Profile — ${member.displayName}`)
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true }));

  const fields = [];

  if (user?.cf_handle) {
    fields.push({
      name: '🔵 Codeforces',
      value: cf
        ? `Handle: \`${user.cf_handle}\`\nRating: **${cf.rating}** (Max: ${cf.max_rating})\nRank: ${cf.rank_title}\nSolved: ${cf.solved}`
        : `Handle: \`${user.cf_handle}\`\n_Stats loading..._`,
      inline: true
    });
  } else {
    fields.push({ name: '🔵 Codeforces', value: '_Not linked_\nUse `/link codeforces <handle>`', inline: true });
  }


  if (user?.ac_handle) {
    fields.push({
      name: '🔴 AtCoder',
      value: ac
        ? `Handle: \`${user.ac_handle}\`\nRating: **${ac.rating}** (Max: ${ac.max_rating})\nRank: ${ac.rank_title}\nSolved: ${ac.solved}`
        : `Handle: \`${user.ac_handle}\`\n_Stats loading..._`,
      inline: true
    });
  } else {
    fields.push({ name: '🔴 AtCoder', value: '_Not linked_\nUse `/link atcoder <handle>`', inline: true });
  }

  embed.addFields(fields);
  embed.setFooter({ text: 'Stats update every hour' });
  embed.setTimestamp();

  return embed;
}

/**
 * Build the leaderboard / dashboard embed
 * @param {Array} rows  - from computeLeaderboard
 * @param {Array} streaks - from getAllStreaks()
 */
function buildDashboardEmbed(rows, streaks = []) {
  const medals = ['🥇', '🥈', '🥉'];

  // Build streak lookup: discord_id -> max streak across platforms
  const streakMap = {};
  for (const s of streaks) {
    if (!streakMap[s.discord_id] || s.current_streak > streakMap[s.discord_id]) {
      streakMap[s.discord_id] = s.current_streak;
    }
  }

  let description = '';
  if (rows.length === 0) {
    description = '_No members have linked their accounts yet.\nUse `/link` commands to get started!_';
  } else {
    const lines = rows.map((row, i) => {
      const medal   = medals[i] ?? `\`${String(i + 1).padStart(2, ' ')}\``;
      const cfStr   = row.cf_linked
        ? (row.cf_rating > 0 ? `CF: **${row.cf_rating}** (Solved: **${row.cf_solved}**)` : `CF: Unrated (Solved: **${row.cf_solved}**)`)
        : 'CF: —';
      const acStr   = row.ac_linked
        ? (row.ac_rating > 0 ? `AC: **${row.ac_rating}** (Solved: **${row.ac_solved}**)` : `AC: Unrated (Solved: **${row.ac_solved}**)`)
        : 'AC: —';
      const streak  = streakMap[row.discord_id];
      const fire    = streak >= 7 ? ` 🔥${streak}d` : streak >= 1 ? ` ⚡${streak}d` : '';
      return `${medal} **${row.username ?? 'Unknown'}**${fire} — ${cfStr} | ${acStr}`;
    });
    description = lines.join('\n');
  }

  return new EmbedBuilder()
    .setColor(0x2ECC71)
    .setDescription(`#    🏅 CP Server Leaderboard\n\n${description}`)
    .addFields(
      { name: '📊 Platforms',     value: '🔵 Codeforces · 🔴 AtCoder', inline: false },
      { name: '🔢 Total Members', value: `${rows.length} ranked`,                     inline: true },
      { name: '🔥 Streak',        value: '⚡ = active  🔥 = 7+ days',                 inline: true }
    )
    .setFooter({ text: `Last updated` })
    .setTimestamp();
}

/**
 * Build a success embed
 */
function successEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(0x2ECC71)
    .setTitle(`✅ ${title}`)
    .setDescription(description)
    .setTimestamp();
}

/**
 * Build an error embed
 */
function errorEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(0xE74C3C)
    .setTitle(`❌ ${title}`)
    .setDescription(description)
    .setTimestamp();
}

/**
 * Build upcoming contests list embed — grouped by platform
 * Order: Codeforces → AtCoder
 */
function buildContestListEmbed(contests, platform = 'all', apiStatus = {}) {
  const hasCustom = contests.some(c => c.platform === 'Custom');
  const PLATFORM_ORDER = [];
  if (hasCustom || platform.toLowerCase().startsWith('custom')) {
    PLATFORM_ORDER.push('Custom');
  }
  if (platform === 'all' || platform.toLowerCase().startsWith('codeforces')) {
    PLATFORM_ORDER.push('Codeforces');
  }
  if (platform === 'all' || platform.toLowerCase().startsWith('atcoder')) {
    PLATFORM_ORDER.push('AtCoder');
  }
  
  const cfStatus = apiStatus.cf ?? true;
  const acStatus = apiStatus.ac ?? true;

  const PLATFORM_HEADER = {
    Custom:     `🏆 ───────── CUSTOM ─────────`,
    Codeforces: `🔵 ─────── CODEFORCES ───────${cfStatus ? '' : ' ⚠️ OFFLINE (CACHED)'}`,
    AtCoder:    `🔴 ──────── ATCODER ─────────${acStatus ? '' : ' ⚠️ OFFLINE (CACHED)'}`
  };

  const filtered = platform === 'all'
    ? contests.filter(c => ['Custom', 'Codeforces', 'AtCoder'].includes(c.platform))
    : contests.filter(c => c.platform.toLowerCase().startsWith(platform.toLowerCase()));

  const embed = new EmbedBuilder()
    .setColor(COLORS.default);

  const titleText = platform === 'all'
    ? '📅  Upcoming Contests — Full Overview'
    : `📅  Upcoming Contests — ${platform.charAt(0).toUpperCase() + platform.slice(1)}`;
  
  const header = `#    ${titleText}`;

  if (filtered.length === 0) {
    embed.setDescription(`${header}\n\n_No upcoming contests found across any platform._`);
    return embed;
  }

  // Group by platform
  const grouped = {};
  for (const p of PLATFORM_ORDER) grouped[p] = [];
  for (const c of filtered) {
    if (grouped[c.platform]) grouped[c.platform].push(c);
  }

  let displayedCount = 0;
  const sections = [];
  for (const p of PLATFORM_ORDER) {
    const list = grouped[p];
    const header = PLATFORM_HEADER[p] ?? `⚡ ${p.toUpperCase()}`;
    if (list.length === 0) {
      if (p !== 'Custom') {
        sections.push(`${header}\n*No upcoming contests*`);
      }
    } else {
      const sliced = list.slice(0, 10);
      displayedCount += sliced.length;
      const lines = sliced.map((c, i) => {
        const start    = c.startTime ?? c.start_time;
        const durSec   = c.durationSec ?? c.duration_sec;
        
        let dateLabel = 'N/A';
        let countdownLabel = '';
        if (start) {
          if (c.time_na === 1) {
            dateLabel = `<t:${start}:D> (Time: N/A)`;
          } else {
            dateLabel = `<t:${start}:F>`;
          }
          countdownLabel = `  •  <t:${start}:R>`;
        }
        
        let durLabel = 'N/A';
        if (durSec) {
          const dh       = Math.floor(durSec / 3600);
          const dm       = Math.floor((durSec % 3600) / 60);
          durLabel = dm > 0 ? `${dh}h ${dm}m` : `${dh}h`;
        }
        
        return `\`${i + 1}.\` **[${c.name}](${c.url})**\n      📅 ${dateLabel}\n      ⏱️ ${durLabel}${countdownLabel}`;
      });
      sections.push(`${header}\n${lines.join('\n\n')}`);
    }
  }

  const dhakaTime = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Dhaka"}));
  let hr = dhakaTime.getHours();
  if (dhakaTime.getMinutes() > 50) hr += 1;
  hr = hr % 24;
  const ampm = hr >= 12 ? 'pm' : 'am';
  const displayHr = hr % 12 === 0 ? 12 : hr % 12;
  const timeStr = `${displayHr}:00 ${ampm}`;

  embed
    .setDescription(`${header}\n\n` + sections.join('\n\n'))
    .setFooter({ text: `${displayedCount} total upcoming contests  •  Refreshes every hour  •  ${timeStr}` });

  return embed;
}


/**
 * Build submission embed for Live Feed
 */
function buildSubmissionEmbed(user, problem, platform) {
  const isCF = platform === 'cf';
  let titleSuffix = '';
  let embedColor = isCF ? COLORS.Codeforces : COLORS.AtCoder;
  let authorName = `${isCF ? '🔵 Codeforces' : '🔴 AtCoder'} — Live Accepted!`;
  
  if (isCF) {
    if (problem.contestName) {
      let category = null;
      if (/ICPC/i.test(problem.contestName)) {
        category = 'ICPC';
      } else {
        const match = problem.contestName.match(/Div\.\s*\d+(\s*\+\s*Div\.\s*\d+)*/i);
        const match2 = problem.contestName.match(/Div\s*\d+(\s*\+\s*Div\s*\d+)*/i);
        if (match) category = match[0];
        else if (match2) category = match2[0];
        else if (problem.contestName.includes("Educational")) category = "Educational Round";
        else if (problem.contestName.includes("Global Round")) category = "Global Round";
        else if (problem.contestName.includes("Kotlin Heroes")) category = "Kotlin Heroes";
        else if (problem.contestName.includes("VK Cup")) category = "VK Cup";
        else {
          let clean = problem.contestName
            .replace(/\(.*?\)/g, '')
            .replace(/Codeforces/gi, '')
            .replace(/Round\s*\d+/gi, 'Round')
            .trim();
          if (clean.toLowerCase() === 'round') clean = 'CF Round';
          category = clean || null;
        }
      }
      
      if (category) {
        titleSuffix = ` (${category})`;
        if (category === 'ICPC') {
          embedColor = 0xD4AF37; // Gold
          authorName = `🏆 Codeforces (ICPC) — Live Accepted!`;
        }
      }
    }
  } else {
    if (problem.contestId) {
      const lower = problem.contestId.toLowerCase();
      let div = null;
      if (lower.startsWith('abc')) div = 'ABC';
      else if (lower.startsWith('arc')) div = 'ARC';
      else if (lower.startsWith('agc')) div = 'AGC';
      else if (lower.startsWith('ahc')) div = 'AHC';
      
      if (div) titleSuffix = ` (${div})`;
    }
  }

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setAuthor({ name: authorName })
    .setTitle(`🎉 ${user.username}${titleSuffix} just got an Accepted (AC)!`)
    .setDescription(`<@${user.discord_id}> solved **[${problem.name}](${problem.url})**!`)
    .setThumbnail(isCF ? 'https://codeforces.org/s/0/images/codeforces-telegram-square.png' : 'https://img.atcoder.jp/assets/logo.png')
    .setTimestamp();

  if (problem.rating || problem.difficulty) {
    embed.addFields({ name: 'Difficulty', value: String(problem.rating || problem.difficulty), inline: true });
  }
  if (problem.tags && problem.tags.length > 0) {
    embed.addFields({ name: 'Tags', value: problem.tags.join(', '), inline: true });
  }

  return embed;
}

/**
 * Build Weekly Wrap-Up Embed
 */
function buildWeeklyWrapupEmbed(allSolved, allRatingGains) {
  const embed = new EmbedBuilder()
    .setColor(0xD4AF37) // Legendary Gold
    .setDescription(`#   👑 CP SERVER WEEKLY CHAMPIONS 👑\n\nHappy Sunday! Let's celebrate the top performers who dominated the competitive programming charts this week!\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    .setThumbnail('https://cdn-icons-png.flaticon.com/512/3112/3112946.png') // Gold trophy icon
    .setTimestamp();

  // 1. Solves Champion (handles ties)
  let solvedValue = '';
  if (allSolved.length > 0 && allSolved[0].solved_this_week > 0) {
    const maxSolved = allSolved[0].solved_this_week;
    const coChamps = allSolved.filter(u => u.solved_this_week === maxSolved);
    const mentions = coChamps.map(u => `<@${u.discord_id}>`).join(' & ');
    solvedValue = `🏆 **Weekly Solves Champion**\n\n🎉 Huge congratulations to ${mentions} for solving **${maxSolved}** problems this week! Absolute beast mode! 🚀`;
  } else {
    solvedValue = `🏆 **Weekly Solves Champion**\n\n_No one solved any problems this week. Let's get active next week!_`;
  }
  embed.addFields({ name: '\u200b', value: solvedValue, inline: false });

  // 2. Rating Champion (handles ties)
  let ratingValue = '';
  if (allRatingGains.length > 0 && allRatingGains[0].rating_gained > 0) {
    const maxRating = allRatingGains[0].rating_gained;
    const coChamps = allRatingGains.filter(u => u.rating_gained === maxRating);
    const mentions = coChamps.map(u => `<@${u.discord_id}>`).join(' & ');
    ratingValue = `📈 **Weekly Rating Champion**\n\n🎉 Amazing job by ${mentions} for gaining **+${maxRating}** rating points this week! Incredible progress and skill! 📈`;
  } else {
    ratingValue = `📈 **Weekly Rating Champion**\n\n_No rating gains recorded this week._`;
  }
  embed.addFields({ name: '\u200b', value: ratingValue, inline: false });

  embed.setFooter({ text: 'Consistency is the key to mastery! Keep coding!' });
  return embed;
}


module.exports = {
  buildContestEmbed,
  buildProfileEmbed,
  buildDashboardEmbed,
  buildContestListEmbed,
  successEmbed,
  errorEmbed,
  buildSubmissionEmbed,
  buildWeeklyWrapupEmbed
};
