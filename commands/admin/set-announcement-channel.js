// commands/admin/set-announcement-channel.js — Configure the announcement channel
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { setConfig }            = require('../../database/db');
const { successEmbed }         = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('set-announcement-channel')
    .setDescription('Set which channel receives announcements (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption(opt =>
      opt.setName('channel')
        .setDescription('The channel to post announcements in')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)),

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel');
    setConfig('announcement_channel_id', channel.id);

    return interaction.reply({
      embeds: [successEmbed(
        'Announcement Channel Set',
        `Announcements will now be posted in ${channel}. 📢`
      )],
      ephemeral: true
    });
  }
};
