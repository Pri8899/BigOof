// commands/suggest.js — On-demand Codeforces problem recommender
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getUser, getRatings } = require('../database/db');
const { getCFProblems, getCFStatus } = require('../utils/codeforces');
const { getPlatformEmojis } = require('../utils/emojis');

const CF_TAGS = [
  'implementation', 'math', 'greedy', 'dp', 'data structures',
  'graphs', 'strings', 'binary search', 'constructive algorithms',
  'number theory'
];

const DIV_CHOICES = [
  { name: 'Div. 1', value: 'div1' },
  { name: 'Div. 2', value: 'div2' },
  { name: 'Div. 3', value: 'div3' },
  { name: 'Div. 4', value: 'div4' }
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('suggest')
    .setDescription('Get personalized Codeforces problem suggestions')
    .addStringOption(opt =>
      opt.setName('tag')
        .setDescription('Filter by topic tag')
        .setRequired(false)
        .addChoices(...CF_TAGS.map(t => ({ name: t, value: t })))
    )
    .addIntegerOption(opt =>
      opt.setName('rating')
        .setDescription('Filter by Codeforces rating (800 - 3500)')
        .setRequired(false)
        .setMinValue(800)
        .setMaxValue(3500)
        .setAutocomplete(true)
    )
    .addStringOption(opt =>
      opt.setName('div')
        .setDescription('Filter by Codeforces division')
        .setRequired(false)
        .addChoices(...DIV_CHOICES)
    )
    .addIntegerOption(opt =>
      opt.setName('problems')
        .setDescription('Number of problems to suggest (default: 5, min: 1, max: 10)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(10)
    ),

  async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused();
    let cfRating = 1200;
    try {
      cfRating = getRatings(interaction.user.id).find(r => r.platform === 'cf')?.rating ?? 1200;
    } catch (_) {}

    const allRatings = [];
    for (let r = 800; r <= 3500; r += 100) allRatings.push(r);

    let choices = [];
    if (focusedValue) {
      choices = allRatings
        .map(r => r.toString())
        .filter(c => c.startsWith(focusedValue))
        .slice(0, 25)
        .map(c => ({ name: c, value: parseInt(c, 10) }));
    } else {
      const targetRating = Math.max(800, Math.min(3500, Math.round(cfRating / 100) * 100));
      const targetIndex = allRatings.indexOf(targetRating);
      let startIndex = Math.max(0, targetIndex - 12);
      const endIndex = Math.min(allRatings.length - 1, startIndex + 24);
      startIndex = Math.max(0, endIndex - 24);
      choices = allRatings.slice(startIndex, endIndex + 1).map(r => ({ name: r.toString(), value: r }));
    }

    await interaction.respond(choices).catch(() => {});
  },

  async execute(interaction) {
    await interaction.deferReply();

    const tag = interaction.options.getString('tag');
    const ratingOption = interaction.options.getInteger('rating');
    const division = interaction.options.getString('div');
    const problemCount = interaction.options.getInteger('problems') ?? 5;
    const userId = interaction.user.id;

    const user = getUser(userId);
    const cfRating = getRatings(userId).find(r => r.platform === 'cf')?.rating ?? 1200;

    const minR = ratingOption ?? Math.max(800, cfRating - 100);
    const maxR = ratingOption ?? Math.min(3500, cfRating + 100);

    const excludeIds = new Set();
    if (user?.cf_handle) {
      const subs = await getCFStatus(user.cf_handle, 5000);
      if (subs) {
        for (const sub of subs) {
          if (sub.verdict === 'OK' && sub.problem) {
            excludeIds.add(`${sub.problem.contestId}${sub.problem.index}`);
          }
        }
      }
    }

    const problems = await getCFProblems(minR, maxR, tag, problemCount, excludeIds, division);

    if (problems.length === 0) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0xE74C3C)
          .setTitle('❌ No Problems Found')
          .setDescription('No problems found matching your selected tag, rating, and division filters.')]
      });
    }

    const emojis = await getPlatformEmojis(interaction.guild);
    const embed = new EmbedBuilder()
      .setColor(0x7C4DFF)
      .setAuthor({
        name: 'Codeforces Practice Recommender',
        iconURL: 'https://codeforces.org/s/0/images/codeforces-telegram-square.png'
      })
      .setDescription([
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        `> ${emojis.cf} **Rating Window:** **\`${minR}\` ➔ \`${maxR}\`**`,
        tag ? `> 🏷️ **Tag Filter:** \`${tag}\`` : null,
        division ? `> 🏆 **Division:** **${division.toUpperCase().replace('DIV', 'Div. ')}**` : null,
        `> 👤 **Tailored For:** <@${userId}> (${cfRating > 0 ? `Rating **${cfRating}**` : 'Unrated'})`,
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
      ].filter(Boolean).join('\n'));

    problems.forEach((p, i) => {
      const tagStr = p.tags?.length > 0 ? p.tags.slice(0, 4).map(t => `\`${t}\``).join(' • ') : '`General`';
      embed.addFields({
        name: `\`#${i + 1}\` ${p.name} · ⭐ **${p.rating}**`,
        value: `> 🔗 [**Solve Challenge on Codeforces ↗️**](${p.url})\n> 🏷️ ${tagStr}`,
        inline: false
      });
    });

    embed
      .setFooter({ text: 'BigOof Recommender · Solve to advance your skill tier', iconURL: 'https://cdn-icons-png.flaticon.com/512/3112/3112946.png' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }
};
