// commands/admin/set-suggest-channel.js
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { setConfig }    = require('../../database/db');
const { successEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('set-suggest-channel')
    .setDescription('Set the channel for daily tiered problem suggestions at 9pm (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption(opt =>
      opt.setName('channel')
        .setDescription('Channel for daily problem recommendations')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)),

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel');
    setConfig('suggest_channel_id', channel.id);
    return interaction.reply({
      embeds: [successEmbed('Suggestions Channel Set',
        `💡 Daily problem recommendations will be posted in ${channel} at **9:00 PM (UTC+6)**.\nCovers Beginner, Intermediate, and Advanced difficulty tiers.`)],
      ephemeral: true
    });
  }
};
