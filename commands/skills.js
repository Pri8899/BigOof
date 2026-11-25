// commands/skills.js — CP RPG & Skill Tree character sheet built from Codeforces solves
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getUser } = require('../database/db');
const { getCFStatus } = require('../utils/codeforces');
const { getPlatformEmojis } = require('../utils/emojis');

const RPG_CLASSES = {
  attack: {
    name: '🗡️ Attack',
    description: 'Greedy, brute force, and games',
    tags: ['greedy', 'brute force', 'games', 'schedules']
  },
  defense: {
    name: '🛡️ Defense',
    description: 'Implementation, constructive algorithms, and interactive',
    tags: ['implementation', 'constructive algorithms', 'interactive']
  },
  magic: {
    name: '🧙‍♂️ Magic',
    description: 'Math, number theory, combinatorics, probabilities, matrices',
    tags: ['math', 'number theory', 'combinatorics', 'probabilities', 'matrices']
  },
  chrono: {
    name: '🌀 Chrono',
    description: 'Dynamic programming',
    tags: ['dp']
  },
  inventory: {
    name: '📦 Inventory',
    description: 'Data structures, DSU, and bitmasks',
    tags: ['data structures', 'dsu', 'bitmasks']
  },
  exploration: {
    name: '🗺️ Exploration',
    description: 'Graphs, trees, paths, flows, and search algorithms',
    tags: ['graphs', 'trees', 'shortest paths', 'dfs and similar', 'flows', 'graph matchings']
  },
  precision: {
    name: '🏹 Precision',
    description: 'Binary search, sortings, two pointers, geometry, divide and conquer',
    tags: ['binary search', 'sortings', 'two pointers', 'geometry', 'divide and conquer', 'ternary search', 'meet-in-the-middle']
  },
  runes: {
    name: '✍️ Runes',
    description: 'Strings, parsing, and suffix structures',
    tags: ['strings', 'expression parsing', 'string suffix structures', 'hashing']
  }
};

function calculateLevel(totalExp) {
  let lvl = 0;
  let expNeeded = 100;
  let tempExp = totalExp;
  while (tempExp >= expNeeded) {
    tempExp -= expNeeded;
    lvl++;
    expNeeded += 100;
  }
  return { level: lvl, currentExp: tempExp, nextLevelExp: expNeeded };
}

function getCharacterTitle(levels, overallLvl) {
  if (overallLvl === 0) return 'Novice Adventurer';

  let highestKey = null;
  let highestVal = -1;
  for (const [key, val] of Object.entries(levels)) {
    if (val > highestVal) {
      highestVal = val;
      highestKey = key;
    }
  }

  const titles = {
    attack: ['Greedy Raider', 'Blade Master', 'Grand Berserker'],
    defense: ['Fortress Guard', 'Grand Architect', 'Iron Bastion'],
    magic: ['Math Acolyte', 'Archmage of Numbers', 'Grand Oracle'],
    chrono: ['Time Bender', 'Chrono Sage', 'Lord of Recursion'],
    inventory: ['Vault Keeper', 'Data Structurer', 'Legendary Archivist'],
    exploration: ['Pathfinder', 'Graph Navigator', 'Explorer of the Abyss'],
    precision: ['Binary Scout', 'Hawkeye Shooter', 'Deadeye Sniper'],
    runes: ['Rune Carver', 'String Weaver', 'Lexical Scribe']
  };

  const list = titles[highestKey] || ['Novice Adventurer'];
  const idx = highestVal >= 10 ? 2 : (highestVal >= 5 ? 1 : 0);
  return list[idx];
}

