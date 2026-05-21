// utils/embeds.js — Discord embed builders
const { EmbedBuilder } = require('discord.js');

// Platform colors
const COLORS = {
  Codeforces: 0x1F8DD6,
  AtCoder:    0x222222,
  default:    0x5865F2
};

// Platform emojis
const PLATFORM_EMOJI = {
  cf: '🔵',
  ac: '🔴'
};

// Platform labels + badge
const PLATFORM_BADGE = {
  Codeforces: '🔵 Codeforces',
  AtCoder:    '🔴 AtCoder'
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
    .setFooter({ text: '🔔 React with 🔔 below to get a DM reminder 15 min before start!' })
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
    .setTitle('🏅 CP Server Leaderboard')
    .setDescription(description)
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
  const PLATFORM_ORDER = ['Codeforces', 'AtCoder'];
  
  const cfStatus = apiStatus.cf ?? true;
  const acStatus = apiStatus.ac ?? true;

  const PLATFORM_HEADER = {
    Codeforces: `🔵 ─────── CODEFORCES ───────${cfStatus ? '' : ' ⚠️ OFFLINE (CACHED)'}`,
    AtCoder:    `🔴 ──────── ATCODER ─────────${acStatus ? '' : ' ⚠️ OFFLINE (CACHED)'}`
  };

  const filtered = platform === 'all'
    ? contests.filter(c => PLATFORM_ORDER.includes(c.platform))
    : contests.filter(c => c.platform.toLowerCase().startsWith(platform.toLowerCase()));

  const embed = new EmbedBuilder()
    .setColor(COLORS.default)
    .setTitle('📅  Upcoming Contests')
    .setTimestamp();

  if (filtered.length === 0) {
    embed.setDescription('_No upcoming contests found across any platform._');
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
      sections.push(`${header}\n*No upcoming contests*`);
    } else {
      const sliced = list.slice(0, 10);
      displayedCount += sliced.length;
      const lines = sliced.map((c, i) => {
        const start    = c.startTime ?? c.start_time;
        const durSec   = c.durationSec ?? c.duration_sec;
        const dh       = Math.floor(durSec / 3600);
        const dm       = Math.floor((durSec % 3600) / 60);
        const durLabel = dm > 0 ? `${dh}h ${dm}m` : `${dh}h`;
        return `\`${i + 1}.\` **[${c.name}](${c.url})**\n      📅 <t:${start}:F>\n      ⏱️ ${durLabel}  •  <t:${start}:R>`;
      });
      sections.push(`${header}\n${lines.join('\n\n')}`);
    }
  }

  embed
    .setDescription(sections.join('\n\n'))
    .setFooter({ text: `${displayedCount} total upcoming contests  •  Refreshes every hour` });

  return embed;
}


module.exports = {
  buildContestEmbed,
  buildProfileEmbed,
  buildDashboardEmbed,
  buildContestListEmbed,
  successEmbed,
  errorEmbed
};
