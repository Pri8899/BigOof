// tasks/autoBackup.js — Consistent WAL-safe hourly SQLite backup & startup auto-restore
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { AttachmentBuilder } = require('discord.js');
const {
  DB_PATH,
  createBackupCopy,
  getConfig,
  getAllUsers,
  reloadDatabase
} = require('../database/db');
const { getValidId } = require('../utils/envHelper');
const { getTimeZone } = require('../utils/time');

async function getBackupChannel(client) {
  let channelId = getConfig('backup_channel_id', 'global');
  if (channelId) {
    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (ch && ch.isTextBased()) return ch;
  }

  channelId = getValidId(process.env.BACKUP_CHANNEL_ID, null);
  if (channelId) {
    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (ch && ch.isTextBased()) return ch;
  }

  return null;
}

/**
 * Creates a clean online SQLite backup copy and uploads it to the backup channel.
 */
async function runBackup(client, { throwOnError = false } = {}) {
  if (!fs.existsSync(DB_PATH)) {
    const msg = `Database file not found at ${DB_PATH}`;
    console.warn(`[Backup] ${msg}`);
    if (throwOnError) throw new Error(msg);
    return false;
  }

  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fileName = `bigoof-backup-${timestamp}.db`;
  const tempCopyPath = `${DB_PATH}.upload-${Date.now()}.tmp`;

  try {
    const channel = await getBackupChannel(client);
    if (!channel) {
      const msg = 'No backup channel configured or accessible (set BACKUP_CHANNEL_ID or run /set-channel feature:Database Backups).';
      console.warn(`[Backup] ${msg}`);
      if (throwOnError) throw new Error(msg);
      return false;
    }

    await createBackupCopy(tempCopyPath);
    const attachment = new AttachmentBuilder(tempCopyPath, { name: fileName });

    await channel.send({
      content: `🗄️ **Auto Backup** — \`${timestamp} UTC\`\nFile: \`${fileName}\` — Use \`/restoredb\` → "latest" to restore this.`,
      files: [attachment]
    });

    console.log(`[Backup] Uploaded ${fileName} to #${channel.name}.`);
    return true;
  } catch (err) {
    console.error('[Backup] Failed to upload backup:', err.message);
    if (throwOnError) throw err;
    return false;
  } finally {
    if (fs.existsSync(tempCopyPath)) {
      try { fs.unlinkSync(tempCopyPath); } catch (_) {}
    }
  }
}

async function autoRestoreIfEmpty(client) {
  try {
    const users = getAllUsers();
    if (users && users.length > 0) {
      console.log(`[AutoRestore] Database active with ${users.length} users. Skipping auto-restore.`);
      return false;
    }

    console.log('[AutoRestore] Database is empty (0 users). Checking backup channel...');
    const channel = await getBackupChannel(client);
    if (!channel) {
      console.warn('[AutoRestore] Backup channel not found.');
      return false;
    }

    const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    if (!messages || messages.size === 0) return false;

    let latestBackup = null;
    for (const [, msg] of messages) {
      const dbAttach = msg.attachments.find(a => a.name.endsWith('.db') || a.name.endsWith('.sqlite'));
      if (dbAttach) {
        latestBackup = { url: dbAttach.url, name: dbAttach.name };
        break;
      }
    }

    if (!latestBackup) {
      console.log('[AutoRestore] No backup files found in backup channel.');
      return false;
    }

    console.log(`[AutoRestore] Found latest backup: ${latestBackup.name}. Restoring...`);
    const response = await axios.get(latestBackup.url, { responseType: 'arraybuffer', timeout: 30000 });
    const data = Buffer.from(response.data);

    reloadDatabase(data);

    const { updateDashboard } = require('./ratingSync');
    await updateDashboard(client).catch(() => {});

    const restoredUsers = getAllUsers();
    console.log(`[AutoRestore] Auto-restored database (${restoredUsers.length} users loaded).`);
    return true;
  } catch (err) {
    console.error('[AutoRestore] Error during automatic database restore:', err.message);
    return false;
  }
}

function startAutoBackup(client) {
  const tz = getTimeZone();

  setTimeout(async () => {
    await autoRestoreIfEmpty(client);
    // Only snapshot at boot once any empty-DB restore check has completed and users exist
    const users = getAllUsers();
    if (users && users.length > 0) {
      await runBackup(client);
    }
  }, 5000);

  cron.schedule('0 * * * *', () => {
    runBackup(client);
  }, { timezone: tz, noOverlap: true });

  console.log(`[Backup] Auto-backup task started (hourly in ${tz} + boot check).`);
}

module.exports = { startAutoBackup, runBackup, autoRestoreIfEmpty, getBackupChannel };
