// utils/emojis.js — Custom emoji manager for CF, AC, and Toph logos
const fs = require('fs');
const path = require('path');

let emojiCache = {};

/**
 * Get or create custom emojis for Codeforces, AtCoder, and Toph logos.
 * On every bot restart: re-uploads all 3 logos if the v2 flag is not set.
 * Fallback to circle emojis if guild is missing or bot lacks permissions.
 */
async function getPlatformEmojis(guild) {
  if (!guild) return { cf: '🔵', ac: '🔴', toph: '🟣' };
  if (emojiCache[guild.id]) return emojiCache[guild.id];

  try {
    await guild.emojis.fetch().catch(e => console.warn(`[Emojis] Fetch failed:`, e.message));

    const { getConfig, setConfig } = require('../database/db');

    // v3 flag: delete & re-upload all logos (bumped to force new Toph circle logo on server)
    if (getConfig('reset_circle_emojis_v3') !== 'true') {
      console.log(`[Emojis] v3 reset — deleting old logos and re-uploading...`);
      for (const name of ['codeforces', 'atcoder', 'toph']) {
        const old = guild.emojis.cache.find(e => e.name === name);
        if (old) await old.delete().catch(() => {});
      }
      await guild.emojis.fetch().catch(() => {});
      setConfig('reset_circle_emojis_v3', 'true');
    }

    // ── Codeforces ─────────────────────────────────────────────────
    let cfEmoji = guild.emojis.cache.find(e => e.name === 'codeforces');
    if (!cfEmoji) {
      const p = path.join(__dirname, '..', 'assets', 'codeforces.png');
      if (fs.existsSync(p)) {
        console.log(`[Emojis] Uploading Codeforces logo...`);
        cfEmoji = await guild.emojis.create({ attachment: p, name: 'codeforces' }).catch(err => {
          console.warn(`[Emojis] codeforces emoji failed:`, err.message); return null;
        });
      }
    }

    // ── AtCoder ─────────────────────────────────────────────────────
    let acEmoji = guild.emojis.cache.find(e => e.name === 'atcoder');
    if (!acEmoji) {
      const p = path.join(__dirname, '..', 'assets', 'atcoder.png');
      if (fs.existsSync(p)) {
        console.log(`[Emojis] Uploading AtCoder logo...`);
        acEmoji = await guild.emojis.create({ attachment: p, name: 'atcoder' }).catch(err => {
          console.warn(`[Emojis] atcoder emoji failed:`, err.message); return null;
        });
      }
    }

    // ── Toph (circular, transparent bg) ─────────────────────────────
    let tophEmoji = guild.emojis.cache.find(e => e.name === 'toph');
    if (!tophEmoji) {
      const circle   = path.join(__dirname, '..', 'assets', 'toph_circle.png');
      const fallback = path.join(__dirname, '..', 'assets', 'toph.png');
      const p = fs.existsSync(circle) ? circle : fs.existsSync(fallback) ? fallback : null;
      if (p) {
        console.log(`[Emojis] Uploading Toph circle logo...`);
        tophEmoji = await guild.emojis.create({ attachment: p, name: 'toph' }).catch(err => {
          console.warn(`[Emojis] toph emoji failed:`, err.message); return null;
        });
      }
    }

    const result = {
      cf:   cfEmoji   ? `<:${cfEmoji.name}:${cfEmoji.id}>`     : '🔵',
      ac:   acEmoji   ? `<:${acEmoji.name}:${acEmoji.id}>`     : '🔴',
      toph: tophEmoji ? `<:${tophEmoji.name}:${tophEmoji.id}>` : '🟣'
    };

    if (cfEmoji && acEmoji && tophEmoji) emojiCache[guild.id] = result;
    return result;
  } catch (err) {
    console.error(`[Emojis] Failed in guild '${guild?.name}':`, err.message);
    return { cf: '🔵', ac: '🔴', toph: '🟣' };
  }
}

module.exports = { getPlatformEmojis };
