const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const {
  getUser, createVSMatch, joinVSMatch, getVSParticipants, db
} = require('../database/db');
const { buildLobbyEmbed } = require('../utils/vsHandlers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('vs')
    .setDescription('Start a 1v1 or multiplayer versus CP match on Codeforces')
    .addIntegerOption(opt =>
      opt.setName('rating')
        .setDescription('Codeforces rating of the problems (e.g. 1200)')
        .setRequired(true)
        .setMinValue(800)
        .setMaxValue(3500)
    )
    .addStringOption(opt =>
      opt.setName('tag')
        .setDescription('Optional Codeforces topic tag (e.g. dp, math, greedy)')
        .setRequired(false)
    )
    .addIntegerOption(opt =>
      opt.setName('duration')
        .setDescription('Match duration in minutes (default: 30, min: 10, max: 180)')
        .setRequired(false)
        .setMinValue(10)
        .setMaxValue(180)
    )
    .addIntegerOption(opt =>
      opt.setName('problems')
        .setDescription('Number of problems to solve (default: 3, min: 1, max: 5)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(5)
    ),

  async execute(interaction) {
    const rating    = interaction.options.getInteger('rating');
    const tag       = interaction.options.getString('tag')?.toLowerCase().trim() || null;
    const duration  = interaction.options.getInteger('duration') ?? 30;
    const problems  = interaction.options.getInteger('problems') ?? 3;
    const creatorId = interaction.user.id;

    // 1. Verify Codeforces linkage
    const user = getUser(creatorId);
    if (!user || !user.cf_handle) {
      return interaction.reply({
        content: '⚠️ You must link your Codeforces account using \`/link\` before hosting a versus match!',
        ephemeral: true
      });
    }

    // 2. Check if already in an active match
    const activeMatch = db.prepare(`
      SELECT m.id FROM vs_matches m
      JOIN vs_participants p ON m.id = p.match_id
      WHERE p.discord_id = ? AND m.status = 'active'
    `).get(creatorId);

    if (activeMatch) {
      return interaction.reply({
        content: '⚠️ You are already in an active versus match! Complete or abort it before starting a new one.',
        ephemeral: true
      });
    }

    // 3. Create a unique Match ID
    const matchId = `vs-${Math.random().toString(36).substring(2, 8)}`;
    const channelId = interaction.channelId;
    const guildId = interaction.guildId;

    // 4. Save match and insert creator as first participant
    createVSMatch(matchId, channelId, guildId, creatorId, rating, tag, duration, problems);
    joinVSMatch(matchId, creatorId, user.cf_handle);

    const participants = getVSParticipants(matchId);

    // 5. Build lobby embed and components
    const embed = buildLobbyEmbed({
      id: matchId,
      creator_id: creatorId,
      rating,
      tag,
      duration_min: duration,
      problems_count: problems
    }, participants);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`vs-join_${matchId}`)
        .setLabel('⚔️ Join Match')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`vs-start_${matchId}`)
        .setLabel('🚀 Start Match')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`vs-cancel_${matchId}`)
        .setLabel('❌ Cancel Lobby')
        .setStyle(ButtonStyle.Danger)
    );

    return interaction.reply({ embeds: [embed], components: [row] });
  }
};
