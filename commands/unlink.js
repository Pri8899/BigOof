// commands/unlink.js — Unlink a CP platform account
const { SlashCommandBuilder } = require('discord.js');
const { getUser, unlinkPlatform } = require('../database/db');
const { successEmbed, errorEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unlink')
    .setDescription('Unlink a competitive programming account')
    .addStringOption(opt =>
      opt.setName('platform')
        .setDescription('Platform to unlink')
        .setRequired(true)
        .addChoices(
          { name: '🔵 Codeforces', value: 'cf' },
          { name: '🔴 AtCoder',    value: 'ac' }
        )),

  async execute(interaction) {
    const platform = interaction.options.getString('platform');
    const userId   = interaction.user.id;
    const names    = { cf: 'Codeforces', ac: 'AtCoder' };

    const { getPlatformEmojis } = require('../utils/emojis');
    const emojis = await getPlatformEmojis(interaction.guild);
    const platformEmoji = platform === 'cf' ? emojis.cf : emojis.ac;

    const user = getUser(userId);
    if (!user || !user[`${platform}_handle`]) {
      return interaction.reply({
        embeds: [errorEmbed('Not Linked', `${platformEmoji} You don't have a **${names[platform]}** account linked.`)],
        ephemeral: true
      });
    }

    unlinkPlatform(userId, platform);

    const { updateDashboard } = require('../tasks/ratingSync');
    updateDashboard(interaction.client).catch(err => console.error('[unlink] Dashboard update failed:', err.message));

    return interaction.reply({
      embeds: [successEmbed('Account Unlinked', `${platformEmoji} Your **${names[platform]}** account has been removed.`)],
      ephemeral: true
    });
  }
};
