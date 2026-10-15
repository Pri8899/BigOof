// commands/contests.js — Show upcoming contests (CF + AtCoder only)
const { SlashCommandBuilder } = require('discord.js');
const { getUpcomingContests } = require('../database/db');
const { buildContestListEmbed } = require('../utils/embeds');

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
        )),

  async execute(interaction) {
    const platform = interaction.options.getString('platform') ?? 'all';
    const contests = getUpcomingContests(7 * 24 * 3600);
    const { getPlatformEmojis } = require('../utils/emojis');
    const emojis = await getPlatformEmojis(interaction.guild);
    const embed    = buildContestListEmbed(contests, platform, {}, emojis);
    return interaction.reply({ embeds: [embed] });
  }
};
