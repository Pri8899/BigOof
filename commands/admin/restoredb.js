// commands/admin/restoredb.js — Restore DB from latest auto-backup OR manual file upload
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const fs   = require('fs');
const path = require('path');
const axios = require('axios');
const { getConfig } = require('../../database/db');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '../../cpbot.db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('restoredb')
    .setDescription('Admin only: Restore the database from a backup.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt =>
      opt.setName('source')
        .setDescription('Where to restore from')
        .setRequired(true)
        .addChoices(
          { name: '📥 Latest auto-backup (from backup channel)', value: 'latest' },
          { name: '📎 Upload a .db file manually',               value: 'upload' }
        )
    )
    .addAttachmentOption(opt =>
      opt.setName('database')
        .setDescription('The cpbot.db file to upload (only needed if source = Upload)')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const source = interaction.options.getString('source');
    let downloadUrl = null;
    let fileName    = 'cpbot.db';

    // ── Source: latest backup from channel ─────────────────────
    if (source === 'latest') {
      const channelId = getConfig('backup_channel_id') || process.env.BACKUP_CHANNEL_ID;
      if (!channelId) {
        return interaction.editReply('❌ No backup channel found in DB or env vars.\n\nFix: Add `BACKUP_CHANNEL_ID = <your backup channel id>` to Railway Variables, then redeploy and try again.');
      }

      const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
      if (!channel) {
        return interaction.editReply('❌ Could not find the backup channel. Has it been deleted?');
      }

      // Fetch the last 50 messages and find the latest .db attachment
      const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
      if (!messages || messages.size === 0) {
        return interaction.editReply('❌ No backup messages found in the backup channel. Run `/backupdb` first.');
      }

      let latestBackupMsg = null;
      for (const [, msg] of messages) {
        const dbAttach = msg.attachments.find(a => a.name.endsWith('.db'));
        if (dbAttach) {
          latestBackupMsg = { url: dbAttach.url, name: dbAttach.name, timestamp: msg.createdAt };
          break; // messages.fetch returns newest-first
        }
      }

      if (!latestBackupMsg) {
        return interaction.editReply('❌ No .db backup files found in the backup channel.');
      }

      downloadUrl = latestBackupMsg.url;
      fileName    = latestBackupMsg.name;

      await interaction.editReply(`⏳ Found backup \`${fileName}\` (${latestBackupMsg.timestamp.toUTCString()}). Restoring...`);
    }

    // ── Source: manual upload ───────────────────────────────────
    if (source === 'upload') {
      const attachment = interaction.options.getAttachment('database');
      if (!attachment) {
        return interaction.editReply('❌ Please attach a `.db` file when using the "Upload" option.');
      }
      if (!attachment.name.endsWith('.db') && !attachment.name.endsWith('.sqlite')) {
        return interaction.editReply('❌ Please upload a valid `.db` or `.sqlite` file.');
      }
      downloadUrl = attachment.url;
      fileName    = attachment.name;
      await interaction.editReply(`⏳ Downloading \`${fileName}\`... Restoring...`);
    }

    // ── Download & replace DB ───────────────────────────────────
    try {
      // Download the file
      const response = await axios.get(downloadUrl, { responseType: 'arraybuffer', timeout: 30000 });
      const data = Buffer.from(response.data);

      // Backup the current DB just in case
      if (fs.existsSync(DB_PATH)) {
        fs.copyFileSync(DB_PATH, DB_PATH + '.pre-restore');
      }

      // Close DB, remove WAL files, write new DB
      try {
        const { db } = require('../../database/db');
        db.close();
      } catch (e) { /* ignore */ }

      if (fs.existsSync(DB_PATH + '-wal')) fs.unlinkSync(DB_PATH + '-wal');
      if (fs.existsSync(DB_PATH + '-shm')) fs.unlinkSync(DB_PATH + '-shm');

      fs.writeFileSync(DB_PATH, data);

      await interaction.editReply(
        `✅ Database restored from \`${fileName}\`!\n` +
        `The bot will now restart to load the restored data. Wait ~10 seconds...`
      );

      setTimeout(() => process.exit(0), 2000);

    } catch (err) {
      console.error('[restoredb] Error:', err.message);
      await interaction.editReply(`❌ Failed to restore database: ${err.message}`);
    }
  }
};
