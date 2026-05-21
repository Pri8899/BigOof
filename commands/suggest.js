// commands/suggest.js — On-demand problem recommender
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getUser, getRatings }   = require('../database/db');
const { getCFProblems }         = require('../utils/codeforces');

const CF_TAGS = [
  'implementation', 'math', 'greedy', 'dp', 'data structures',
  'graphs', 'strings', 'binary search', 'constructive algorithms',
  'number theory', 'geometry', 'combinatorics', 'brute force'
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('suggest')
    .setDescription('Get personalized CF problem suggestions based on your rating')
    .addStringOption(opt =>
      opt.setName('tag')
        .setDescription('Filter by topic tag')
        .setRequired(false)
        .addChoices(...CF_TAGS.slice(0, 10).map(t => ({ name: t, value: t }))))
    .addStringOption(opt =>
      opt.setName('difficulty')
        .setDescription('Difficulty relative to your rating')
        .setRequired(false)
        .addChoices(
          { name: '🟢 Easy (-200)',    value: 'easy' },
          { name: '🔵 Normal (±0)',    value: 'normal' },
          { name: '🔴 Hard (+200)',    value: 'hard' },
          { name: '💀 Very Hard (+400)', value: 'vhard' }
        )),

  async execute(interaction) {
    await interaction.deferReply();

    const tag        = interaction.options.getString('tag');
    const difficulty = interaction.options.getString('difficulty') ?? 'normal';
    const userId     = interaction.user.id;

    const user    = getUser(userId);
    const ratings = getRatings(userId);
    const cfRating = ratings.find(r => r.platform === 'cf')?.rating ?? 1200;

    // Determine rating window based on difficulty
    const offsets = { easy: -200, normal: 0, hard: 200, vhard: 400 };
    const base    = cfRating + (offsets[difficulty] ?? 0);
    const minR    = Math.max(800,  base - 100);
    const maxR    = Math.min(3500, base + 100);

    const problems = await getCFProblems(minR, maxR, tag, 5);

    if (problems.length === 0) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0xE74C3C)
          .setTitle('❌ No Problems Found')
          .setDescription('No problems found for that filter. Try a different tag or difficulty.')]
      });
    }

    const diffLabel = { easy: '🟢 Easy', normal: '🔵 Normal', hard: '🔴 Hard', vhard: '💀 Very Hard' }[difficulty];

    const embed = new EmbedBuilder()
      .setColor(0x9B59B6)
      .setTitle(`💡 Problem Suggestions — ${diffLabel}`)
      .setDescription(
        `Based on your CF rating **${cfRating}** · Target range: **${minR}–${maxR}**` +
        (tag ? ` · Tag: \`${tag}\`` : '') +
        '\n\u200b'
      );

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
