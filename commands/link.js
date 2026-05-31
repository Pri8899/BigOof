// commands/link.js — Link CP platform accounts (CF + AtCoder only)
const { SlashCommandBuilder } = require('discord.js');
const { getUser, upsertUser, linkPlatform, upsertRating } = require('../database/db');
const { validateCFHandle, getCFUser } = require('../utils/codeforces');
const { validateACHandle, getACUser } = require('../utils/atcoder');
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
          { name: '🔵 Codeforces', value: 'cf' },
          { name: '🔴 AtCoder',    value: 'ac' }
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

    const platformNames = { cf: 'Codeforces', ac: 'AtCoder' };
    const { getPlatformEmojis } = require('../utils/emojis');
    const emojis = await getPlatformEmojis(interaction.guild);
    const platformEmoji = platform === 'cf' ? emojis.cf : emojis.ac;

    let valid = false;
    if (platform === 'cf') valid = await validateCFHandle(handle);
    if (platform === 'ac') valid = await validateACHandle(handle);

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
      let stats = null;
      if (platform === 'cf') stats = await getCFUser(handle);
      if (platform === 'ac') stats = await getACUser(handle);
      if (stats) {
        upsertRating(userId, platform, stats);
        const { updateDashboard } = require('../tasks/ratingSync');
        await updateDashboard(interaction.client).catch(err => console.error('[link] Dashboard update failed:', err.message));
      }
    } catch (err) {
      console.error('[link] Stats fetch failed:', err.message);
    }
  }
};
