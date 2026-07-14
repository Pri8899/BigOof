// utils/embeds.js — Discord embed builders
const { EmbedBuilder } = require('discord.js');

// Platform colors
const COLORS = {
  Codeforces: 0x1F8DD6,
  AtCoder:    0x222222,
  Toph:       0x7B2FBE,
  Custom:     0xD4AF37,
  default:    0x5865F2
};

// Platform emojis
const PLATFORM_EMOJI = {
  cf: '🔵',
  ac: '🔴',
  toph: '🟣',
  custom: '🏆'
};

// Platform labels + badge
const PLATFORM_BADGE = {
  Codeforces: '🔵 Codeforces',
  AtCoder:    '🔴 AtCoder',
  Toph:       '🟣 Toph',
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
function buildProfileEmbed(member, user, ratings, emojis = { cf: '🔵', ac: '🔴', toph: '🟣' }) {
  const ratingMap = {};
  for (const r of ratings) ratingMap[r.platform] = r;

  const cf   = ratingMap['cf'];
  const ac   = ratingMap['ac'];
  const toph = ratingMap['toph'];

  const embed = new EmbedBuilder()
    .setColor(COLORS.default)
    .setTitle(`📊 CP Profile — ${member.displayName}`)
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true }));

  const fields = [];

  if (user?.cf_handle) {
    fields.push({
      name: `${emojis.cf || '🔵'} Codeforces`,
      value: cf
        ? `Handle: \`${user.cf_handle}\`\nRating: **${cf.rating}** _(Max: ${cf.max_rating})_\nRank: ${cf.rank_title}\nSolved: **${cf.solved}**`
        : `Handle: \`${user.cf_handle}\`\n_Stats loading..._`,
      inline: true
    });
  } else {
    fields.push({ name: `${emojis.cf || '🔵'} Codeforces`, value: '_Not linked_\nUse `/link` to add', inline: true });
  }

  if (user?.ac_handle) {
    fields.push({
      name: `${emojis.ac || '🔴'} AtCoder`,
      value: ac
        ? `Handle: \`${user.ac_handle}\`\nRating: **${ac.rating}** _(Max: ${ac.max_rating})_\nRank: ${ac.rank_title}\nSolved: **${ac.solved}**`
        : `Handle: \`${user.ac_handle}\`\n_Stats loading..._`,
      inline: true
    });
  } else {
    fields.push({ name: `${emojis.ac || '🔴'} AtCoder`, value: '_Not linked_\nUse `/link` to add', inline: true });
  }

  if (user?.toph_handle) {
    fields.push({
      name: `🟣 Toph`,
      value: toph
        ? `Handle: \`${user.toph_handle}\`\nRating: **${toph.rating}**\nRank: ${toph.rank_title}\nSolved: **${toph.solved}**`
        : `Handle: \`${user.toph_handle}\`\n_Stats loading..._`,
      inline: true
    });
  } else {
    fields.push({ name: `🟣 Toph`, value: '_Not linked_\nUse `/link` to add', inline: true });
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
function buildDashboardEmbed(rows, streaks = [], emojis = { cf: '🔵', ac: '🔴', toph: '🟣' }) {
  const medals = ['🥇', '🥈', '🥉'];

  // Streak lookup per user per platform
  const streakMap = {};
  for (const s of streaks) {
    if (!streakMap[s.discord_id]) streakMap[s.discord_id] = {};
    streakMap[s.discord_id][s.platform] = s.current_streak;
  }

  function streakBadge(n) {
    if (!n || n < 1) return '';
    if (n >= 30) return `💫 ${n}d`;
    if (n >= 15) return `👑 ${n}d`;
    if (n >= 7)  return `🔥 ${n}d`;
    return `⚡ ${n}d`;
  }

  // Rank color labels for CF
  function cfRankLabel(rating) {
    if (!rating || rating === 0) return 'Unrated';
    if (rating >= 3000) return '**Legendary GM**';
    if (rating >= 2600) return '**Intl. GM**';
    if (rating >= 2400) return '**Grandmaster**';
    if (rating >= 2300) return '**Intl. Master**';
    if (rating >= 2100) return '**Master**';
    if (rating >= 1900) return '**Cand. Master**';
    if (rating >= 1600) return '**Expert**';
    if (rating >= 1400) return '**Specialist**';
    if (rating >= 1200) return '**Pupil**';
    return '**Newbie**';
  }

  // AC rank labels
  function acRankLabel(rating) {
    if (!rating || rating === 0) return 'Unrated';
    if (rating >= 2800) return '**Red**';
    if (rating >= 2400) return '**Orange**';
    if (rating >= 2000) return '**Yellow**';
    if (rating >= 1600) return '**Blue**';
    if (rating >= 1200) return '**Cyan**';
    if (rating >= 800)  return '**Green**';
    if (rating >= 400)  return '**Brown**';
    return '**Gray**';
  }

  // Blank line separator for readability
  const SEP = '\u200b';
  // indent spacer
  const IND = '\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0';

  let description = '';

  if (rows.length === 0) {
    description = '_No members have linked their accounts yet.\nUse `/link` to get started!_';
  } else {
    const sections = rows.map((row, i) => {
      const medal = medals[i] ?? `\`#${i + 1}\``;

      // Display name: prefer CF handle (has rank system), else Toph, else AC, else username
      const displayName = (row.cf_handle || row.toph_handle || row.ac_handle || row.username || 'Unknown')
        .replace(/([_*~|`\\])/g, '\\$1');

      const cfStreak   = streakMap[row.discord_id]?.cf   ?? row.cf_streak   ?? 0;
      const acStreak   = streakMap[row.discord_id]?.ac   ?? row.ac_streak   ?? 0;
      const tophStreak = streakMap[row.discord_id]?.toph ?? row.toph_streak ?? 0;

      let lines = [];
      lines.push(`${medal} **${displayName}**`);

      if (row.cf_linked) {
        const streak = streakBadge(cfStreak);
        const rank   = cfRankLabel(row.cf_rating);
        const rating = row.cf_rating > 0 ? `**${row.cf_rating}**` : `—`;
        lines.push(`> ${emojis.cf || '🔵'}${streak ? ` ${streak}` : ''} ─ CF ${rank}`);
        lines.push(`> ${IND}· Rating: ${rating}`);
        lines.push(`> ${IND}· Solved: **${row.cf_solved}**`);
      }

      if (row.ac_linked) {
        const streak = streakBadge(acStreak);
        const rank   = acRankLabel(row.ac_rating);
        const rating = row.ac_rating > 0 ? `**${row.ac_rating}**` : `—`;
        lines.push(`> ${emojis.ac || '🔴'}${streak ? ` ${streak}` : ''} ─ AC ${rank}`);
        lines.push(`> ${IND}· Rating: ${rating}`);
        lines.push(`> ${IND}· Solved: **${row.ac_solved}**`);
      }

      if (row.toph_linked) {
        const streak = streakBadge(tophStreak);
        const rankRaw = row.toph_rank && row.toph_rank !== 'Unrated' ? `**${row.toph_rank}**` : 'Unrated';
        const rating = row.toph_rating > 0 ? `**${row.toph_rating}**` : `—`;
        lines.push(`> 🟣${streak ? ` ${streak}` : ''} ─ Toph ${rankRaw}`);
        lines.push(`> ${IND}· Rating: ${rating}`);
        lines.push(`> ${IND}· Solved: **${row.toph_solved}**`);
      }

      return lines.join('\n');
    });

    description = sections.join('\n\n');
  }

  // Only show platforms that at least one user has linked
  const platformParts = [];
  if (rows.some(r => r.cf_linked))   platformParts.push(`${emojis.cf || '🔵'} Codeforces`);
  if (rows.some(r => r.ac_linked))   platformParts.push(`${emojis.ac || '🔴'} AtCoder`);
  if (rows.some(r => r.toph_linked)) platformParts.push(`🟣 Toph`);

  return new EmbedBuilder()
    .setColor(0x2ECC71)
    .setDescription(
      `# \u3000\u3000\u3000\u3000🏅 CP Server Leaderboard\n` +
      `\u200b\n` +
      description
    )
    .addFields(
      { name: '📊 Platforms',     value: platformParts.join('  ·  ') || 'None linked', inline: false },
      { name: '🔢 Total Members', value: `**${rows.length}** ranked`,                  inline: true  },
      { name: '🔥 Streak Guide',  value: '⚡ 1d+  🔥 7d+  👑 15d+  💫 30d+',           inline: true  }
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
function buildContestListEmbed(contests, platform = 'all', apiStatus = {}, emojis = { cf: '🔵', ac: '🔴', toph: '🟣' }) {
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
  if (platform === 'all' || platform.toLowerCase().startsWith('toph')) {
    PLATFORM_ORDER.push('Toph');
  }
  
  const cfStatus   = apiStatus.cf   ?? true;
  const acStatus   = apiStatus.ac   ?? true;
  const tophStatus = apiStatus.toph ?? true;

  const PLATFORM_HEADER = {
    Custom:     `🏆 ───────── CUSTOM ─────────`,
    Codeforces: `${emojis.cf || '🔵'} ─────── CODEFORCES ───────${cfStatus ? '' : ' ⚠️ OFFLINE (CACHED)'}`,
    AtCoder:    `${emojis.ac || '🔴'} ──────── ATCODER ─────────${acStatus ? '' : ' ⚠️ OFFLINE (CACHED)'}`,
    Toph:       `${emojis.toph || '🟣'} ──────────── TOPH ────────${tophStatus ? '' : ' ⚠️ OFFLINE (CACHED)'}`
  };

  const filtered = platform === 'all'
    ? contests.filter(c => ['Custom', 'Codeforces', 'AtCoder', 'Toph'].includes(c.platform))
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
    .setFooter({ text: `${displayedCount} total upcoming contests  •  Refreshes every 12 hours  •  ${timeStr}` });

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
function buildWeeklyWrapupEmbed(allSolved, allRatingGains, emojis = { cf: '🔵', ac: '🔴' }) {
  const embed = new EmbedBuilder()
    .setColor(0xD4AF37) // Legendary Gold
    .setDescription(`### 👑 CP SERVER WEEKLY CHAMPIONS 👑\n\nHappy Sunday! Let's celebrate the top performers who dominated the competitive programming charts this week!\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    .setThumbnail('https://cdn-icons-png.flaticon.com/512/3112/3112946.png') // Gold trophy icon
    .setTimestamp();

  // 1. Solves Champion (handles ties)
  let solvedValue = '';
  if (allSolved.length > 0 && allSolved[0].solved_this_week > 0) {
    const maxSolved = allSolved[0].solved_this_week;
    const coChamps = allSolved.filter(u => u.solved_this_week === maxSolved);
    const mentions = coChamps.map(u => `<@${u.discord_id}>`).join(' & ');
    
    const lines = coChamps.map(u => {
      return `🎉 Huge congratulations to ${mentions} for an outstanding performance this week!
> ${emojis.cf} **Codeforces**: \`${u.cf_solved}\` solved  ·  ${emojis.ac} **AtCoder**: \`${u.ac_solved}\` solved
> 📊 **Total Solved**: **${maxSolved}** problems solved this week! Absolute beast mode! 🚀`;
    }).join('\n\n');

    solvedValue = `🏆 **Weekly Solves Champion**\n\n${lines}`;
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

    const lines = coChamps.map(u => {
      const cfText = u.cf_linked ? `\`+${u.cf_gain}\` (${u.cf_start} → ${u.cf_end})` : `_Not linked_`;
      const acText = u.ac_linked ? `\`+${u.ac_gain}\` (${u.ac_start} → ${u.ac_end})` : `_Not linked_`;
      return `🎉 Amazing job by ${mentions} for showing incredible skill and progress!
> ${emojis.cf} **Codeforces**: ${cfText}  ·  ${emojis.ac} **AtCoder**: ${acText}
> 📈 **Total Gain**: **+${maxRating}** rating points this week! Incredible progress and skill! 📈`;
    }).join('\n\n');

    ratingValue = `📈 **Weekly Rating Champion**\n\n${lines}`;
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
