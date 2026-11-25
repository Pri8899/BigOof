// commands/vs.js — Create a 1v1 or multiplayer Codeforces Battle Grid or Classic Race
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getUser, createVSMatch, joinVSMatch, getVSParticipants, db, getRatings } = require('../database/db');
const { CF_TAGS, DIV_CHOICES, respondRatingAutocomplete } = require('../utils/codeforces');
const { buildLobbyEmbed } = require('../utils/vsHandlers');

module.exports = {
  guildOnly: true,
  data: new SlashCommandBuilder()
    .setName('vs')
    .setDescription('Start a 1v1 or multiplayer versus CP match on Codeforces')
    .addIntegerOption(opt =>
      opt.setName('rating')
        .setDescription('Codeforces rating of the problems (e.g. 1200)')
        .setRequired(true)
        .setMinValue(800)
        .setMaxValue(3500)
        .setAutocomplete(true)
    )
    .addStringOption(opt =>
      opt.setName('mode')
        .setDescription('Battle format: 3x3 Battle Grid or Classic Race')
        .setRequired(false)
        .addChoices(
          { name: '⚔️ 3x3 Battle Grid (Default - 1st AC: 100%, later: 1/3)', value: 'grid' },
          { name: '🏁 Classic Race (time decay scoring)', value: 'classic' }
        )
    )
    .addStringOption(opt =>
      opt.setName('tag')
        .setDescription('Optional Codeforces topic tag')
        .setRequired(false)
        .addChoices(...CF_TAGS.map(t => ({ name: t, value: t })))
    )
    .addIntegerOption(opt =>
      opt.setName('duration')
        .setDescription('Match duration in minutes (default: 45 for grid, 30 for classic)')
        .setRequired(false)
        .setMinValue(10)
        .setMaxValue(180)
    )
    .addIntegerOption(opt =>
      opt.setName('problems')
        .setDescription('Number of problems for Classic Race (default: 5; Grid is always 3x3 = 9)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(10)
    )
    .addStringOption(opt =>
      opt.setName('division')
        .setDescription('Optional Codeforces division filter')
        .setRequired(false)
        .addChoices(...DIV_CHOICES)
    ),

  async autocomplete(interaction) {
    return respondRatingAutocomplete(interaction, getRatings);
  },

  async execute(interaction) {
    const rating = interaction.options.getInteger('rating');
    const mode = interaction.options.getString('mode') || 'grid';
    const tag = interaction.options.getString('tag')?.toLowerCase().trim() || null;
    const defaultDuration = mode === 'grid' ? 45 : 30;
    const duration = interaction.options.getInteger('duration') ?? defaultDuration;
    const problems = mode === 'grid' ? 9 : (interaction.options.getInteger('problems') ?? 5);
    const division = interaction.options.getString('division') || null;
    const creatorId = interaction.user.id;

    const user = getUser(creatorId);
    if (!user || !user.cf_handle) {
      return interaction.reply({
        content: '⚠️ You must link your Codeforces account using `/link` before hosting a versus match!',
        flags: 64
      });
    }

    const existingMatch = db.prepare(`
      SELECT m.id, m.status FROM vs_matches m
      JOIN vs_participants p ON m.id = p.match_id
      WHERE p.discord_id = ? AND m.status IN ('lobby', 'active')
    `).get(creatorId);

    if (existingMatch) {
      return interaction.reply({
        content: `⚠️ You are already in an open ${existingMatch.status} match (\`${existingMatch.id}\`). Finish or cancel it first.`,
        flags: 64
      });
    }

    const matchId = `vs-${Math.random().toString(36).substring(2, 8)}`;
    createVSMatch(matchId, interaction.channelId, interaction.guildId, creatorId, rating, tag, division, duration, problems, mode);
    joinVSMatch(matchId, creatorId, user.cf_handle);

    const participants = getVSParticipants(matchId);
    const embed = buildLobbyEmbed({
      id: matchId,
      creator_id: creatorId,
      rating,
      tag,
      division,
      duration_min: duration,
      problems_count: problems,
      mode
    }, participants);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`vs-join_${matchId}`).setLabel('⚔️ Join Match').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`vs-start_${matchId}`).setLabel('🚀 Start Match').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`vs-cancel_${matchId}`).setLabel('❌ Cancel Lobby').setStyle(ButtonStyle.Danger)
    );

    return interaction.reply({ embeds: [embed], components: [row] });
  }
};
