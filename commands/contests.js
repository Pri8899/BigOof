// commands/contests.js — Show upcoming contests across CF, AtCoder, Toph, and Custom
const { SlashCommandBuilder } = require('discord.js');
const { getUpcomingContests, getConfig } = require('../database/db');
const { buildContestListEmbed } = require('../utils/embeds');
const { getPlatformEmojis } = require('../utils/emojis');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('contests')
    .setDescription('View upcoming competitive programming contests')
    .addStringOption(opt =>
      opt.setName('platform')
        .setDescription('Filter by platform (default: all)')
        .setRequired(false)
        .addChoices(
          { name: '🌐 All Platforms',   value: 'all' },
          { name: '🏆 Codeforces',      value: 'codeforces' },
          { name: '🎯 AtCoder',         value: 'atcoder' },
          { name: '⚡ Toph',            value: 'toph' },
          { name: '🌟 Custom Contests', value: 'custom' }
        )
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const platform = interaction.options.getString('platform') ?? 'all';
    const contests = getUpcomingContests(7 * 24 * 3600);
    const apiStatus = {
      cf: getConfig('cf_api_online') !== '0',
      ac: getConfig('ac_api_online') !== '0',
      toph: getConfig('toph_api_online') !== '0'
    };

    const emojis = await getPlatformEmojis(interaction.guild);
    const embed = buildContestListEmbed(contests, platform, apiStatus, emojis);
    return interaction.editReply({ embeds: [embed] });
  }
};
