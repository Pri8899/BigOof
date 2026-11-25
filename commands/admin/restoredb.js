// commands/admin/restoredb.js — Validate & restore SQLite DB from backup channel or manual upload
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const axios = require('axios');
const { reloadDatabase } = require('../../database/db');
const { getBackupChannel } = require('../../tasks/autoBackup');
const { updateDashboard } = require('../../tasks/ratingSync');
const { isBotOwner } = require('../../utils/envHelper');
const { successEmbed, errorEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('restoredb')
    .setDescription('Bot Owner only: Restore the database from a backup.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt =>
      opt.setName('source')
        .setDescription('Where to restore from')
        .setRequired(true)
        .addChoices(
          { name: '📥 Latest auto-backup (from backup channel)', value: 'latest' },
          { name: '📎 Upload a .db file manually', value: 'upload' }
        )
    )
    .addAttachmentOption(opt =>
      opt.setName('database')
        .setDescription('The .db or .sqlite file to restore (required when source = upload)')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });

    if (!isBotOwner(interaction)) {
      return interaction.editReply({
        embeds: [errorEmbed('Permission Denied', 'Database restore is restricted to the Bot Owner.')]
      });
    }

    const source = interaction.options.getString('source');
    let downloadUrl = null;
    let fileName = 'bigoof.db';

    if (source === 'latest') {
      const channel = await getBackupChannel(interaction.client);
      if (!channel) {
        return interaction.editReply({
          embeds: [errorEmbed(
            'No Backup Channel',
            'No backup channel configured or accessible.\nSet one with `/set-channel feature:Database Backups` or `BACKUP_CHANNEL_ID` in `.env`.'
          )]
        });
      }

      const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
      if (!messages || messages.size === 0) {
        return interaction.editReply({
          embeds: [errorEmbed('No Backups Found', 'No backup messages found in the backup channel. Run `/backupdb` first.')]
        });
      }

      let latestBackupMsg = null;
      for (const [, msg] of messages) {
        const dbAttach = msg.attachments.find(a => a.name.endsWith('.db') || a.name.endsWith('.sqlite'));
        if (dbAttach) {
          latestBackupMsg = { url: dbAttach.url, name: dbAttach.name, timestamp: msg.createdAt };
          break;
        }
      }

      if (!latestBackupMsg) {
        return interaction.editReply({
          embeds: [errorEmbed('No Backups Found', 'No `.db` or `.sqlite` attachments found in the backup channel.')]
        });
      }

      downloadUrl = latestBackupMsg.url;
      fileName = latestBackupMsg.name;
      await interaction.editReply(`⏳ Found backup \`${fileName}\` (${latestBackupMsg.timestamp.toUTCString()}). Verifying & restoring...`);
    }

    if (source === 'upload') {
      const attachment = interaction.options.getAttachment('database');
      if (!attachment) {
        return interaction.editReply({
          embeds: [errorEmbed('Missing File', 'Please attach a `.db` or `.sqlite` file when using the Upload option.')]
        });
      }
      if (!attachment.name.endsWith('.db') && !attachment.name.endsWith('.sqlite')) {
        return interaction.editReply({
          embeds: [errorEmbed('Invalid File Type', 'Please upload a valid `.db` or `.sqlite` file.')]
        });
      }
      downloadUrl = attachment.url;
      fileName = attachment.name;
      await interaction.editReply(`⏳ Downloading \`${fileName}\`... Verifying & restoring...`);
    }

    try {
      const response = await axios.get(downloadUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
        maxContentLength: 50 * 1024 * 1024
      });
      const data = Buffer.from(response.data);

      reloadDatabase(data);

      await updateDashboard(interaction.client).catch(err =>
        console.warn('[restoredb] Dashboard refresh notice:', err.message)
      );

      return interaction.editReply({
        content: null,
        embeds: [successEmbed(
          'Database Restored',
          `Successfully verified and restored \`${fileName}\`!\nAll users, ratings, and dashboards have been refreshed live.`
        )]
      });
    } catch (err) {
      console.error('[restoredb] Error:', err.message);
      return interaction.editReply({
        content: null,
        embeds: [errorEmbed('Restore Failed', `Could not restore \`${fileName}\`: ${err.message}`)]
      });
    }
  }
};
