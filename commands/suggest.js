// commands/suggest.js — On-demand problem recommender
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getUser, getRatings }   = require('../database/db');
const { getCFProblems }         = require('../utils/codeforces');

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
    .setDescription('Get CF problem suggestions')
    .addStringOption(opt =>
      opt.setName('tag')
        .setDescription('Filter by topic tag')
        .setRequired(false)
        .addChoices(...CF_TAGS.map(t => ({ name: t, value: t }))))
    .addIntegerOption(opt =>
      opt.setName('rating')
        .setDescription('Filter by Codeforces rating (800 - 3500)')
        .setRequired(false)
        .setMinValue(800)
        .setMaxValue(3500)
        .setAutocomplete(true))
    .addStringOption(opt =>
      opt.setName('div')
        .setDescription('Filter by Codeforces division')
        .setRequired(false)
        .addChoices(...DIV_CHOICES))
    .addIntegerOption(opt =>
      opt.setName('problems')
        .setDescription('Number of problems to suggest (default: 5, min: 1, max: 10)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(10)),

  async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused();
    const allRatings = [];
    for (let r = 800; r <= 3500; r += 100) {
      allRatings.push(r.toString());
    }

    const filtered = allRatings
      .filter(choice => choice.startsWith(focusedValue))
      .slice(0, 25);

    await interaction.respond(
      filtered.map(choice => ({ name: choice, value: parseInt(choice, 10) }))
    ).catch(() => {});
  },

  async execute(interaction) {
    await interaction.deferReply();

    const tag          = interaction.options.getString('tag');
    const ratingOption = interaction.options.getInteger('rating');
    const division     = interaction.options.getString('div');
    const problemCount = interaction.options.getInteger('problems') ?? 5;
    const userId       = interaction.user.id;

    const user    = getUser(userId);
    const ratings = getRatings(userId);
    const cfRating = ratings.find(r => r.platform === 'cf')?.rating ?? 1200;

    let minR, maxR;
    if (ratingOption) {
      minR = ratingOption;
      maxR = ratingOption;
    } else {
      minR = Math.max(800, cfRating - 100);
      maxR = Math.min(3500, cfRating + 100);
    }

    // Fetch the user's solved problems to exclude them from suggestions
    const excludeIds = new Set();
    if (user && user.cf_handle) {
      try {
        const axios = require('axios');
        const res = await axios.get(`https://codeforces.com/api/user.status?handle=${user.cf_handle}&from=1&count=2000`, { timeout: 8000 });
        if (res.data.status === 'OK') {
          for (const sub of res.data.result) {
            if (sub.verdict === 'OK' && sub.problem) {
              excludeIds.add(`${sub.problem.contestId}${sub.problem.index}`);
            }
          }
        }
      } catch (err) {
        console.warn(`[Suggest] Failed to fetch solves for ${user.cf_handle}:`, err.message);
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

    let filterDescription = '';
    if (ratingOption) {
      filterDescription += `Rating: **${ratingOption}**`;
    } else {
      filterDescription += `Based on your CF rating **${cfRating}** · Target range: **${minR}–${maxR}**`;
    }
    if (tag) filterDescription += ` · Tag: \`${tag}\``;
    if (division) filterDescription += ` · Division: **${division.toUpperCase().replace('DIV', 'Div. ')}**`;

    const { getPlatformEmojis } = require('../utils/emojis');
    const emojis = await getPlatformEmojis(interaction.guild);

    const embed = new EmbedBuilder()
      .setColor(0x9B59B6)
      .setTitle(`${emojis.cf} CP Problem Suggestions`)
      .setDescription(filterDescription + '\n\u200b');

    problems.forEach((p, i) => {
      embed.addFields({
        name:  `${i + 1}. ${p.name}  ·  ⭐ ${p.rating}`,
        value: `🔗 [Solve on Codeforces](${p.url})\n🏷️ ${p.tags.join(', ') || 'N/A'}`,
        inline: false
      });
    });

    embed
      .setFooter({ text: `Link your CF account with /link to get personalised ratings • /suggest` })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }
};
