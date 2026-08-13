// utils/envHelper.js — helper to validate environment variables and auto-detect channels
const { getConfig, setConfig } = require('../database/db');

function getValidId(val, fallback) {
  if (val && typeof val === 'string' && !val.includes('your_') && /^\d+$/.test(val.trim())) {
    return val.trim();
  }
  return fallback;
}

/**
 * Robust channel finder:
 * 1. Checks DB config
 * 2. Checks process.env variable
 * 3. Checks hardcoded fallback ID
 * 4. Auto-detects by searching channel names across server
 */
async function getTargetChannel(client, configKey, envVarName, keywords = [], fallbackId = null) {
  // 1. Check DB config
  const dbId = getConfig(configKey);
  if (dbId) {
    const ch = await client.channels.fetch(dbId).catch(() => null);
    if (ch) return ch;
  }

  // 2. Check env variable
  const envId = getValidId(process.env[envVarName], null);
  if (envId) {
    const ch = await client.channels.fetch(envId).catch(() => null);
    if (ch) {
      setConfig(configKey, ch.id);
      return ch;
    }
  }

  // 3. Check fallback ID
  if (fallbackId) {
    const ch = await client.channels.fetch(fallbackId).catch(() => null);
    if (ch) {
      setConfig(configKey, ch.id);
      return ch;
    }
  }

  // 4. Auto-detect by channel name keywords
  if (Array.isArray(keywords) && keywords.length > 0) {
    for (const guild of client.guilds.cache.values()) {
      const found = guild.channels.cache.find(c => {
        if (!c.isTextBased()) return false;
        const lowerName = c.name.toLowerCase();
        return keywords.some(k => lowerName.includes(k.toLowerCase()));
      });

      if (found) {
        console.log(`[AutoChannel] Auto-detected channel #${found.name} (${found.id}) for key: ${configKey}`);
        setConfig(configKey, found.id);
        return found;
      }
    }
  }

  return null;
}

module.exports = { getValidId, getTargetChannel };
