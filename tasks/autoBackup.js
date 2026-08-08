// tasks/autoBackup.js — Auto-backup cpbot.db to a Discord channel every 6 hours
const cron = require('node-cron');
const fs   = require('fs');
const path = require('path');
const { AttachmentBuilder } = require('discord.js');
const { getConfig } = require('../database/db');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '../cpbot.db');

async function runBackup(client) {
  const channelId = getConfig('backup_channel_id');
  if (!channelId) return; // No backup channel set — skip silently

  if (!fs.existsSync(DB_PATH)) {
    console.warn('[Backup] cpbot.db not found at', DB_PATH);
    return;
  }

  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) {
      console.warn('[Backup] Backup channel not found:', channelId);
      return;
    }

    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName  = `cpbot-backup-${timestamp}.db`;

    const attachment = new AttachmentBuilder(DB_PATH, { name: fileName });

    await channel.send({
      content: `🗄️ **Auto Backup** — \`${timestamp} UTC\`\nFile: \`${fileName}\` — Use \`/restoredb\` → "latest" to restore this.`,
      files: [attachment]
    });

    console.log(`[Backup] ✅ Uploaded ${fileName} to backup channel.`);
  } catch (err) {
    console.error('[Backup] Failed to upload backup:', err.message);
  }
}

function startAutoBackup(client) {
  // Run every 6 hours
  cron.schedule('0 */6 * * *', () => {
    runBackup(client);
  });

  // Also run once on startup after 30 seconds (so DB is fully ready)
  setTimeout(() => runBackup(client), 30000);

  console.log('[Backup] Auto-backup task started (every 6 hours).');
}

module.exports = { startAutoBackup, runBackup };
