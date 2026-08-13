// tasks/autoBackup.js — Auto-backup cpbot.db to a Discord channel every 1 hour
const cron = require('node-cron');
const fs   = require('fs');
const path = require('path');
const axios = require('axios');
const { AttachmentBuilder } = require('discord.js');
const { getConfig, setConfig, getAllUsers, reloadDatabase } = require('../database/db');
const { getValidId } = require('../utils/envHelper');

// Resolve database path matching database/db.js
let defaultDbPath = path.join(__dirname, '..', 'cpbot.db');
if (process.env.RAILWAY_ENVIRONMENT && fs.existsSync('/data')) {
  defaultDbPath = '/data/cpbot.db';
}
const DB_PATH = process.env.DATABASE_PATH || defaultDbPath;

async function getBackupChannel(client) {
  // 1. Try DB config
  let channelId = getConfig('backup_channel_id');
  if (channelId) {
    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (ch) return ch;
  }

  // 2. Try env variable
  channelId = getValidId(process.env.BACKUP_CHANNEL_ID, null);
  if (channelId) {
    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (ch) return ch;
  }

  // 3. Auto-detect channel by name ("🔴-backup" or "backup") across all guilds
  for (const guild of client.guilds.cache.values()) {
    const found = guild.channels.cache.find(c => c.isTextBased() && (c.name.includes('backup') || c.name.includes('🔴')));
    if (found) {
      console.log(`[Backup] Auto-detected backup channel: #${found.name} (${found.id})`);
      setConfig('backup_channel_id', found.id);
      return found;
    }
  }

  return null;
}

async function runBackup(client) {
  if (!fs.existsSync(DB_PATH)) {
    console.warn('[Backup] cpbot.db not found at', DB_PATH);
    return;
  }

  try {
    const channel = await getBackupChannel(client);
    if (!channel) {
      console.warn('[Backup] No backup channel found or configured.');
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

    console.log(`[Backup] ✅ Uploaded ${fileName} to #${channel.name}.`);
  } catch (err) {
    console.error('[Backup] Failed to upload backup:', err.message);
  }
}

async function autoRestoreIfEmpty(client) {
  try {
    const users = getAllUsers();
    if (users && users.length > 0) {
      console.log(`[AutoRestore] Database active with ${users.length} users. Skipping auto-restore.`);
      return;
    }

    console.log('[AutoRestore] Database is empty (0 users). Searching for latest backup to auto-restore...');
    const channel = await getBackupChannel(client);
    if (!channel) {
      console.warn('[AutoRestore] Backup channel not found.');
      return;
    }

    const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    if (!messages || messages.size === 0) return;

    let latestBackupUrl = null;
    let latestBackupName = null;
    for (const [, msg] of messages) {
      const dbAttach = msg.attachments.find(a => a.name.endsWith('.db'));
      if (dbAttach) {
        latestBackupUrl = dbAttach.url;
        latestBackupName = dbAttach.name;
        break;
      }
    }

    if (!latestBackupUrl) {
      console.log('[AutoRestore] No backup files found in backup channel.');
      return;
    }

    console.log(`[AutoRestore] Found latest backup: ${latestBackupName}. Downloading & restoring...`);
    const response = await axios.get(latestBackupUrl, { responseType: 'arraybuffer', timeout: 30000 });
    const data = Buffer.from(response.data);

    reloadDatabase(data);

    const { updateDashboard } = require('./ratingSync');
    await updateDashboard(client);

    const restoredUsers = getAllUsers();
    console.log(`[AutoRestore] ✅ Successfully auto-restored database! ${restoredUsers.length} users loaded.`);
  } catch (err) {
    console.error('[AutoRestore] Error during automatic database restore:', err.message);
  }
}

function startAutoBackup(client) {
  // Check and auto-restore if database starts empty (5s after boot)
  setTimeout(() => autoRestoreIfEmpty(client), 5000);

  // Run auto backup 30s after startup (upload initial snapshot)
  setTimeout(() => runBackup(client), 30000);

  // Run auto backup every 1 hour at minute 0 in Asia/Dhaka timezone
  cron.schedule('0 * * * *', () => {
    runBackup(client);
  }, { timezone: 'Asia/Dhaka' });

  console.log('[Backup] Auto-backup task started (every 1 hour + startup check).');
}

module.exports = { startAutoBackup, runBackup, autoRestoreIfEmpty };
