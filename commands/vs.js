const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const {
  getUser, createVSMatch, joinVSMatch, getVSParticipants, db, getRatings
} = require('../database/db');
const { buildLobbyEmbed } = require('../utils/vsHandlers');

const CF_TAGS = [
  'implementation', 'math', 'greedy', 'dp', 'data structures',
  'graphs', 'strings', 'binary search', 'constructive algorithms',
  'number theory'
];

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
        .setAutocomplete(true)
    )
    .addStringOption(opt =>
      opt.setName('mode')
        .setDescription('Battle format: 3x3 Lockout Grid or Classic Race')
        .setRequired(false)
        .addChoices(
          { name: '⚔️ 3x3 Battle Grid (Default - 1st AC: 100%, later: 1/3)', value: 'grid' },
          { name: '🏁 Classic Race (5 problems with time decay)', value: 'classic' }
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
        .setDescription('Number of problems (default: 9 for grid, 5 for classic)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(10)
    )
    .addStringOption(opt =>
      opt.setName('division')
        .setDescription('Optional Codeforces division filter')
        .setRequired(false)
        .addChoices(
          { name: 'Div. 1', value: 'div1' },
          { name: 'Div. 2', value: 'div2' },
          { name: 'Div. 3', value: 'div3' },
          { name: 'Div. 4', value: 'div4' }
        )
    ),

  async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused();
    const userId = interaction.user.id;
    let cfRating = 1200;
    try {
      const ratings = getRatings(userId);
      cfRating = ratings.find(r => r.platform === 'cf')?.rating ?? 1200;
    } catch (err) {
      console.error('[VS Autocomplete] Database query failed:', err);
    }

    const allRatings = [];
    for (let r = 800; r <= 3500; r += 100) {
      allRatings.push(r);
    }

    let choices = [];
    if (focusedValue) {
      const filtered = allRatings
        .map(r => r.toString())
        .filter(choice => choice.startsWith(focusedValue))
        .slice(0, 25);
      choices = filtered.map(choice => ({ name: choice, value: parseInt(choice, 10) }));
    } else {
      const roundedRating = Math.round(cfRating / 100) * 100;
      const targetRating = Math.max(800, Math.min(3500, roundedRating));
      const targetIndex = allRatings.indexOf(targetRating);

      let startIndex = targetIndex - 12;
      let endIndex = targetIndex + 12;

      if (startIndex < 0) {
        startIndex = 0;
        endIndex = Math.min(allRatings.length - 1, 24);
      }
      if (endIndex >= allRatings.length) {
        endIndex = allRatings.length - 1;
        startIndex = Math.max(0, endIndex - 24);
      }

      const windowRatings = allRatings.slice(startIndex, endIndex + 1);
      choices = windowRatings.map(r => ({ name: r.toString(), value: r }));
    }

    await interaction.respond(choices).catch(() => {});
  },

  async execute(interaction) {
    const rating    = interaction.options.getInteger('rating');
    const mode      = interaction.options.getString('mode') || 'grid';
    const tag       = interaction.options.getString('tag')?.toLowerCase().trim() || null;
    const defaultDuration = mode === 'grid' ? 45 : 30;
    const defaultProblems = mode === 'grid' ? 9 : 5;
    const duration  = interaction.options.getInteger('duration') ?? defaultDuration;
    const problems  = interaction.options.getInteger('problems') ?? defaultProblems;
    const division  = interaction.options.getString('division') || null;
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
    createVSMatch(matchId, channelId, guildId, creatorId, rating, tag, division, duration, problems, mode);
    joinVSMatch(matchId, creatorId, user.cf_handle);

    const participants = getVSParticipants(matchId);

    // 5. Build lobby embed and components
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
