// commands/admin/backupdb.js — Manually trigger a consistent WAL-safe DB backup
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { runBackup } = require('../../tasks/autoBackup');
const { isBotOwner } = require('../../utils/envHelper');
const { successEmbed, errorEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('backupdb')
    .setDescription('Bot Owner only: Immediately upload a database backup to the backup channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });

    if (!isBotOwner(interaction)) {
      return interaction.editReply({
        embeds: [errorEmbed('Permission Denied', 'Database operations are restricted to the Bot Owner.')]
      });
    }

    try {
      await runBackup(interaction.client, { throwOnError: true });
      return interaction.editReply({
        embeds: [successEmbed('Backup Uploaded', 'Database snapshot created cleanly and uploaded to the backup channel!')]
      });
    } catch (err) {
      console.error('[backupdb]', err.message);
      return interaction.editReply({
        embeds: [errorEmbed('Backup Failed', err.message)]
      });
    }
  }
};
