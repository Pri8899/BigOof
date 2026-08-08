// commands/admin/backupdb.js — Manually trigger a DB backup to the backup channel
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { runBackup } = require('../../tasks/autoBackup');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('backupdb')
    .setDescription('Admin only: Manually back up the database to the backup channel right now.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    try {
      await runBackup(interaction.client);
      await interaction.editReply('✅ Database backup uploaded to the backup channel!');
    } catch (err) {
      console.error('[backupdb]', err);
      await interaction.editReply('❌ Backup failed. Check that the backup channel is set with `/set-backup-channel`.');
    }
  }
};
