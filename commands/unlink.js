// commands/unlink.js — Unlink a connected CP or GitHub platform account safely
const { SlashCommandBuilder } = require('discord.js');
const { getUser, unlinkPlatform } = require('../database/db');
const { getPlatformEmojis, PLATFORM_INFO, ALL_PLATFORM_CHOICES } = require('../utils/emojis');
const { successEmbed, errorEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unlink')
    .setDescription('Unlink a competitive programming or GitHub account')
    .addStringOption(opt =>
      opt.setName('platform')
        .setDescription('Platform to unlink')
        .setRequired(true)
        .addChoices(...ALL_PLATFORM_CHOICES)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });

    const platform = interaction.options.getString('platform');
    const userId = interaction.user.id;
    const info = PLATFORM_INFO[platform];
    const guildEmojis = await getPlatformEmojis(interaction.guild);
    const platformEmoji = guildEmojis[platform] || info.fallbackEmoji;

    const user = getUser(userId);
    if (!user || !user[`${platform}_handle`]) {
      return interaction.editReply({
        embeds: [errorEmbed('Not Linked', `${platformEmoji} You don't have a **${info.name}** account linked.`)]
      });
    }

    unlinkPlatform(userId, platform);

    if (interaction.guildId) {
      const { updateDashboard } = require('../tasks/ratingSync');
      updateDashboard(interaction.client, interaction.guildId).catch(() => {});
    }

    return interaction.editReply({
      embeds: [successEmbed('Account Unlinked', `${platformEmoji} Your **${info.name}** account has been removed.`)]
    });
  }
};