function drawProgressBar(current, target, size = 8) {
  const percentage = Math.min(1, current / target);
  const filled = Math.round(percentage * size);
  const empty = size - filled;
  return '▰'.repeat(filled) + '▱'.repeat(empty) + ` \`${Math.round(percentage * 100)}%\``;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('skills')
    .setDescription('View competitive programming RPG character sheet and skill levels')
    .addUserOption(opt =>
      opt.setName('member')
        .setDescription('Member to inspect (defaults to yourself)')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const targetUser = interaction.options.getUser('member') ?? interaction.user;
    const dbUser = getUser(targetUser.id);

    if (!dbUser || !dbUser.cf_handle) {
      const isSelf = targetUser.id === interaction.user.id;
      return interaction.editReply({
        content: `⚠️ ${isSelf ? "You haven't" : `${targetUser.username} hasn't`} linked a Codeforces account! Use \`/link\` first.`
      });
    }

    const subs = await getCFStatus(dbUser.cf_handle, 5000);
    if (!subs) {
      return interaction.editReply({
        content: `❌ Failed to retrieve Codeforces data for \`${dbUser.cf_handle}\`. Codeforces API may be temporarily unavailable.`
      });
    }

    const solvedProblems = new Map();
    for (const sub of subs) {
      if (sub.verdict === 'OK' && sub.problem) {
        const key = sub.problem.contestId !== undefined && sub.problem.index !== undefined
          ? `${sub.problem.contestId}-${sub.problem.index}`
          : sub.problem.name;
        if (key && !solvedProblems.has(key)) solvedProblems.set(key, sub.problem);
      }
    }

    const classExps = {
      attack: 0, defense: 0, magic: 0, chrono: 0,
      inventory: 0, exploration: 0, precision: 0, runes: 0
    };

    let totalSolvesCount = 0;
    let totalRatingSum = 0;
    let ratedSolvesCount = 0;

    for (const problem of solvedProblems.values()) {
      totalSolvesCount++;
      const rating = problem.rating;
      const exp = rating ? Math.round(rating / 100) : 8;

      if (rating) {
        totalRatingSum += rating;
        ratedSolvesCount++;
      }

      const tags = problem.tags || [];
      let matched = false;
      for (const [classKey, classInfo] of Object.entries(RPG_CLASSES)) {
        if (tags.some(tag => classInfo.tags.includes(tag.toLowerCase()))) {
          classExps[classKey] += exp;
          matched = true;
        }
      }
      if (!matched) classExps.defense += exp;
    }

    const classLevels = {};
    const lvlMap = {};
    let totalCumulativeExp = 0;

    for (const [classKey, exp] of Object.entries(classExps)) {
      classLevels[classKey] = calculateLevel(exp);
      lvlMap[classKey] = classLevels[classKey].level;
      totalCumulativeExp += exp;
    }

    const overallLevelInfo = calculateLevel(totalCumulativeExp);
    const title = getCharacterTitle(lvlMap, overallLevelInfo.level);
    const averageRating = ratedSolvesCount > 0 ? Math.round(totalRatingSum / ratedSolvesCount) : 0;
    const emojis = await getPlatformEmojis(interaction.guild);
    const encodedHandle = encodeURIComponent(dbUser.cf_handle);

    const embed = new EmbedBuilder()
      .setColor(0x7C4DFF)
      .setAuthor({
        name: 'Competitive Programming RPG Archetype',
        iconURL: targetUser.displayAvatarURL({ dynamic: true })
      })
      .setDescription([
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        `> 🏆 **Class Title:** \`${title}\``,
        `> 👤 **Codeforces:** [\`${dbUser.cf_handle}\`](https://codeforces.com/profile/${encodedHandle})`,
        `> 📊 **Mastery:** **Level ${overallLevelInfo.level}** (\`${overallLevelInfo.currentExp}/${overallLevelInfo.nextLevelExp}\` EXP)`,
        `> 📈 **XP Bar:** ${drawProgressBar(overallLevelInfo.currentExp, overallLevelInfo.nextLevelExp, 12)}`,
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
      ].join('\n'))
      .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
      .addFields(
        {
          name: '⚔️ Combat & Core Disciplines',
          value:
            `🗡️ **Greedy/BF**: Lvl ${classLevels.attack.level}\n${drawProgressBar(classLevels.attack.currentExp, classLevels.attack.nextLevelExp)} (\`${classLevels.attack.currentExp}/${classLevels.attack.nextLevelExp}\`)\n\n` +
            `🛡️ **Implementation**: Lvl ${classLevels.defense.level}\n${drawProgressBar(classLevels.defense.currentExp, classLevels.defense.nextLevelExp)} (\`${classLevels.defense.currentExp}/${classLevels.defense.nextLevelExp}\`)\n\n` +
            `🏹 **Search/Two Ptrs/Geo**: Lvl ${classLevels.precision.level}\n${drawProgressBar(classLevels.precision.currentExp, classLevels.precision.nextLevelExp)} (\`${classLevels.precision.currentExp}/${classLevels.precision.nextLevelExp}\`)\n\n` +
            `✍️ **Strings & Hash**: Lvl ${classLevels.runes.level}\n${drawProgressBar(classLevels.runes.currentExp, classLevels.runes.nextLevelExp)} (\`${classLevels.runes.currentExp}/${classLevels.runes.nextLevelExp}\`)`,
          inline: true
        },
        {
          name: '🔮 Arcane & Advanced Structures',
          value:
            `🧙‍♂️ **Math & Number Theory**: Lvl ${classLevels.magic.level}\n${drawProgressBar(classLevels.magic.currentExp, classLevels.magic.nextLevelExp)} (\`${classLevels.magic.currentExp}/${classLevels.magic.nextLevelExp}\`)\n\n` +
            `🌀 **Dynamic Programming**: Lvl ${classLevels.chrono.level}\n${drawProgressBar(classLevels.chrono.currentExp, classLevels.chrono.nextLevelExp)} (\`${classLevels.chrono.currentExp}/${classLevels.chrono.nextLevelExp}\`)\n\n` +
            `📦 **Structures & Bitmasks**: Lvl ${classLevels.inventory.level}\n${drawProgressBar(classLevels.inventory.currentExp, classLevels.inventory.nextLevelExp)} (\`${classLevels.inventory.currentExp}/${classLevels.inventory.nextLevelExp}\`)\n\n` +
            `🗺️ **Graphs & Trees**: Lvl ${classLevels.exploration.level}\n${drawProgressBar(classLevels.exploration.currentExp, classLevels.exploration.nextLevelExp)} (\`${classLevels.exploration.currentExp}/${classLevels.exploration.nextLevelExp}\`)`,
          inline: true
        },
        {
          name: '📊 Competitive Profile & Metric',
          value: `> ${emojis.cf} **Total Solved**: \`${totalSolvesCount}\` problems\n> ⭐ **Mean Solved Rating**: \`${averageRating || '—'}\``,
          inline: false
        }
      )
      .setFooter({ text: 'BigOof Skill Matrix · Analyzed from Codeforces solves', iconURL: 'https://cdn-icons-png.flaticon.com/512/3112/3112946.png' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }
};
