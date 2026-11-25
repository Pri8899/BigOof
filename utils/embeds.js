// utils/embeds.js — Modernized, limit-safe Discord embed builders for BigOof
const { EmbedBuilder } = require('discord.js');
const { chunkLines } = require('./envHelper');
const { detectLanguage } = require('./github');

const STREAK_ROLES = [
  { name: '☄️ 2+ Year Streak',  min: 730, color: 0xFF0055, badge: '☄️' },
  { name: '🏆 1+ Year Streak',  min: 365, color: 0x00F5D4, badge: '🏆' },
  { name: '🔱 300+ Day Streak', min: 300, color: 0x9B5DE5, badge: '🔱' },
  { name: '💎 200+ Day Streak', min: 200, color: 0x00BBF9, badge: '💎' },
  { name: '💯 100+ Day Streak', min: 100, color: 0xF72585, badge: '💯' },
  { name: '🚀 60+ Day Streak',  min: 60,  color: 0x7C4DFF, badge: '🚀' },
  { name: '💫 30+ Day Streak',  min: 30,  color: 0xE0115F, badge: '💫' },
  { name: '👑 15+ Day Streak',  min: 15,  color: 0xF1C40F, badge: '👑' },
  { name: '🔥 7+ Day Streak',   min: 7,   color: 0xE67E22, badge: '🔥' }
];

const CF_ROLES = [
  { name: 'Legendary Grandmaster',     min: 3000, color: 0xFF0000 },
  { name: 'International Grandmaster', min: 2600, color: 0xFF0000 },
  { name: 'Grandmaster',               min: 2400, color: 0xFF0000 },
  { name: 'International Master',      min: 2300, color: 0xFF8C00 },
  { name: 'Master',                    min: 2100, color: 0xFF8C00 },
  { name: 'Candidate Master',          min: 1900, color: 0xAA00AA },
  { name: 'Expert',                    min: 1600, color: 0x0000FF },
  { name: 'Specialist',                min: 1400, color: 0x03A89E },
  { name: 'Pupil',                     min: 1200, color: 0x008000 },
  { name: 'Newbie',                    min: 0,    color: 0x808080 }
];

const COLORS = {
  Codeforces: 0x1F8DD6,
  AtCoder:    0x00BCD4,
  Toph:       0x7B2FBE,
  Custom:     0xFFD700,
  Success:    0x00E676,
  Error:      0xFF5252,
  Warning:    0xFFAB00,
  FirstBlood: 0xFF1744,
  Duel:       0x7C4DFF,
  default:    0x5865F2
};

const PLATFORM_BADGE = {
  Codeforces: '🏆 Codeforces',
  AtCoder:    '🎯 AtCoder',
  Toph:       '⚡ Toph',
  Custom:     '🌟 Custom Contest'
};

const PLATFORM_ICONS = {
  cf:   'https://codeforces.org/s/0/images/codeforces-telegram-square.png',
  ac:   'https://img.atcoder.jp/assets/logo.png',
  toph: 'https://toph.co/images/appleicon.png'
};

function getCFRankColor(rating) {
  if (!rating || rating === 0) return 0x808080;
  if (rating >= 3000) return 0x880000;
  if (rating >= 2600) return 0xFF0000;
  if (rating >= 2400) return 0xFF3333;
  if (rating >= 2300) return 0xFF8C00;
  if (rating >= 2100) return 0xFFAA00;
  if (rating >= 1900) return 0xAA00AA;
  if (rating >= 1600) return 0x2979FF;
  if (rating >= 1400) return 0x03A89E;
  if (rating >= 1200) return 0x00C853;
  return 0x9E9E9E;
}

function renderProgressBar(val1, val2, totalBlocks = 12) {
  if (!val1 && !val2) return '`[════════════]` (Tied)';
  const total = (val1 || 0) + (val2 || 0);
  if (total === 0) return '`[════════════]` (Tied)';
  const ratio1 = Math.min(totalBlocks, Math.max(0, Math.round(((val1 || 0) / total) * totalBlocks)));
  const ratio2 = totalBlocks - ratio1;
  return `\`[${'█'.repeat(ratio1)}${'░'.repeat(ratio2)}]\``;
}

function getStreakBadge(n, compact = false) {
  if (n === null || n === undefined) return compact ? '' : '`N/A`';
  if (n < 1) return compact ? '' : '`0d`';
  const tier = STREAK_ROLES.find(r => n >= r.min);
  const icon = tier ? tier.badge : '⚡';
  return compact ? `${icon} ${n}d` : `${icon} **${n} Days**`;
}

