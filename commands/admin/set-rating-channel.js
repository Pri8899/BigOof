// commands/admin/set-rating-channel.js
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { setConfig }    = require('../../database/db');
const { successEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('set-rating-channel')
    .setDescription('Set the channel for rating change alerts — #cp-rating-update (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption(opt =>
      opt.setName('channel')
        .setDescription('Channel for rating change notifications')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)),

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel');
    setConfig('rating_channel_id', channel.id);
    return interaction.reply({
      embeds: [successEmbed('Rating Channel Set',
        `Rating change alerts (📈📉) will now be posted in ${channel}.\nThis fires automatically after each hourly sync.`)],
      ephemeral: true
    });
  }
};
