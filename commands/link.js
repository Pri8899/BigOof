// commands/link.js — Link CP or GitHub platform accounts & sync only the caller cleanly
const { SlashCommandBuilder } = require('discord.js');
const { getRatings, upsertUser, linkPlatform, upsertRating } = require('../database/db');
const { validateCFHandle, getCFUser } = require('../utils/codeforces');
const { validateACHandle, getACUser } = require('../utils/atcoder');
const { validateTophHandle, getTophUser } = require('../utils/toph');
const { validateGitHubUser } = require('../utils/github');
const { getPlatformEmojis, PLATFORM_INFO, ALL_PLATFORM_CHOICES } = require('../utils/emojis');
const { successEmbed, errorEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link your competitive programming or GitHub account')
    .addStringOption(opt =>
      opt.setName('platform')
        .setDescription('Platform to link')
        .setRequired(true)
        .addChoices(...ALL_PLATFORM_CHOICES)
    )
    .addStringOption(opt =>
      opt.setName('handle')
        .setDescription('Your username/handle on the platform')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });

    const platform = interaction.options.getString('platform');
    const handle = interaction.options.getString('handle').trim();
    const userId = interaction.user.id;
    const username = interaction.user.username;

    upsertUser(userId, username);

    const info = PLATFORM_INFO[platform];
    const emojis = await getPlatformEmojis(interaction.guild);
    const platformEmoji = emojis[platform] || info.fallbackEmoji;

    let valid = false;
    if (platform === 'cf') valid = await validateCFHandle(handle);
    if (platform === 'ac') valid = await validateACHandle(handle);
    if (platform === 'toph') valid = await validateTophHandle(handle);
    if (platform === 'github') valid = await validateGitHubUser(handle);

    if (!valid) {
      return interaction.editReply({
        embeds: [errorEmbed(
          'Invalid Handle',
          `${platformEmoji} Could not find **${handle}** on **${info.name}**.\nPlease verify your username and try again.`
        )]
      });
    }

    linkPlatform(userId, platform, handle);

    const syncNote = platform === 'github'
      ? "Scanning your recent GitHub activity now... commits, PRs, and releases will post to your GitHub channel shortly."
      : "Fetching your stats now... they'll appear on your profile and leaderboard shortly.";

    await interaction.editReply({
      embeds: [successEmbed(
        'Account Linked!',
        `${platformEmoji} Your **${info.name}** account \`${handle}\` has been linked! 🎉\n\n${syncNote}`
      )]
    });

    try {
      if (platform === 'github') {
        const { runGitHubFeed } = require('../tasks/githubFeed');
        await runGitHubFeed(interaction.client, userId).catch(() => {});
      } else {
        const existing = getRatings(userId).find(r => r.platform === platform);
        let stats = null;
        if (platform === 'cf') stats = await getCFUser(handle);
        if (platform === 'ac') stats = await getACUser(handle);
        if (platform === 'toph') stats = await getTophUser(handle);

        if (stats) {
          if (stats.solved === null || stats.solved === undefined) stats.solved = existing?.solved ?? 0;
          if (stats.rating === 0 && (existing?.rating ?? 0) > 0) stats.rating = existing.rating;
          upsertRating(userId, platform, stats);
        }

        const { syncSingleUser, updateDashboard } = require('../tasks/ratingSync');
        await syncSingleUser(interaction.client, userId).catch(() => {});
        if (interaction.guildId) {
          await updateDashboard(interaction.client, interaction.guildId).catch(() => {});
        }
      }
    } catch (err) {
      console.error('[link] Post-link sync failed:', err.message);
    }
  }
};
