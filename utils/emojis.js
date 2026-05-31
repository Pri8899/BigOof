// utils/emojis.js — Custom emoji manager for Codeforces and AtCoder logos
const fs = require('fs');
const path = require('path');

let emojiCache = {};

/**
 * Get or create custom emojis for Codeforces and AtCoder logos on the specified guild
 * Fallback to 🔵 and 🔴 if guild is missing or bot lacks permissions
 */
async function getPlatformEmojis(guild) {
  if (!guild) {
    return { cf: '🔵', ac: '🔴' };
  }
  
  if (emojiCache[guild.id]) {
    return emojiCache[guild.id];
  }
  
  try {
    // Fetch emojis to populate cache
    await guild.emojis.fetch().catch(e => console.warn(`[Emojis] Fetch failed:`, e.message));

    // 1. Search for existing emojis by name
    let cfEmoji = guild.emojis.cache.find(e => e.name === 'codeforces');
    if (!cfEmoji) {
      const cfPath = path.join(__dirname, '..', 'assets', 'codeforces.png');
      if (fs.existsSync(cfPath)) {
        console.log(`[Emojis] Codeforces logo not found in guild '${guild.name}'. Uploading...`);
        cfEmoji = await guild.emojis.create({ attachment: cfPath, name: 'codeforces' }).catch(err => {
          console.warn(`[Emojis] Could not create codeforces emoji:`, err.message);
          return null;
        });
      }
    }
    
    let acEmoji = guild.emojis.cache.find(e => e.name === 'atcoder');
    if (!acEmoji) {
      const acPath = path.join(__dirname, '..', 'assets', 'atcoder.png');
      if (fs.existsSync(acPath)) {
        console.log(`[Emojis] AtCoder logo not found in guild '${guild.name}'. Uploading...`);
        acEmoji = await guild.emojis.create({ attachment: acPath, name: 'atcoder' }).catch(err => {
          console.warn(`[Emojis] Could not create atcoder emoji:`, err.message);
          return null;
        });
      }
    }
    
    const result = {
      cf: cfEmoji ? `<:${cfEmoji.name}:${cfEmoji.id}>` : '🔵',
      ac: acEmoji ? `<:${acEmoji.name}:${acEmoji.id}>` : '🔴'
    };
    
    // Only cache if both were successfully resolved/created
    if (cfEmoji && acEmoji) {
      emojiCache[guild.id] = result;
    }
    return result;
  } catch (err) {
    console.error(`[Emojis] Failed to manage custom emojis in guild '${guild.name}':`, err.message);
    return { cf: '🔵', ac: '🔴' };
  }
}

module.exports = { getPlatformEmojis };
