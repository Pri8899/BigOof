// utils/embeds.js — Modernized, high-impact Discord embed builders for BigOof
const { EmbedBuilder } = require('discord.js');

// ── Design System & Color Palette ───────────────────────────────
const COLORS = {
  Codeforces: 0x1F8DD6, // Royal Blue
  AtCoder:    0x00BCD4, // Cyber Cyan
  Toph:       0x7B2FBE, // Neon Purple
  Custom:     0xFFD700, // Championship Gold
  Success:    0x00E676, // Electric Emerald
  Error:      0xFF5252, // Coral Red
  Warning:    0xFFAB00, // Amber
  FirstBlood: 0xFF1744, // Vivid Crimson
  Duel:       0x7C4DFF, // Deep Violet
  default:    0x5865F2  // Discord Blurple
};

const PLATFORM_EMOJI = {
  cf:     '🔵',
  ac:     '🔴',
  toph:   '🟣',
  custom: '🏆',
  github: '🐙'
};

const PLATFORM_BADGE = {
  Codeforces: '🏆 Codeforces',
  AtCoder:    '🎯 AtCoder',
  Toph:       '⚡ Toph',
  Custom:     '🌟 Custom Contest'
};

// Official Codeforces rank tier colors
function getCFRankColor(rating) {
  if (!rating || rating === 0) return 0x808080;
  if (rating >= 3000) return 0x880000; // Legendary Grandmaster (Dark Red)
  if (rating >= 2600) return 0xFF0000; // International Grandmaster (Red)
  if (rating >= 2400) return 0xFF3333; // Grandmaster (Red)
  if (rating >= 2300) return 0xFF8C00; // International Master (Orange)
  if (rating >= 2100) return 0xFFAA00; // Master (Orange)
  if (rating >= 1900) return 0xAA00AA; // Candidate Master (Violet)
  if (rating >= 1600) return 0x2979FF; // Expert (Blue)
  if (rating >= 1400) return 0x03A89E; // Specialist (Cyan)
  if (rating >= 1200) return 0x00C853; // Pupil (Green)
  return 0x9E9E9E; // Newbie (Gray)
}

// Generate sleek ASCII progress ratio bar
function renderProgressBar(val1, val2, totalBlocks = 12) {
  if (!val1 && !val2) return '`[════════════]` (Tied)';
  const total = (val1 || 0) + (val2 || 0);
  if (total === 0) return '`[════════════]` (Tied)';
  const ratio1 = Math.min(totalBlocks, Math.max(0, Math.round(((val1 || 0) / total) * totalBlocks)));
  const ratio2 = totalBlocks - ratio1;
  return `\`[${'█'.repeat(ratio1)}${'░'.repeat(ratio2)}]\``;
}

// Streak badge helper
function getStreakBadge(n) {
  if (!n || n < 1) return '`0d`';
  if (n >= 30) return `💫 **${n} Days**`;
  if (n >= 15) return `👑 **${n} Days**`;
  if (n >= 7)  return `🔥 **${n} Days**`;
  return `⚡ **${n} Days**`;
}

// ── Generic Status Embeds ────────────────────────────────────────

function successEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(COLORS.Success)
    .setAuthor({ name: 'BigOof · Action Succeeded', iconURL: 'https://cdn-icons-png.flaticon.com/512/190/190411.png' })
    .setTitle(`✅ ${title}`)
    .setDescription(description)
    .setFooter({ text: 'BigOof · Competitive Programming Companion' })
    .setTimestamp();
}

function errorEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(COLORS.Error)
    .setAuthor({ name: 'BigOof · Notice', iconURL: 'https://cdn-icons-png.flaticon.com/512/753/753345.png' })
    .setTitle(`❌ ${title}`)
    .setDescription(description)
    .setFooter({ text: 'BigOof · Competitive Programming Companion' })
    .setTimestamp();
}

// ── 1. Contest Notification Embed ────────────────────────────────