function resolveTargetMeta(target, fallbackIcon = undefined) {
  const id = target?.id ?? null;
  const displayName = target?.displayName || target?.username || 'Member';
  const avatarUrl = typeof target?.user?.displayAvatarURL === 'function'
    ? target.user.displayAvatarURL({ dynamic: true })
    : (typeof target?.displayAvatarURL === 'function' ? target.displayAvatarURL({ dynamic: true }) : fallbackIcon);
  return { id, displayName, avatarUrl };
}

function successEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(COLORS.Success)
    .setAuthor({ name: 'BigOof · Action Succeeded', iconURL: 'https://cdn-icons-png.flaticon.com/512/190/190411.png' })
    .setTitle(`✅ ${String(title || 'Success')}`.slice(0, 256))
    .setDescription(String(description || '').slice(0, 4096))
    .setFooter({ text: 'BigOof · Competitive Programming Companion' })
    .setTimestamp();
}

function errorEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(COLORS.Error)
    .setAuthor({ name: 'BigOof · Notice', iconURL: 'https://cdn-icons-png.flaticon.com/512/753/753345.png' })
    .setTitle(`❌ ${String(title || 'Error')}`.slice(0, 256))
    .setDescription(String(description || '').slice(0, 4096))
    .setFooter({ text: 'BigOof · Competitive Programming Companion' })
    .setTimestamp();
}

// ── 1. Contest Notification Embed (24h / 1h alerts) ─────────────

function buildContestEmbed(contest, timeUntilLabel) {
  const startTime = contest.startTime ?? contest.start_time;
  const durSec = contest.durationSec ?? contest.duration_sec;
  const platform = contest.platform;
  const name = contest.name;
  const url = contest.url;

  const durationH = Math.floor((durSec || 0) / 3600);
  const durationM = Math.floor(((durSec || 0) % 3600) / 60);
  let durationStr = '';
  if (durationH > 0) durationStr += `${durationH}h`;
  if (durationM > 0) durationStr += ` ${durationM}m`;
  if (!durationStr.trim()) durationStr = 'TBD';

  const color = COLORS[platform] ?? COLORS.default;

  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: PLATFORM_BADGE[platform] ?? platform, url })
    .setTitle(`🏆 ${name}`.slice(0, 256))
    .setURL(url)
    .setDescription([
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      `> ⏳ **Countdown:** ${startTime ? `<t:${startTime}:R>` : 'Starting Soon!'}`,
      `> 📅 **Starts At:** ${startTime ? `<t:${startTime}:F>` : 'TBD'}`,
      `> ⏱️ **Duration:** \`${durationStr.trim()}\``,
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      `🔗 [**Click here to open contest & register →**](${url})`
    ].join('\n'))
    .setFooter({ text: `BigOof Contest Radar · ${timeUntilLabel}` })
    .setTimestamp();
}

// ── 2. Profile Summary Embed ─────────────────────────────────────

