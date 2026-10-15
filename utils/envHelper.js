// utils/envHelper.js — helper to validate environment variables and auto-detect channels
const { getConfig, setConfig } = require('../database/db');

function getValidId(val, fallback) {
  if (val && typeof val === 'string' && !val.includes('your_') && /^\d+$/.test(val.trim())) {
    return val.trim();
  }
  return fallback;
}

/**
 * Guild-aware channel finder:
 * 1. Checks DB config for the specific guild
 * 2. Checks DB config for global/fallback
 * 3. Checks process.env variable (optional hosting default)
 * 4. Checks fallback ID if explicitly provided
 */
async function getTargetChannel(client, configKey, envVarName = null, guildId = null, fallbackId = null) {
  // 1. Check guild-specific DB config
  if (guildId) {
    const guildDbId = getConfig(configKey, guildId);
    if (guildDbId) {
      const ch = await client.channels.fetch(guildDbId).catch(() => null);
      if (ch) return ch;
    }
    // Guild fallback: if specific feature is unset, check general_channel_id
    if (configKey !== 'backup_channel_id' && configKey !== 'general_channel_id') {
      const generalDbId = getConfig('general_channel_id', guildId);
      if (generalDbId) {
        const ch = await client.channels.fetch(generalDbId).catch(() => null);
        if (ch) return ch;
      }
    }
  }

  // 2. Check global DB config
  const globalDbId = getConfig(configKey, 'global');
  if (globalDbId) {
    const ch = await client.channels.fetch(globalDbId).catch(() => null);
    if (ch) return ch;
  }

  // 3. Check env variable
  if (envVarName) {
    const envId = getValidId(process.env[envVarName], null);
    if (envId) {
      const ch = await client.channels.fetch(envId).catch(() => null);
      if (ch) return ch;
    }
  }

  // 4. Check fallback ID
  if (fallbackId) {
    const ch = await client.channels.fetch(fallbackId).catch(() => null);
    if (ch) return ch;
  }

  return null;
}

module.exports = { getValidId, getTargetChannel };