function buildContestEmbed(contest, timeUntilLabel) {
  const startTime = contest.startTime ?? contest.start_time;
  const durSec    = contest.durationSec ?? contest.duration_sec;
  const platform  = contest.platform;
  const name      = contest.name;
  const url       = contest.url;

  const durationH = Math.floor((durSec || 0) / 3600);
  const durationM = Math.floor(((durSec || 0) % 3600) / 60);
  let durationStr = '';
  if (durationH > 0) durationStr += `${durationH}h`;
  if (durationM > 0) durationStr += ` ${durationM}m`;
  if (!durationStr)  durationStr = 'N/A';

  const color = COLORS[platform] ?? COLORS.default;

  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: PLATFORM_BADGE[platform] ?? platform, url: url })
    .setTitle(`🏆 ${name}`)
    .setURL(url)
    .setDescription([
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `> ⏳ **Countdown:** ${startTime ? `<t:${startTime}:R>` : 'Starting Soon!'}`,
      `> 📅 **Starts At:** ${startTime ? `<t:${startTime}:F>` : 'N/A'}`,
      `> ⏱️ **Duration:** \`${durationStr}\``,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `🔗 [**Click here to open contest & register →**](${url})`
    ].join('\n'))
    .setFooter({ text: `BigOof Contest Radar · ${timeUntilLabel}` })
    .setTimestamp();
}

// ── 2. Profile Summary Embed ─────────────────────────────────────