function buildProfileEmbed(target, user, ratings, emojis = { cf: '🔵', ac: '🔴', toph: '🟣' }, streaks = []) {
  const ratingMap = {};
  for (const r of ratings) ratingMap[r.platform] = r;

  const streakMap = {};
  for (const s of streaks) streakMap[s.platform] = s;

  const cf = ratingMap.cf;
  const ac = ratingMap.ac;
  const toph = ratingMap.toph;

  const totalSolved = (cf?.solved || 0) + (ac?.solved || 0) + (toph?.solved || 0);
  const embedColor = getCFRankColor(cf?.rating || 0);

  const { displayName, avatarUrl } = resolveTargetMeta(target);

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setAuthor({
      name: `${displayName}'s Competitive Programming Portfolio`,
      iconURL: avatarUrl
    })
    .setTitle('📊 Performance Summary')
    .setThumbnail(avatarUrl)
    .setDescription([
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      `🧩 **Total Problems Solved:** **\`${totalSolved.toLocaleString()}\`** across all platforms`,
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
    ].join('\n'));

  if (user?.cf_handle) {
    const st = streakMap.cf?.current_streak || 0;
    const cfUrl = `https://codeforces.com/profile/${encodeURIComponent(user.cf_handle)}`;
    embed.addFields({
      name: `${emojis.cf || '🔵'} Codeforces`,
      value: cf
        ? [
            `> 🔗 **Handle:** [\`${user.cf_handle}\`](${cfUrl})`,
            `> 🏆 **Rating:** **${cf.rating}** · *(Max: ${cf.max_rating})*`,
            `> 🎖️ **Rank Tier:** ${cf.rank_title}`,
            `> 🧩 **Solved:** **\`${cf.solved}\`** problems · 🔥 **Streak:** ${getStreakBadge(st)}`
          ].join('\n')
        : `> 🔗 **Handle:** [\`${user.cf_handle}\`](${cfUrl})\n> _Stats syncing..._`,
      inline: false
    });
  } else {
    embed.addFields({
      name: `${emojis.cf || '🔵'} Codeforces`,
      value: '> _Not linked yet_ · Use `/link platform:Codeforces` to connect',
      inline: false
    });
  }

  if (user?.ac_handle) {
    const st = streakMap.ac?.current_streak || 0;
    const acUrl = `https://atcoder.jp/users/${encodeURIComponent(user.ac_handle)}`;
    embed.addFields({
      name: `${emojis.ac || '🔴'} AtCoder`,
      value: ac
        ? [
            `> 🔗 **Handle:** [\`${user.ac_handle}\`](${acUrl})`,
            `> 🎯 **Rating:** **${ac.rating}** · *(Max: ${ac.max_rating})*`,
            `> 🎖️ **Rank:** ${ac.rank_title}`,
            `> 🧩 **Solved:** **\`${ac.solved}\`** problems · 🔥 **Streak:** ${getStreakBadge(st)}`
          ].join('\n')
        : `> 🔗 **Handle:** [\`${user.ac_handle}\`](${acUrl})\n> _Stats syncing..._`,
      inline: true
    });
  }

  if (user?.toph_handle) {
    const st = streakMap.toph?.current_streak || 0;
    const tophUrl = `https://toph.co/u/${encodeURIComponent(user.toph_handle)}`;
    embed.addFields({
      name: `${emojis.toph || '🟣'} Toph`,
      value: toph
        ? [
            `> 🔗 **Handle:** [\`${user.toph_handle}\`](${tophUrl})`,
            `> ⚡ **Rating:** **${toph.rating}**`,
            `> 🎖️ **Rank:** ${toph.rank_title}`,
            `> 🧩 **Solved:** **\`${toph.solved}\`** problems · 🔥 **Streak:** ${getStreakBadge(st)}`
          ].join('\n')
        : `> 🔗 **Handle:** [\`${user.toph_handle}\`](${tophUrl})\n> _Stats syncing..._`,
      inline: true
    });
  }

  if (user?.github_handle) {
    const ghUrl = `https://github.com/${encodeURIComponent(user.github_handle)}`;
    embed.addFields({
      name: '🐙 GitHub',
      value: [
        `> 🔗 **Account:** [\`${user.github_handle}\`](${ghUrl})`,
        '> Public commits, PRs, releases, and repositories tracked in real time.'
      ].join('\n'),
      inline: false
    });
  }

  embed.setFooter({ text: 'BigOof · Live rating & submission sync' });
  embed.setTimestamp();
  return embed;
}

// ── 3. Leaderboard & Pinned Dashboard ────────────────────────────

