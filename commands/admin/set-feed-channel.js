const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { setConfig } = require('../../database/db');
const { successEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('set-feed-channel')
    .setDescription('[Admin] Set the channel for the Live Accepted Submission Feed')
    .addChannelOption(opt =>
      opt.setName('channel')
        .setDescription('The channel to post live submissions in')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel');
    setConfig('feed_channel_id', channel.id);

    const embed = successEmbed(
      'Live Feed Channel Set',
      `Live accepted submissions (Codeforces & AtCoder) will now be posted in <#${channel.id}>.`
    );
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