function buildProfileEmbed(member, user, ratings, emojis = { cf: '🔵', ac: '🔴', toph: '🟣' }) {
  const ratingMap = {};
  for (const r of ratings) ratingMap[r.platform] = r;

  const cf   = ratingMap['cf'];
  const ac   = ratingMap['ac'];
  const toph = ratingMap['toph'];

  const totalSolved = (cf?.solved || 0) + (ac?.solved || 0) + (toph?.solved || 0);
  const embedColor = getCFRankColor(cf?.rating || 0);

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setAuthor({
      name: `${member.displayName}'s Competitive Programming Portfolio`,
      iconURL: member.user.displayAvatarURL({ dynamic: true })
    })
    .setTitle(`📊 Performance Summary`)
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
    .setDescription([
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `🧩 **Total Problems Solved:** **\`${totalSolved.toLocaleString()}\`** across all platforms`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    ].join('\n'));

  // Codeforces card
  if (user?.cf_handle) {
    embed.addFields({
      name: `${emojis.cf || '🔵'} Codeforces: [${user.cf_handle}](https://codeforces.com/profile/${user.cf_handle})`,
      value: cf
        ? [
            `> 🏆 **Rating:** **${cf.rating}** · *(Max: ${cf.max_rating})*`,
            `> 🎖️ **Rank Tier:** ${cf.rank_title}`,
            `> 🧩 **Solved:** **\`${cf.solved}\`** problems`
          ].join('\n')
        : `> Handle: \`${user.cf_handle}\`\n> _Stats syncing..._`,
      inline: false
    });
  } else {
    embed.addFields({
      name: `${emojis.cf || '🔵'} Codeforces`,
      value: `> _Not linked yet_ · Use \`/link platform:Codeforces\` to connect`,
      inline: false
    });
  }

  // AtCoder card
  if (user?.ac_handle) {
    embed.addFields({
      name: `${emojis.ac || '🔴'} AtCoder: [${user.ac_handle}](https://atcoder.jp/users/${user.ac_handle})`,
      value: ac
        ? [
            `> 🎯 **Rating:** **${ac.rating}** · *(Max: ${ac.max_rating})*`,
            `> 🎖️ **Rank:** ${ac.rank_title}`,
            `> 🧩 **Solved:** **\`${ac.solved}\`** problems`
          ].join('\n')
        : `> Handle: \`${user.ac_handle}\`\n> _Stats syncing..._`,
      inline: true
    });
  }

  // Toph card
  if (user?.toph_handle) {
    embed.addFields({
      name: `${emojis.toph || '🟣'} Toph: [${user.toph_handle}](https://toph.co/u/${user.toph_handle})`,
      value: toph
        ? [
            `> ⚡ **Rating:** **${toph.rating}**`,
            `> 🎖️ **Rank:** ${toph.rank_title}`,
            `> 🧩 **Solved:** **\`${toph.solved}\`** problems`
          ].join('\n')
        : `> Handle: \`${user.toph_handle}\`\n> _Stats syncing..._`,
      inline: true
    });
  }

  // GitHub integration preview if linked
  if (user?.github_handle) {
    embed.addFields({
      name: `🐙 GitHub: [${user.github_handle}](https://github.com/${user.github_handle})`,
      value: `> Public commits & PRs automatically tracked in real-time.`,
      inline: false
    });
  }

  embed.setFooter({ text: 'BigOof · Automated stats sync every hour' });
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

  function streakBadge(n) {
    if (!n || n < 1) return '';
    if (n >= 30) return `💫 ${n}d`;
    if (n >= 15) return `👑 ${n}d`;
    if (n >= 7)  return `🔥 ${n}d`;
    return `⚡ ${n}d`;
  }

  function cfRankLabel(rating) {
    if (!rating || rating === 0) return 'Unrated';
    if (rating >= 3000) return 'Legendary GM';
    if (rating >= 2600) return 'Intl. GM';
    if (rating >= 2400) return 'Grandmaster';
    if (rating >= 2300) return 'Intl. Master';
    if (rating >= 2100) return 'Master';
    if (rating >= 1900) return 'Cand. Master';
    if (rating >= 1600) return 'Expert';
    if (rating >= 1400) return 'Specialist';
    if (rating >= 1200) return 'Pupil';
    return 'Newbie';
  }

  function rcgDot(rating) {
    if (!rating || rating === 0) return '⚪';
    if (rating >= 3000) return '🔴';
    if (rating >= 2400) return '🟠';
    if (rating >= 2100) return '🟡';
    if (rating >= 1900) return '🟣';
    if (rating >= 1600) return '🔵';
    if (rating >= 1400) return '🟦';
    if (rating >= 1200) return '🟢';
    return '⚪';
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`🏆 Server Competitive Programming Leaderboard`)
    .setDescription([
      `Live community standings ranked by Codeforces ratings, solves, and active daily streaks.`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    ].join('\n'));

  if (rows.length === 0) {
    embed.addFields({
      name: 'No Active Members',
      value: '_No members have linked their accounts yet._\nUse `/link platform:Codeforces handle:your_handle` to get on the board!'
    });
  } else {
    const listLines = rows.slice(0, 15).map((row, i) => {
      const medal = medals[i] ?? `\`#${(i + 1).toString().padStart(2, '0')}\``;
      const dot = rcgDot(row.cf_rating || 0);
      const name = (row.cf_handle || row.username || 'Coder').replace(/([_*~|`\\])/g, '\\$1');
      const rank = cfRankLabel(row.cf_rating || 0);
      const rating = row.cf_rating > 0 ? `**${row.cf_rating}**` : '—';
      const solves = row.cf_solved ? `\`${row.cf_solved} solves\`` : '`0 solves`';

      const cfStreak = streakMap[row.discord_id]?.cf ?? row.cf_streak ?? 0;
      const streak = streakBadge(cfStreak);

      return `${medal} ${dot} **${name}** · ${rating} (${rank}) · ${solves} ${streak}`;
    });

    embed.addFields({
      name: `🏅 Top ${Math.min(rows.length, 15)} Coders`,
      value: listLines.join('\n')
    });
  }

  embed.setFooter({ text: 'BigOof Live Dashboard · Auto-updates daily at 9:00 AM' });
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
    Custom:     `🌟 **Community Custom Contests**`
  };

  const filtered = platform === 'all'
    ? contests.filter(c => ['Custom', 'Codeforces', 'AtCoder', 'Toph'].includes(c.platform))
    : contests.filter(c => c.platform.toLowerCase().startsWith(platform.toLowerCase()));

  const embed = new EmbedBuilder()
    .setColor(0x1F8DD6)
    .setTitle(`📅 Upcoming Competitive Programming Contests`)
    .setDescription([
      `Autonomous contest radar with real-time countdowns and 24h / 1h reminder alerts.`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    ].join('\n'));

  if (filtered.length === 0) {
    embed.addFields({
      name: 'No Contests Scheduled',
      value: '_No upcoming contests found matching your filter._'
    });
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
        const dh = Math.floor((durSec || 0) / 3600);
        const dm = Math.floor(((durSec || 0) % 3600) / 60);
        const durStr = dm > 0 ? `${dh}h ${dm}m` : `${dh}h`;

        const timeStr = start ? `<t:${start}:R> (<t:${start}:d>)` : 'N/A';
        return `\`${i + 1}.\` **[${c.name}](${c.url})**\n> ⏱️ \`${durStr}\` · ⏳ ${timeStr}`;
      });

      embed.addFields({
        name: PLATFORM_HEADER[p] || p,
        value: lines.join('\n')
      });
    }
  }

  const statusIcons = [
    apiStatus.cf !== false ? '🟢 CF' : '🔴 CF',
    apiStatus.ac !== false ? '🟢 AC' : '🔴 AC',
    apiStatus.toph !== false ? '🟢 Toph' : '🔴 Toph'
  ].join(' · ');

  embed.setFooter({ text: `BigOof Contest Radar · ${totalCount} contests listed · API: ${statusIcons}` });
  embed.setTimestamp();

  return embed;
}

