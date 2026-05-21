// commands/admin/set-dashboard-channel.js — Configure dashboard channel
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { setConfig }    = require('../../database/db');
const { successEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('set-dashboard-channel')
    .setDescription('Set which channel is used for the CP leaderboard dashboard (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption(opt =>
      opt.setName('channel')
        .setDescription('The channel to post the dashboard in')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)),

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel');
    setConfig('dashboard_channel_id', channel.id);
    setConfig('dashboard_message_id', ''); // Reset so a fresh message is created

    return interaction.reply({
      embeds: [successEmbed(
        'Dashboard Channel Set',
        `The CP leaderboard dashboard will be maintained in ${channel}. It will auto-update every hour. 📊`
      )],
      ephemeral: true
    });
  }
};
