// utils/emojis.js — Custom emoji manager for CF, AC, and Toph logos
const fs = require('fs');
const path = require('path');

let emojiCache = {};

/**
 * Get or create custom emojis for Codeforces, AtCoder, and Toph logos on the specified guild.
 * Fallback to default circle emojis if guild is missing or bot lacks permissions.
 */
async function getPlatformEmojis(guild) {
  if (!guild) {
    return { cf: '🔵', ac: '🔴', toph: '🟣' };
  }

  if (emojiCache[guild.id]) {
    return emojiCache[guild.id];
  }

  try {
    await guild.emojis.fetch().catch(e => console.warn(`[Emojis] Fetch failed:`, e.message));

    const { getConfig, setConfig } = require('../database/db');
    const emojiReset = getConfig('reset_circle_emojis_v1');
    if (emojiReset !== 'true') {
      console.log(`[Emojis] Resetting guild emojis to upload circular versions...`);
      const existingCf = guild.emojis.cache.find(e => e.name === 'codeforces');
      if (existingCf) await existingCf.delete().catch(err => console.warn(`[Emojis] Failed to delete old CF emoji:`, err.message));
      const existingAc = guild.emojis.cache.find(e => e.name === 'atcoder');
      if (existingAc) await existingAc.delete().catch(err => console.warn(`[Emojis] Failed to delete old AC emoji:`, err.message));
      await guild.emojis.fetch().catch(() => {});
      setConfig('reset_circle_emojis_v1', 'true');
    }

    // ── Codeforces ──────────────────────────────────────────────────
    let cfEmoji = guild.emojis.cache.find(e => e.name === 'codeforces');
    if (!cfEmoji) {
      const cfPath = path.join(__dirname, '..', 'assets', 'codeforces.png');
      if (fs.existsSync(cfPath)) {
        console.log(`[Emojis] Uploading Codeforces logo to '${guild.name}'...`);
        cfEmoji = await guild.emojis.create({ attachment: cfPath, name: 'codeforces' }).catch(err => {
          console.warn(`[Emojis] Could not create codeforces emoji:`, err.message);
          return null;
        });
      }
    }

    // ── AtCoder ─────────────────────────────────────────────────────
    let acEmoji = guild.emojis.cache.find(e => e.name === 'atcoder');
    if (!acEmoji) {
      const acPath = path.join(__dirname, '..', 'assets', 'atcoder.png');
      if (fs.existsSync(acPath)) {
        console.log(`[Emojis] Uploading AtCoder logo to '${guild.name}'...`);
        acEmoji = await guild.emojis.create({ attachment: acPath, name: 'atcoder' }).catch(err => {
          console.warn(`[Emojis] Could not create atcoder emoji:`, err.message);
          return null;
        });
      }
    }

    // ── Toph ────────────────────────────────────────────────────────
    let tophEmoji = guild.emojis.cache.find(e => e.name === 'toph');
    if (!tophEmoji) {
      // Try assets/toph.png first, then assets/ODF.png as fallback
      const tophPath = path.join(__dirname, '..', 'assets', 'toph.png');
      const odfPath  = path.join(__dirname, '..', 'assets', 'ODF.png');
      const logoPath = fs.existsSync(tophPath) ? tophPath : fs.existsSync(odfPath) ? odfPath : null;
      if (logoPath) {
        console.log(`[Emojis] Uploading Toph logo to '${guild.name}'...`);
        tophEmoji = await guild.emojis.create({ attachment: logoPath, name: 'toph' }).catch(err => {
          console.warn(`[Emojis] Could not create toph emoji:`, err.message);
          return null;
        });
      }
    }

    const result = {
      cf:   cfEmoji   ? `<:${cfEmoji.name}:${cfEmoji.id}>`     : '🔵',
      ac:   acEmoji   ? `<:${acEmoji.name}:${acEmoji.id}>`     : '🔴',
      toph: tophEmoji ? `<:${tophEmoji.name}:${tophEmoji.id}>` : '🟣'
    };

    if (cfEmoji && acEmoji && tophEmoji) {
      emojiCache[guild.id] = result;
    }
    return result;
  } catch (err) {
    console.error(`[Emojis] Failed to manage custom emojis in guild '${guild.name}':`, err.message);
    return { cf: '🔵', ac: '🔴', toph: '🟣' };
  }
}

module.exports = { getPlatformEmojis };