// ── 5. Live Submission Celebrations ──────────────────────────────

function buildSubmissionEmbed(user, problem, platform, emojis = { cf: '🔵', ac: '🔴', toph: '🟣' }) {
  const isCF = platform === 'cf';
  const isAC = platform === 'ac';

  const diffVal = problem.rating || problem.difficulty;
  let diffBadge = '⚪ Unrated';
  if (diffVal) {
    const d = Number(diffVal);
    const tier = d >= 2400 ? '🔴 Very Hard' : d >= 1900 ? '🟠 Hard' : d >= 1400 ? '🟡 Medium' : d >= 800 ? '🟢 Easy' : '⚪ Beginner';
    diffBadge = `${tier} (\`${d}\`)`;
  }

  const tags = (problem.tags && problem.tags.length)
    ? problem.tags.slice(0, 4).map(t => `\`#${t}\``).join(' ')
    : '`#ad-hoc`';

  const embed = new EmbedBuilder()
    .setColor(COLORS.Success) // Bright Emerald
    .setAuthor({
      name: `Accepted Solution! — ${isCF ? 'Codeforces' : isAC ? 'AtCoder' : 'Toph'}`,
      iconURL: 'https://cdn-icons-png.flaticon.com/512/190/190411.png'
    })
    .setTitle(`🎉 ${user.username} just conquered a problem!`)
    .setDescription([
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `**Problem:** [**${problem.index ? `${problem.index}. ` : ''}${problem.name}**](${problem.url})`,
      `> 📊 **Difficulty:** ${diffBadge}`,
      `> 🏷️ **Tags:** ${tags}`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    ].join('\n'))
    .setThumbnail(isCF ? 'https://codeforces.org/s/0/images/codeforces-telegram-square.png' : 'https://img.atcoder.jp/assets/logo.png')
    .setFooter({ text: 'BigOof Live Feed · Keep that streak alive! 🔥' })
    .setTimestamp();

  return embed;
}

// ── 6. Weekly Wrap-Up Embed ──────────────────────────────────────