function buildDashboardEmbed(rows, streaks = [], emojis = { cf: '🔵', ac: '🔴', toph: '🟣' }) {
  const medals = ['🥇', '🥈', '🥉'];

  const streakMap = {};
  for (const s of streaks) {
    if (!streakMap[s.discord_id]) streakMap[s.discord_id] = {};
    streakMap[s.discord_id][s.platform] = s.current_streak;
  }

  function cfRankLabel(rating) {
    if (!rating || rating === 0) return 'Unrated';
    if (rating >= 3000) return 'LGM';
    if (rating >= 2600) return 'IGM';
    if (rating >= 2400) return 'GM';
    if (rating >= 2300) return 'IM';
    if (rating >= 2100) return 'Master';
    if (rating >= 1900) return 'CM';
    if (rating >= 1600) return 'Expert';
    if (rating >= 1400) return 'Specialist';
    if (rating >= 1200) return 'Pupil';
    return 'Newbie';
  }

  const embed = new EmbedBuilder()
    .setColor(0xFFD700)
    .setAuthor({
      name: 'Server Leaderboard · Top Competitive Coders',
      iconURL: 'https://cdn-icons-png.flaticon.com/512/3112/3112946.png'
    })
    .setTitle('🏆 Server Leaderboard · Community Standings')
    .setDescription([
      'Ranked by **Codeforces rating**, solved problems, and active daily streaks.',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
    ].join('\n'));

  if (rows.length === 0) {
    embed.addFields({
      name: 'No Active Members',
      value: '_No members have linked their accounts yet._\nUse `/link platform:Codeforces handle:your_handle` to appear on the leaderboard!'
    });
  } else {
    const listLines = rows.slice(0, 15).map((row, i) => {
      const medal = medals[i] ?? `\`#${(i + 1).toString().padStart(2, '0')}\``;

      if (row.cf_linked) {
        const name = (row.cf_handle || row.username || 'Coder').replace(/([_*~|`\\])/g, '\\$1');
        const rank = cfRankLabel(row.cf_rating || 0);
        const rating = row.cf_rating > 0 ? `⭐ **${row.cf_rating}** (${rank})` : '⭐ *Unrated*';
        const solves = `\`${(row.cf_solved || 0).toLocaleString()} solved\``;
        const cfStreak = streakMap[row.discord_id]?.cf ?? row.cf_streak ?? 0;
        const streak = getStreakBadge(cfStreak, true);
        return `${medal} **${name}** · ${rating} · ${solves}${streak ? ` · ${streak}` : ''}`;
      }

      if (row.ac_linked && (row.ac_rating >= row.toph_rating || !row.toph_linked)) {
        const name = (row.ac_handle || row.username || 'Coder').replace(/([_*~|`\\])/g, '\\$1');
        const rating = row.ac_rating > 0 ? `🎯 **${row.ac_rating}** (${row.ac_rank || 'AtCoder'})` : '🎯 *AtCoder Unrated*';
        const solves = `\`${(row.ac_solved || 0).toLocaleString()} solved\``;
        const st = getStreakBadge(streakMap[row.discord_id]?.ac ?? row.ac_streak ?? 0, true);
        return `${medal} **${name}** · ${rating} · ${solves}${st ? ` · ${st}` : ''}`;
      }

      const name = (row.toph_handle || row.username || 'Coder').replace(/([_*~|`\\])/g, '\\$1');
      const rating = row.toph_rating > 0 ? `⚡ **${row.toph_rating}** (${row.toph_rank || 'Toph'})` : '⚡ *Toph Unrated*';
      const solves = `\`${(row.toph_solved || 0).toLocaleString()} solved\``;
      const st = getStreakBadge(streakMap[row.discord_id]?.toph ?? row.toph_streak ?? 0, true);
      return `${medal} **${name}** · ${rating} · ${solves}${st ? ` · ${st}` : ''}`;
    });

    const fieldChunks = chunkLines(listLines, 1000);
    fieldChunks.forEach((chunk, idx) => {
      embed.addFields({
        name: idx === 0 ? `🏅 Top ${Math.min(rows.length, 15)} Competitors` : '🏅 Leaderboard (cont.)',
        value: chunk
      });
    });
  }

  embed.setFooter({ text: 'BigOof Live Dashboard · Updates on activity & daily 9:00 AM' });
  embed.setTimestamp();
  return embed;
}

// ── 4. Full Contest Schedule Radar ───────────────────────────────

function buildContestListEmbed(contests, platform = 'all', apiStatus = {}, emojis = { cf: '🔵', ac: '🔴', toph: '🟣' }) {
  const PLATFORM_ORDER = ['Codeforces', 'AtCoder', 'Toph', 'Custom'];
  const PLATFORM_HEADER = {
    Codeforces: `${emojis.cf || '🔵'} **Codeforces Rounds**`,
    AtCoder:    `${emojis.ac || '🔴'} **AtCoder Contests**`,
    Toph:       `${emojis.toph || '🟣'} **Toph Events**`,
    Custom:     '🌟 **Community Custom Contests**'
  };

  const filtered = platform === 'all'
    ? contests.filter(c => PLATFORM_ORDER.includes(c.platform))
    : contests.filter(c => c.platform.toLowerCase().startsWith(platform.toLowerCase()));

  const embed = new EmbedBuilder()
    .setColor(0x1F8DD6)
    .setAuthor({
      name: 'Autonomous Contest Radar',
      iconURL: 'https://cdn-icons-png.flaticon.com/512/833/833472.png'
    })
    .setTitle('📅 Upcoming Competitive Programming Contests')
    .setDescription([
      'Live contest schedule with real-time countdowns and 24h / 1h reminder alerts.',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
    ].join('\n'));

  const statusIcons = [
    apiStatus.cf !== false ? '🟢 CF' : '🔴 CF',
    apiStatus.ac !== false ? '🟢 AC' : '🔴 AC',
    apiStatus.toph !== false ? '🟢 Toph' : '🔴 Toph'
  ].join(' · ');

  if (filtered.length === 0) {
    embed.addFields({
      name: 'No Contests Scheduled',
      value: '_No upcoming contests found matching your selected platform filter._'
    });
    embed.setFooter({ text: `BigOof Contest Radar · 0 contests listed · API: ${statusIcons}` });
    embed.setTimestamp();
    return embed;
  }

  const grouped = {};
  for (const p of PLATFORM_ORDER) grouped[p] = [];
  for (const c of filtered) {
    if (grouped[c.platform]) grouped[c.platform].push(c);
  }

  let totalCount = 0;
  for (const p of PLATFORM_ORDER) {
    const list = grouped[p];
    if (list.length > 0) {
      const topList = list.slice(0, 5);
      totalCount += topList.length;

      const lines = topList.map((c, i) => {
        const start = c.startTime ?? c.start_time;
        const durSec = c.durationSec ?? c.duration_sec;
        let durStr = 'TBD';
        if (durSec && durSec > 0) {
          const dh = Math.floor(durSec / 3600);
          const dm = Math.floor((durSec % 3600) / 60);
          durStr = dh > 0 ? (dm > 0 ? `${dh}h ${dm}m` : `${dh}h`) : `${dm}m`;
        }
        const timeStr = start ? `<t:${start}:R> (<t:${start}:d>)` : 'TBD';
        return `\`${i + 1}.\` **[${c.name}](${c.url})**\n> ⏱️ \`${durStr}\` · ⏳ Starts ${timeStr}`;
      });

      const chunks = chunkLines(lines, 1000);
      chunks.forEach((chunk, idx) => {
        embed.addFields({
          name: idx === 0 ? (PLATFORM_HEADER[p] || p) : `${PLATFORM_HEADER[p] || p} (cont.)`,
          value: chunk
        });
      });
    }
  }

  embed.setFooter({ text: `BigOof Contest Radar · ${totalCount} contests listed · API: ${statusIcons}` });
  embed.setTimestamp();
  return embed;
}

// ── 5. Live Submission Celebrations ──────────────────────────────

function isICPCProblem(problem) {
  const contestName = String(problem?.contestName || '');
  if (problem?.isICPC) return true;
  if (/\bicpc\b/i.test(contestName)) return true;
  if (Array.isArray(problem?.tags) && problem.tags.some(t => /\bicpc\b/i.test(String(t)))) return true;
  return false;
}

function buildSubmissionEmbed(user, problem, platform) {
  const isCF = platform === 'cf';
  const isAC = platform === 'ac';
  const platName = isCF ? 'Codeforces' : isAC ? 'AtCoder' : 'Toph';
  const platIcon = PLATFORM_ICONS[platform] || PLATFORM_ICONS.cf;
  const isICPC = isICPCProblem(problem);

  const diffVal = problem.rating || problem.difficulty;
  let diffBadge = '⭐ Standard';
  if (diffVal) {
    const d = Number(diffVal);
    const tier = d >= 2400 ? '🔴 Very Hard' : d >= 1900 ? '🟠 Hard' : d >= 1400 ? '🟡 Medium' : d >= 800 ? '🟢 Easy' : '⚪ Beginner';
    diffBadge = `${tier} (${d})`;
  }

  const tags = (problem.tags && problem.tags.length)
    ? problem.tags.slice(0, 4).map(t => `\`${t}\``).join(' • ')
    : '`General`';

  const rawContestName = problem.contestName || (problem.contestId ? `Round #${problem.contestId}` : 'Practice');
  let contestUrl = problem.contestUrl || null;
  if (!contestUrl && problem.contestId) {
    if (isCF) {
      contestUrl = Number(problem.contestId) >= 100000
        ? `https://codeforces.com/gym/${problem.contestId}`
        : `https://codeforces.com/contest/${problem.contestId}`;
    } else if (isAC) {
      contestUrl = `https://atcoder.jp/contests/${problem.contestId}`;
    }
  }
  const contestLine = contestUrl ? `[${rawContestName}](${contestUrl})` : rawContestName;

  const execParts = [];
  if (problem.timeSec !== undefined && problem.timeSec !== null) execParts.push(`\`${problem.timeSec}s\``);
  if (problem.memoryMb !== undefined && problem.memoryMb !== null) execParts.push(`\`${problem.memoryMb} MB\``);
  const execLine = execParts.length > 0 ? `**Execution:** ${execParts.join(' · ')} · \`Accepted\`\n` : '';

  const authorTitle = isICPC
    ? `🏆 Accepted ICPC Solution! · ${platName}`
    : `Accepted Solution! · ${platName}`;
  const headline = isICPC
    ? `🥇 ${user.username || 'Competitor'} conquered an ICPC problem!`
    : `🎉 ${user.username || 'Competitor'} just conquered a problem!`;
  const intro = isICPC
    ? `**<@${user.discord_id}>** submitted an **Accepted ICPC** solution! 🏆`
    : `**<@${user.discord_id}>** submitted an **Accepted** solution!`;

  return new EmbedBuilder()
    .setColor(isICPC ? COLORS.Custom : COLORS.Success)
    .setAuthor({ name: authorTitle, iconURL: platIcon })
    .setTitle(headline.slice(0, 256))
    .setDescription(
      `${intro}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `**Problem:** [**${problem.index ? `${problem.index}. ` : ''}${problem.name}**](${problem.url})\n` +
      `**Contest:** ${contestLine}\n` +
      `**Difficulty:** ${diffBadge}\n` +
      execLine +
      `**Topic Tags:** ${tags}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    )
    .setThumbnail(platIcon)
    .setFooter({
      text: isICPC
        ? 'BigOof Live Submission Feed · ICPC Glory! 🏆'
        : 'BigOof Live Submission Feed · Keep the streak alive! 🔥'
    })
    .setTimestamp();
}

// ── 6. Weekly Wrap-Up Embed ──────────────────────────────────────

function buildWeeklyWrapupEmbed(allSolved, allRatingGains) {
  const topClimber = allRatingGains[0];
  const topGrinder = allSolved[0];

  const embed = new EmbedBuilder()
    .setColor(0xFFD700)
    .setAuthor({
      name: 'BigOof Weekly Hall of Fame 🏆',
      iconURL: 'https://cdn-icons-png.flaticon.com/512/3112/3112946.png'
    })
    .setTitle('📰 Weekly Community Digest')
    .setDescription([
      "Celebrating our community's hardest grinders and top rating climbers this week!",
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
    ].join('\n'));

  if (topClimber && (topClimber.gain > 0 || topClimber.rating_gained > 0)) {
    const gainVal = topClimber.gain ?? topClimber.rating_gained ?? 0;
    const startVal = topClimber.start ?? topClimber.cf_start ?? 0;
    const endVal = topClimber.end ?? topClimber.cf_end ?? 0;
    const climberPing = topClimber.discord_id ? `<@${topClimber.discord_id}>` : `**${topClimber.username}**`;
    embed.addFields({
      name: '🚀 Rating Climber MVP of the Week',
      value: `👑 ${climberPing} gained **\`+${gainVal} rating\`** this week!\n*(${startVal} ➔ ${endVal})*`,
      inline: false
    });
  }

  if (topGrinder && topGrinder.solved_this_week > 0) {
    const grinderPing = topGrinder.discord_id ? `<@${topGrinder.discord_id}>` : `**${topGrinder.username}**`;
    embed.addFields({
      name: '🔨 Problem Grinder MVP of the Week',
      value: `🌟 ${grinderPing} conquered **\`${topGrinder.solved_this_week}\`** Accepted problems this week!`,
      inline: false
    });
  }

  const topSolvers = allSolved.filter(s => s.solved_this_week > 0).slice(0, 3);
  if (topSolvers.length > 0) {
    const lines = topSolvers.map((s, idx) => {
      const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉';
      const userRef = s.discord_id ? `<@${s.discord_id}>` : `**${s.username || 'Coder'}**`;
      return `${medal} ${userRef} · \`${s.solved_this_week} problems solved\``;
    });
    embed.addFields({ name: '🎯 Top Problem Solvers This Week', value: lines.join('\n'), inline: false });
  } else if (!(topClimber && (topClimber.gain > 0 || topClimber.rating_gained > 0)) && !(topGrinder && topGrinder.solved_this_week > 0)) {
    embed.addFields({
      name: '🌱 Quiet Week',
      value: '_No new rating gains or solved problems recorded this week yet — keep grinding!_',
      inline: false
    });
  }

  embed.setFooter({ text: 'BigOof Weekly Digest · Posted every Sunday at 9:00 PM' });
  embed.setTimestamp();
  return embed;
}

// ── 7. Head-to-Head Comparison Embed ─────────────────────────────

function buildCompareEmbed(opts) {
  const {
    name1, name2,
    avatar1, avatar2,
    cfHandle1, cfHandle2,
    cfData1, cfData2,
    solvedSet1Size, solvedSet2Size,
    commonCount, unique1, unique2,
    h2h, streak1, streak2
  } = opts;

  const r1 = cfData1.rating || 0;
  const r2 = cfData2.rating || 0;
  const maxR1 = cfData1.max_rating || 0;
  const maxR2 = cfData2.max_rating || 0;

  const crown1 = r1 > r2 ? ' 👑' : '';
  const crown2 = r2 > r1 ? ' 👑' : '';
  const solveCrown1 = solvedSet1Size > solvedSet2Size ? ' 👑' : '';
  const solveCrown2 = solvedSet2Size > solvedSet1Size ? ' 👑' : '';

  const ratingBar = renderProgressBar(r1, r2, 12);
  const solvesBar = renderProgressBar(solvedSet1Size, solvedSet2Size, 12);
  const embedColor = r1 >= r2 ? getCFRankColor(r1) : getCFRankColor(r2);

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setAuthor({
      name: 'BigOof · Head-to-Head Competitive Clash ⚔️',
      iconURL: 'https://cdn-icons-png.flaticon.com/512/833/833472.png'
    })
    .setTitle(`⚔️ ${name1} VS ${name2}`.slice(0, 256))
    .setDescription([
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      `**${name1}** (\`${cfHandle1}\`)  **VS**  **${name2}** (\`${cfHandle2}\`)`,
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
    ].join('\n'))
    .setThumbnail(avatar1 || avatar2)
    .addFields(
      {
        name: '🏆 Codeforces Rating & Rank',
        value: [
          `> **${name1}**: **\`${r1}\`** (${cfData1.rank_title})${crown1}`,
          `> **${name2}**: **\`${r2}\`** (${cfData2.rank_title})${crown2}`,
          `> ${ratingBar} *${r1 !== r2 ? `${r1 > r2 ? name1 : name2} leads by ${Math.abs(r1 - r2)}` : 'Dead even!'}*`
        ].join('\n'),
        inline: false
      },
      {
        name: '📈 Peak Rating (All-Time)',
        value: [
          `> **${name1}**: **\`${maxR1}\`**`,
          `> **${name2}**: **\`${maxR2}\`**`
        ].join('\n'),
        inline: true
      },
      {
        name: '🔥 Active Daily Streak',
        value: [
          `> **${name1}**: ${getStreakBadge(streak1)}`,
          `> **${name2}**: ${getStreakBadge(streak2)}`
        ].join('\n'),
        inline: true
      },
      {
        name: '🧩 Total Problems Solved',
        value: [
          `> **${name1}**: **\`${solvedSet1Size}\`** solves${solveCrown1}`,
          `> **${name2}**: **\`${solvedSet2Size}\`** solves${solveCrown2}`,
          `> ${solvesBar}`
        ].join('\n'),
        inline: false
      },
      {
        name: '🤝 Problem Overlap & Uniqueness',
        value: [
          `> 👥 **Both Solved:** **\`${commonCount}\`** common problems`,
          `> 🌟 **Unique to ${name1}:** **\`${unique1}\`** problems`,
          `> 🌟 **Unique to ${name2}:** **\`${unique2}\`** problems`
        ].join('\n'),
        inline: false
      }
    );

  if (h2h && h2h.total > 0) {
    embed.addFields({
      name: '⚔️ Server Duels History (/vs)',
      value: `> **${name1}** \`${h2h.wins1}W - ${h2h.wins2}W\` **${name2}** *(${h2h.total} duel${h2h.total > 1 ? 's' : ''} played)*`,
      inline: false
    });
  }

  embed.setFooter({ text: 'BigOof · May the best algorithm win!' });
  embed.setTimestamp();
  return embed;
}

// ── 8. GitHub Profile & Activity Embeds ──────────────────────────

function buildGitHubProfileEmbed(ghUser) {
  const profileUrl = ghUser.profileUrl || `https://github.com/${encodeURIComponent(ghUser.login)}`;
  const embed = new EmbedBuilder()
    .setColor(0x24292E)
    .setAuthor({
      name: `${ghUser.name || ghUser.login}'s GitHub Profile`,
      iconURL: ghUser.avatarUrl || undefined,
      url: profileUrl
    })
    .setTitle(`🐙 ${ghUser.login}`)
    .setURL(profileUrl)
    .setDescription([
      ghUser.bio ? `> *${ghUser.bio}*\n` : '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      `📦 **Public Repositories:** \`${ghUser.publicRepos ?? 0}\``,
      `👥 **Followers:** \`${ghUser.followers ?? 0}\` · **Following:** \`${ghUser.following ?? 0}\``,
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      `[**View Full GitHub Profile ↗️**](${profileUrl})`
    ].filter(Boolean).join('\n'))
    .setFooter({ text: 'BigOof GitHub Integration' })
    .setTimestamp();

  if (ghUser.avatarUrl) embed.setThumbnail(ghUser.avatarUrl);
  return embed;
}

function buildGitHubActivityEmbed(user, event, commitDetails = null) {
  const repoName = event.repo?.name || 'repository';
  const repoUrl = `https://github.com/${repoName}`;
  const actor = event.actor?.login || user.github_handle || user.username || 'Developer';
  const actorMention = user.discord_id ? `<@${user.discord_id}>` : `**${actor}**`;

  if (event.type === 'PushEvent') {
    const branch = event.payload?.ref?.replace('refs/heads/', '') || 'main';
    const commitUrl = commitDetails?.commitUrl || repoUrl;
    const rawMsg = commitDetails?.message || event.payload?.commits?.[0]?.message || 'Pushed new changes';
    const commitMsg = rawMsg.split('\n')[0].slice(0, 300);
    const shortSha = commitDetails?.shortSha || event.payload?.head?.slice(0, 7) || 'commit';
    const filesCount = commitDetails?.files?.length ?? event.payload?.commits?.length ?? 1;
    const stats = commitDetails?.stats;
    const topFile = commitDetails?.files?.[0]?.filename;
    const lang = topFile ? detectLanguage(topFile) : null;

    const lines = [
      `🚀 ${actorMention} pushed to **\`${repoName}\`**`,
      '',
      `> **${commitMsg}**`,
      `🌿 **Branch:** \`${branch}\` · 📁 **Files:** \`${filesCount}\`${stats ? ` · \`+${stats.additions}/-${stats.deletions}\`` : ''}${lang ? ` · ${lang.emoji} ${lang.name}` : ''}`,
      `[**Inspect Commit [${shortSha}] on GitHub ↗️**](${commitUrl})`
    ];

    return new EmbedBuilder()
      .setColor(0x2EA44F)
      .setAuthor({ name: `${actor} · GitHub Push`, iconURL: event.actor?.avatar_url, url: repoUrl })
      .setTitle(`🔨 Push to ${repoName} [${shortSha}]`.slice(0, 256))
      .setURL(commitUrl)
      .setDescription(lines.join('\n'))
      .setFooter({ text: 'BigOof GitHub Stream' })
      .setTimestamp();
  }

  let title = `📦 Activity in ${repoName}`;
  let summary = `Activity by ${actorMention} in **[${repoName}](${repoUrl})**`;

  if (event.type === 'CreateEvent') {
    const refType = event.payload?.ref_type || 'resource';
    const refName = event.payload?.ref ? `\`${event.payload.ref}\`` : '';
    title = `✨ Created ${refType} in ${repoName}`;
    summary = `${actorMention} created ${refType} ${refName} in **[${repoName}](${repoUrl})**`;
  } else if (event.type === 'PullRequestEvent') {
    const action = event.payload?.action || 'updated';
    const pr = event.payload?.pull_request;
    title = `🔀 Pull Request ${action}: #${pr?.number || ''}`;
    summary = `${actorMention} **${action}** PR **[${pr?.title || repoName}](${pr?.html_url || repoUrl})**`;
  } else if (event.type === 'IssuesEvent') {
    const action = event.payload?.action || 'updated';
    const issue = event.payload?.issue;
    title = `🐛 Issue ${action}: #${issue?.number || ''}`;
    summary = `${actorMention} **${action}** issue **[${issue?.title || repoName}](${issue?.html_url || repoUrl})**`;
  } else if (event.type === 'ReleaseEvent') {
    const rel = event.payload?.release;
    title = `🏷️ New Release: ${rel?.tag_name || repoName}`;
    summary = `${actorMention} published release **[${rel?.name || rel?.tag_name || repoName}](${rel?.html_url || repoUrl})**`;
  } else if (event.type === 'ForkEvent') {
    title = `🍴 Forked ${repoName}`;
    summary = `${actorMention} forked **[${repoName}](${repoUrl})**`;
  }

  return new EmbedBuilder()
    .setColor(0x8957E5)
    .setAuthor({ name: `${actor} on GitHub`, iconURL: event.actor?.avatar_url, url: repoUrl })
    .setTitle(title.slice(0, 256))
    .setURL(repoUrl)
    .setDescription(`${summary}\n\n[**Open ${repoName} on GitHub ↗️**](${repoUrl})`)
    .setFooter({ text: 'BigOof GitHub Stream' })
    .setTimestamp();
}

module.exports = {
  buildContestEmbed,
  buildProfileEmbed,
  buildDashboardEmbed,
  buildContestListEmbed,
  successEmbed,
  errorEmbed,
  buildSubmissionEmbed,
  buildWeeklyWrapupEmbed,
  buildGitHubProfileEmbed,
  buildGitHubActivityEmbed,
  buildCompareEmbed,
  getCFRankColor,
  getStreakBadge,
  resolveTargetMeta,
  renderProgressBar,
  isICPCProblem,
  STREAK_ROLES,
  CF_ROLES,
  COLORS,
  PLATFORM_ICONS
};
