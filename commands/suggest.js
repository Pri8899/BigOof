// commands/suggest.js — On-demand Codeforces problem recommender
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getUser, getRatings } = require('../database/db');
const {
  CF_TAGS,
  DIV_CHOICES,
  getCFProblems,
  getCFStatus,
  extractSolvedIds,
  respondRatingAutocomplete
} = require('../utils/codeforces');
const { getPlatformEmojis } = require('../utils/emojis');

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
    return respondRatingAutocomplete(interaction, getRatings);
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
      extractSolvedIds(await getCFStatus(user.cf_handle, 5000), excludeIds);
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