function buildWeeklyWrapupEmbed(allSolved, allRatingGains, emojis = { cf: '🔵', ac: '🔴', toph: '🟣' }) {
  const topClimber = allRatingGains[0];
  const topGrinder = allSolved[0];

  const embed = new EmbedBuilder()
    .setColor(0xFFD700) // Pure Gold
    .setAuthor({
      name: 'BigOof Weekly Hall of Fame 🏆',
      iconURL: 'https://cdn-icons-png.flaticon.com/512/3112/3112946.png'
    })
    .setTitle(`📰 Weekly Community Wrap-Up`)
    .setDescription([
      `Celebrating our community's hardest grinders and top rating climbers this week!`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    ].join('\n'));

  if (topClimber && topClimber.gain > 0) {
    embed.addFields({
      name: `🚀 Rating MVP of the Week`,
      value: `> 👑 **${topClimber.username}** gained **\`+${topClimber.gain} rating\`** this week!\n> *(${topClimber.start} ➔ ${topClimber.end})*`
    });
  }

  if (topGrinder && topGrinder.solved_this_week > 0) {
    embed.addFields({
      name: `🔨 Problem Grinder MVP of the Week`,
      value: `> 🌟 **${topGrinder.username}** conquered **\`${topGrinder.solved_this_week}\`** Accepted problems this week!`
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
    h2h, streak1, streak2, emojis
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
    .setTitle(`⚔️ ${name1} VS ${name2}`)
    .setDescription([
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `**${name1}** (\`${cfHandle1}\`)  **VS**  **${name2}** (\`${cfHandle2}\`)`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
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

// ── 8. GitHub Profile & Event Embeds ─────────────────────────────

function buildGitHubProfileEmbed(ghUser) {
  return new EmbedBuilder()
    .setColor(0x24292E)
    .setAuthor({
      name: `${ghUser.name || ghUser.login}'s GitHub Profile`,
      iconURL: ghUser.avatar_url,
      url: ghUser.html_url
    })
    .setTitle(`🐙 ${ghUser.login}`)
    .setURL(ghUser.html_url)
    .setThumbnail(ghUser.avatar_url)
    .setDescription([
      ghUser.bio ? `> *${ghUser.bio}*\n` : '',
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `📦 **Public Repositories:** \`${ghUser.public_repos}\``,
      `👥 **Followers:** \`${ghUser.followers}\` · **Following:** \`${ghUser.following}\``,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `[**View Full GitHub Profile ↗️**](${ghUser.html_url})`
    ].join('\n'))
    .setFooter({ text: 'BigOof GitHub Integration' })
    .setTimestamp();
}

function buildGitHubCommitEmbed(user, pushEvent, commitDetails) {
  const repoName = pushEvent.repo.name;
  const repoUrl = `https://github.com/${repoName}`;
  const commitMsg = commitDetails.message.split('\n')[0];
  const shortSha = commitDetails.sha.slice(0, 7);

  return new EmbedBuilder()
    .setColor(0x2EA44F) // GitHub Green
    .setAuthor({
      name: `${user.username} pushed code to ${repoName}`,
      iconURL: user.avatarURL,
      url: repoUrl
    })
    .setTitle(`🔨 Commit [${shortSha}]`)
    .setURL(commitDetails.url)
    .setDescription([
      `> **${commitMsg}**`,
      ``,
      `📁 **Changed Files:** \`${commitDetails.filesCount || 1}\``,
      `🌿 **Branch:** \`${pushEvent.payload?.ref?.replace('refs/heads/', '') || 'main'}\``,
      `[**Inspect Commit on GitHub ↗️**](${commitDetails.url})`
    ].join('\n'))
    .setFooter({ text: 'BigOof GitHub Stream' })
    .setTimestamp();
}

function buildGitHubActivityEmbed(user, event) {
  const repoName = event.repo.name;
  const repoUrl = `https://github.com/${repoName}`;
  const actor = event.actor.login;

  return new EmbedBuilder()
    .setColor(0x8957E5) // GitHub Violet
    .setAuthor({ name: `${actor} on GitHub`, iconURL: event.actor.avatar_url, url: repoUrl })
    .setTitle(`📦 Activity in ${repoName}`)
    .setURL(repoUrl)
    .setDescription(`[**View activity in ${repoName} on GitHub ↗️**](${repoUrl})`)
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
  buildGitHubCommitEmbed,
  buildGitHubProfileEmbed,
  buildGitHubActivityEmbed,
  buildCompareEmbed,
  getCFRankColor,
  renderProgressBar,
  COLORS
};
