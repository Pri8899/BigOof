// utils/envHelper.js — Environment validation, owner checks, shared channel defs, and guild-isolated routing
const { getConfig, setConfig } = require('../database/db');

const CHANNEL_DEFS = [
  { key: 'contest_channel_id',      label: '🏆 Contest Radar',        shortLabel: 'Contest Radar',        desc: 'Upcoming contests & reminders',                        optionDesc: 'Upcoming contests & reminders',             group: 'core' },
  { key: 'dashboard_channel_id',    label: '📊 Leaderboard Dashboard', shortLabel: 'Leaderboard Dashboard', desc: 'Live auto-updating member rankings',                   optionDesc: 'Auto-updating rankings',                    group: 'core' },
  { key: 'rating_channel_id',       label: '📈 Rating Updates',        shortLabel: 'Rating Updates',        desc: 'Rating change & tier promotion alerts',                optionDesc: 'Rating change & rank alerts',               group: 'core' },
  { key: 'suggest_channel_id',      label: '💡 Daily Challenges',      shortLabel: 'Daily Challenges',      desc: 'Daily algorithmic challenges',                         optionDesc: 'Daily problem suggestions',                 group: 'core' },
  { key: 'feed_channel_id',         label: '⚡ Live Submissions Feed', shortLabel: 'Live Submissions Feed', desc: 'Accepted solves posted as they happen',                optionDesc: 'Real-time accepted solves',                 group: 'core' },
  { key: 'wrapup_channel_id',       label: '🌅 Contest Wrap-up',       shortLabel: 'Contest Wrap-up',       desc: 'Next-day 9AM recap & upsolve radar',                   optionDesc: 'Next-day 9AM contest recap & upsolve',      group: 'core' },
  { key: 'github_channel_id',       label: '🐙 GitHub Activity Feed',  shortLabel: 'GitHub Activity Feed',  desc: 'Commits, releases, PRs, and new repos',                optionDesc: 'Commits, PRs, and repositories',            group: 'comm' },
  { key: 'announcement_channel_id', label: '📢 Announcements',         shortLabel: 'Announcements',         desc: 'Channel used by /announce',                            optionDesc: 'Broadcast channel for /announce',           group: 'comm' },
  { key: 'general_channel_id',      label: '💬 General Channel',       shortLabel: 'General Channel',       desc: 'Submissions, weekly digest, first blood & sweep alerts', optionDesc: 'Submissions, weekly digest, first blood & sweep', group: 'comm' },
  { key: 'study_channel_id',        label: '✅ Study To-Do',           shortLabel: 'Study To-Do',           desc: 'Interactive study checklist (auto-replaces at 100%)', optionDesc: 'Interactive study checklist board',         group: 'comm' }
];

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
 * Resolves unique `{ guild_id, channel }` targets across guilds (or for a single guild).
 */
async function getGuildTargetChannels(client, configKey, envVarName = null, specificGuildId = null) {
  const targets = [];
  const seenChannelIds = new Set();

  if (specificGuildId) {
    const ch = await getTargetChannel(client, configKey, envVarName, specificGuildId);
    if (ch) targets.push({ guild_id: specificGuildId, channel: ch });
    return targets;
  }

  for (const guild of client.guilds.cache.values()) {
    const ch = await getTargetChannel(client, configKey, envVarName, guild.id);
    if (ch && !seenChannelIds.has(ch.id)) {
      seenChannelIds.add(ch.id);
      targets.push({ guild_id: guild.id, channel: ch });
    }
  }

  if (targets.length === 0) {
    const globalCh = await getTargetChannel(client, configKey, envVarName);
    if (globalCh) targets.push({ guild_id: 'global', channel: globalCh });
  }

  return targets;
}

/**
 * Deletes previous matching bot messages in a channel and posts a fresh replacement message.
 */
async function replaceChannelBotMessage(
  client,
  channel,
  { matchMessage, storedConfigKey = null, guildId = null, payload, fallbackPayload = null, logLabel = 'Bot' }
) {
  const deletedIds = new Set();

  try {
    const messages = await channel.messages.fetch({ limit: 50 });
    for (const msg of messages.values()) {
      if (msg.author.id === client.user.id && matchMessage(msg)) {
        deletedIds.add(msg.id);
        await msg.delete().catch(() => {});
      }
    }
  } catch (err) {
    console.warn(`[${logLabel}] Failed fetching messages in #${channel.name}:`, err.message);
  }

  if (storedConfigKey && guildId) {
    const storedId = getConfig(storedConfigKey, guildId);
    if (storedId && !deletedIds.has(storedId)) {
      const oldMsg = await channel.messages.fetch(storedId).catch(() => null);
      if (oldMsg && oldMsg.author.id === client.user.id) {
        await oldMsg.delete().catch(() => {});
      }
    }
  }

  let newMsg = await channel.send(payload).catch(async err => {
    if (fallbackPayload) {
      return channel.send(fallbackPayload).catch(err2 => {
        console.warn(`[${logLabel}] Failed sending fallback message to #${channel.name}:`, err2.message);
        return null;
      });
    }
    console.warn(`[${logLabel}] Failed sending message to #${channel.name}:`, err.message);
    return null;
  });

  if (newMsg && storedConfigKey && guildId) {
    setConfig(storedConfigKey, newMsg.id, guildId);
  }
  return newMsg;
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
  CHANNEL_DEFS,
  getValidId,
  isBotOwner,
  getTargetChannel,
  resolveChannelChain,
  getGuildTargetChannels,
  replaceChannelBotMessage,
  chunkLines
};
