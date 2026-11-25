// utils/emojis.js — Custom guild emoji manager for CF, AC, and Toph logos
const fs = require('fs');
const path = require('path');

const FALLBACK_EMOJIS = { cf: '🔵', ac: '🔴', toph: '🟣' };
const PLATFORM_INFO = {
  cf:     { name: 'Codeforces', choiceName: '🏆 Codeforces', fallbackEmoji: '🏆' },
  ac:     { name: 'AtCoder',    choiceName: '🎯 AtCoder',    fallbackEmoji: '🎯' },
  toph:   { name: 'Toph',       choiceName: '⚡ Toph',       fallbackEmoji: '⚡' },
  github: { name: 'GitHub',     choiceName: '🐙 GitHub',     fallbackEmoji: '🐙' }
};
const ALL_PLATFORM_CHOICES = Object.entries(PLATFORM_INFO).map(([value, info]) => ({
  name: info.choiceName,
  value
}));
const emojiCache = new Map(); // guildId -> { value, expiresAt, complete }

const PLATFORM_ASSETS = [
  { key: 'cf', emojiName: 'codeforces', file: 'codeforces.png' },
  { key: 'ac', emojiName: 'atcoder', file: 'atcoder.png' },
  { key: 'toph', emojiName: 'toph', file: 'toph.png' }
];

/**
 * Get or upload custom platform emojis for a guild, with per-guild reset tracking & TTL cache.
 */
async function getPlatformEmojis(guild) {
  if (!guild) return { ...FALLBACK_EMOJIS };

  const cached = emojiCache.get(guild.id);
  if (cached && Date.now() < cached.expiresAt) {
    // Verify cached custom emojis haven't been deleted externally
    const stillValid = !cached.complete || PLATFORM_ASSETS.every(({ emojiName }) =>
      guild.emojis.cache.some(e => e.name === emojiName)
    );
    if (stillValid) return cached.value;
  }

  try {
    await guild.emojis.fetch().catch(e => console.warn('[Emojis] Fetch failed:', e.message));

    // Per-guild v3 reset flag so multi-tenant servers reset independently
    try {
      const { getFullGuildConfig, setConfig } = require('../database/db');
      const guildCfg = getFullGuildConfig(guild.id);
      if (guildCfg.reset_circle_emojis_v3 !== 'true') {
        console.log(`[Emojis] v3 reset in guild '${guild.name}' — refreshing platform logos...`);
        for (const { emojiName } of PLATFORM_ASSETS) {
          const old = guild.emojis.cache.find(e => e.name === emojiName);
          if (old) await old.delete().catch(() => {});
        }
        await guild.emojis.fetch().catch(() => {});
        setConfig('reset_circle_emojis_v3', 'true', guild.id);
      }
    } catch (_) {
      // Skip reset check if DB is unavailable
    }

    const result = {};
    let uploadedCount = 0;

    for (const { key, emojiName, file } of PLATFORM_ASSETS) {
      let emoji = guild.emojis.cache.find(e => e.name === emojiName);
      if (!emoji) {
        const assetPath = path.join(__dirname, '..', 'assets', file);
        if (fs.existsSync(assetPath)) {
          console.log(`[Emojis] Uploading ${emojiName} logo in '${guild.name}'...`);
          emoji = await guild.emojis.create({
            attachment: fs.readFileSync(assetPath),
            name: emojiName
          }).catch(err => {
            console.warn(`[Emojis] ${emojiName} upload failed in '${guild.name}':`, err.message);
            return null;
          });
        }
      }
      if (emoji) uploadedCount++;
      result[key] = emoji ? `<:${emoji.name}:${emoji.id}>` : FALLBACK_EMOJIS[key];
    }

    const complete = uploadedCount === PLATFORM_ASSETS.length;
    // Cache both complete and partial results (shorter TTL if partial so missing permissions don't spam REST)
    emojiCache.set(guild.id, {
      value: result,
      complete,
      expiresAt: Date.now() + (complete ? 60 * 60 * 1000 : 10 * 60 * 1000)
    });

    return result;
  } catch (err) {
    console.error(`[Emojis] Failed in guild '${guild?.name}':`, err.message);
    return { ...FALLBACK_EMOJIS };
  }
}

module.exports = { getPlatformEmojis, PLATFORM_INFO, ALL_PLATFORM_CHOICES };
