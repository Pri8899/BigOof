// commands/link.js — Link CP platform accounts (CF + AtCoder + Toph)
const { SlashCommandBuilder } = require('discord.js');
const { getUser, upsertUser, linkPlatform, upsertRating } = require('../database/db');
const { validateCFHandle, getCFUser } = require('../utils/codeforces');
const { validateACHandle, getACUser } = require('../utils/atcoder');
const { validateTophHandle, getTophUser } = require('../utils/toph');
const { successEmbed, errorEmbed }    = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link your competitive programming account')
    .addStringOption(opt =>
      opt.setName('platform')
        .setDescription('Platform to link')
        .setRequired(true)
        .addChoices(
          { name: '🏆 Codeforces', value: 'cf' },
          { name: '🎯 AtCoder',    value: 'ac' },
          { name: '⚡ Toph',       value: 'toph' },
          { name: '🐙 GitHub',     value: 'github' }
        ))
    .addStringOption(opt =>
      opt.setName('handle')
        .setDescription('Your username/handle on the platform')
        .setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });

    const platform = interaction.options.getString('platform');
    const handle   = interaction.options.getString('handle').trim();
    const userId   = interaction.user.id;
    const username = interaction.user.username;

    upsertUser(userId, username);

    const platformNames = { cf: 'Codeforces', ac: 'AtCoder', toph: 'Toph', github: 'GitHub' };
    const { getPlatformEmojis } = require('../utils/emojis');
    const emojis = await getPlatformEmojis(interaction.guild);
    const platformEmoji = emojis[platform] || (platform === 'cf' ? '🏆' : platform === 'ac' ? '🎯' : platform === 'toph' ? '⚡' : '🐙');

    let valid = false;
    if (platform === 'cf')     valid = await validateCFHandle(handle);
    if (platform === 'ac')     valid = await validateACHandle(handle);
    if (platform === 'toph')   valid = await validateTophHandle(handle);
    if (platform === 'github') {
      const { validateGitHubUser } = require('../utils/github');
      valid = await validateGitHubUser(handle);
    }

    if (!valid) {
      return interaction.editReply({
        embeds: [errorEmbed(
          'Invalid Handle',
          `${platformEmoji} Could not find **${handle}** on **${platformNames[platform]}**.\nPlease check your username and try again.`
        )]
      });
    }

    linkPlatform(userId, platform, handle);

    interaction.editReply({
      embeds: [successEmbed(
        'Account Linked!',
        `${platformEmoji} Your **${platformNames[platform]}** account \`${handle}\` has been linked! 🎉\n\nFetching your stats now... they'll appear in the dashboard soon.`
      )]
    });

    try {
      if (platform === 'github') {
        const { runGitHubFeed } = require('../tasks/githubFeed');
        runGitHubFeed(interaction.client, userId).catch(() => {});
      } else {
        let stats = null;
        if (platform === 'cf')   stats = await getCFUser(handle);
        if (platform === 'ac')   stats = await getACUser(handle);
        if (platform === 'toph') stats = await getTophUser(handle);
        if (stats) {
          upsertRating(userId, platform, stats);
          const { syncAllRatings, updateDashboard } = require('../tasks/ratingSync');
          await syncAllRatings(interaction.client).catch(() => {});
          await updateDashboard(interaction.client, interaction.guildId).catch(() => {});
        }
      }
    } catch (err) {
      console.error('[link] Stats fetch failed:', err.message);
    }
  }
};
