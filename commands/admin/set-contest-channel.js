// commands/admin/set-contest-channel.js — Configure notification channels
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { setConfig }            = require('../../database/db');
const { successEmbed }         = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('set-contest-channel')
    .setDescription('Set which channel receives contest notifications (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption(opt =>
      opt.setName('channel')
        .setDescription('The channel to post contest notifications in')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)),

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel');
    setConfig('contest_channel_id', channel.id);

    return interaction.reply({
      embeds: [successEmbed(
        'Contest Channel Set',
        `Contest notifications will now be posted in ${channel}. 🏆`
      )],
      ephemeral: true
    });
  }
};
