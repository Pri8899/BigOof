// commands/unlink.js — Unlink a connected CP or GitHub platform account safely
const { SlashCommandBuilder } = require('discord.js');
const { getUser, unlinkPlatform } = require('../database/db');
const { getPlatformEmojis } = require('../utils/emojis');
const { successEmbed, errorEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unlink')
    .setDescription('Unlink a competitive programming or GitHub account')
    .addStringOption(opt =>
      opt.setName('platform')
        .setDescription('Platform to unlink')
        .setRequired(true)
        .addChoices(
          { name: '🏆 Codeforces', value: 'cf' },
          { name: '🎯 AtCoder',    value: 'ac' },
          { name: '⚡ Toph',       value: 'toph' },
          { name: '🐙 GitHub',     value: 'github' }
        )
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });

    const platform = interaction.options.getString('platform');
    const userId = interaction.user.id;
    const names = { cf: 'Codeforces', ac: 'AtCoder', toph: 'Toph', github: 'GitHub' };
    const guildEmojis = await getPlatformEmojis(interaction.guild);
    const platformEmoji = guildEmojis[platform] || (platform === 'cf' ? '🏆' : platform === 'ac' ? '🎯' : platform === 'toph' ? '⚡' : '🐙');

    const user = getUser(userId);
    if (!user || !user[`${platform}_handle`]) {
      return interaction.editReply({
        embeds: [errorEmbed('Not Linked', `${platformEmoji} You don't have a **${names[platform]}** account linked.`)]
      });
    }

    unlinkPlatform(userId, platform);

    if (interaction.guildId) {
      const { updateDashboard } = require('../tasks/ratingSync');
      updateDashboard(interaction.client, interaction.guildId).catch(() => {});
    }

    return interaction.editReply({
      embeds: [successEmbed('Account Unlinked', `${platformEmoji} Your **${names[platform]}** account has been removed.`)]
    });
  }
};
