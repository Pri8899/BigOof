// utils/envHelper.js — Environment validation, owner checks, and guild-isolated channel routing
const { getConfig } = require('../database/db');

function getValidId(val, fallback = null) {
  if (val && typeof val === 'string' && !val.includes('your_') && /^\d+$/.test(val.trim())) {
    return val.trim();
  }
  return fallback;
}

/**
 * Checks if the interacting user is the configured bot owner or Discord application owner/team member.
 */
function isBotOwner(interaction) {
  const ownerEnvId = getValidId(process.env.OWNER_ID, null);
  if (ownerEnvId && interaction.user.id === ownerEnvId) return true;

  const owner = interaction.client.application?.owner;
  if (!owner) return false;
  if (owner.id === interaction.user.id) return true;
  return Boolean(owner.members?.has(interaction.user.id));
}

async function fetchGuildTextChannel(client, channelId, expectedGuildId = null) {
  if (!channelId) return null;
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch || !ch.isTextBased()) return null;
  if (expectedGuildId && ch.guildId !== expectedGuildId) return null;
  return ch;
}

/**
 * Guild-isolated channel lookup:
 * 1. Guild DB config for `configKey`
 * 2. Guild DB config for `general_channel_id` (unless `options.strictKey` or system keys)
 * 3. Global DB config / env var ONLY if resolving without guildId OR channel belongs to `guildId`
 * 4. Explicit `fallbackId` (verified against `guildId` when provided)
 */
async function getTargetChannel(client, configKey, envVarName = null, guildId = null, fallbackId = null, options = {}) {
  const strictKey = Boolean(options.strictKey);

  if (guildId) {
    const guildDbId = getConfig(configKey, guildId);
    const guildCh = await fetchGuildTextChannel(client, guildDbId, guildId);
    if (guildCh) return guildCh;

    if (!strictKey && configKey !== 'backup_channel_id' && configKey !== 'general_channel_id') {
      const generalDbId = getConfig('general_channel_id', guildId);
      const generalCh = await fetchGuildTextChannel(client, generalDbId, guildId);
      if (generalCh) return generalCh;
    }
  }

  // Only allow global/env defaults when un-scoped OR when the resolved channel belongs to `guildId`
  const globalDbId = getConfig(configKey, 'global');
  const globalCh = await fetchGuildTextChannel(client, globalDbId, guildId);
  if (globalCh) return globalCh;

  if (envVarName) {
    const envId = getValidId(process.env[envVarName], null);
    const envCh = await fetchGuildTextChannel(client, envId, guildId);
    if (envCh) return envCh;
  }

  if (fallbackId) {
    const fallbackCh = await fetchGuildTextChannel(client, fallbackId, guildId);
    if (fallbackCh) return fallbackCh;
  }

  return null;
}

/**
 * Resolves an ordered fallback list of `{ key, env }` strictly before falling back to `general_channel_id`.
 */
async function resolveChannelChain(client, candidates, guildId = null) {
  for (const { key, env } of candidates) {
    const ch = await getTargetChannel(client, key, env, guildId, null, { strictKey: true });
    if (ch) return ch;
  }
  return getTargetChannel(client, 'general_channel_id', 'GENERAL_CHANNEL_ID', guildId, null, { strictKey: true });
}

/**
 * Splits a list of lines into safe embed field values <= maxLen characters.
 */
function chunkLines(lines, maxLen = 1000, separator = '\n') {
  const chunks = [];
  let current = '';

  for (const rawLine of lines) {
    const line = String(rawLine);
    const safeLine = line.length > maxLen ? `${line.slice(0, maxLen - 3)}...` : line;
    const candidate = current ? `${current}${separator}${safeLine}` : safeLine;

    if (candidate.length > maxLen) {
      if (current) chunks.push(current);
      current = safeLine;
    } else {
      current = candidate;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

module.exports = {
  getValidId,
  isBotOwner,
  getTargetChannel,
  resolveChannelChain,
  chunkLines
};
