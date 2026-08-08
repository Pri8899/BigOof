// commands/admin/set-backup-channel.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { setConfig } = require('../../database/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('set-backup-channel')
    .setDescription('Admin only: Set the private channel where DB backups are auto-saved every 6 hours.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(opt =>
      opt.setName('channel')
        .setDescription('The private channel to send backups to')
        .setRequired(true)
    ),

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel');
    setConfig('backup_channel_id', channel.id);
    await interaction.reply({
      content: `✅ Backup channel set to ${channel}! The database will be auto-saved there every 6 hours, and immediately in 30 seconds.`,
      ephemeral: true
    });
  }
};
