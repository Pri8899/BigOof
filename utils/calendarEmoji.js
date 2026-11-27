// utils/calendarEmoji.js — Pure-Node PNG calendar icon generator & Discord Application Emoji manager
const zlib = require('zlib');
const { getTimeZone, getLocalParts } = require('./time');

const MONTH_ABBRS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// Crisp 5x7 uppercase glyphs for months & digits
const FONT_5X7 = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  'A': ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  'B': ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  'C': ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  'D': ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  'E': ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  'F': ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  'G': ['01110', '10001', '10000', '10111', '10001', '10001', '01110'],
  'J': ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
  'L': ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  'M': ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  'N': ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  'O': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  'P': ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  'R': ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  'S': ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  'T': ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  'U': ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  'V': ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  'Y': ['10001', '10001', '01010', '00100', '00100', '00100', '00100']
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePngRGBA(width, height, rgba) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0; // Filter type 0 (None)
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // Bit depth
  ihdr[9] = 6; // RGBA color type
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function drawBitmapText(rgba, width, height, text, { centerX, topY, scaleX, scaleY, gap, color, bold = false }) {
  const chars = String(text).toUpperCase().split('');
  const charW = 5 * scaleX;
  const totalW = chars.length * charW + Math.max(0, chars.length - 1) * gap;
  let cursorX = Math.round(centerX - totalW / 2);

  const [r, g, b, a] = color;

  const fillRect = (x0, y0, w, h) => {
    for (let dy = 0; dy < h; dy++) {
      const py = y0 + dy;
      if (py < 0 || py >= height) continue;
      for (let dx = 0; dx < w; dx++) {
        const px = x0 + dx;
        if (px < 0 || px >= width) continue;
        const idx = (py * width + px) * 4;
        rgba[idx] = r;
        rgba[idx + 1] = g;
        rgba[idx + 2] = b;
        rgba[idx + 3] = a;
      }
    }
  };

  for (const ch of chars) {
    const glyph = FONT_5X7[ch];
    if (glyph) {
      for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 5; col++) {
          if (glyph[row][col] === '1') {
            fillRect(
              cursorX + col * scaleX,
              topY + row * scaleY,
              scaleX + (bold ? 1 : 0),
              scaleY + (bold ? 1 : 0)
            );
          }
        }
      }
    }
    cursorX += charW + gap;
  }
}

/**
 * Generates a crisp 128x128 rounded calendar PNG showing e.g. "NOV" and "27".
 */
function renderCalendarPng(monthAbbr, dayNum) {
  const S = 128;
  const rgba = Buffer.alloc(S * S * 4, 0);

  const left = 6;
  const right = 121;
  const top = 11;
  const bottom = 122;
  const radius = 18;
  const splitY = 47;

  // Compute alpha coverage against rounded card boundary
  const inRoundedRect = (x, y) => {
    if (x < left || x > right || y < top || y > bottom) return false;
    const cx = x < left + radius ? left + radius : (x > right - radius ? right - radius : x);
    const cy = y < top + radius ? top + radius : (y > bottom - radius ? bottom - radius : y);
    const dx = x - cx;
    const dy = y - cy;
    return (dx * dx + dy * dy) <= radius * radius;
  };

  const isHole = (x, y) => {
    const holes = [[24, 17], [103, 17]];
    for (const [hx, hy] of holes) {
      const dx = x - hx;
      const dy = y - hy;
      if (dx * dx + dy * dy <= 16) return true;
    }
    return false;
  };

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const idx = (y * S + x) * 4;
      if (!inRoundedRect(x, y)) continue;

      if (y < splitY) {
        if (isHole(x, y)) {
          // Binder hole cutout (dark slate shadow + hollow inner)
          rgba[idx] = 40;
          rgba[idx + 1] = 44;
          rgba[idx + 2] = 52;
          rgba[idx + 3] = 255;
        } else if (y >= splitY - 3) {
          rgba[idx] = 190;
          rgba[idx + 1] = 46;
          rgba[idx + 2] = 56;
          rgba[idx + 3] = 255;
        } else {
          // Crisp crimson header (#E03A44)
          rgba[idx] = 224;
          rgba[idx + 1] = 58;
          rgba[idx + 2] = 68;
          rgba[idx + 3] = 255;
        }
      } else if (y >= bottom - 5) {
        // Subtle 3D page edge along bottom
        rgba[idx] = 198;
        rgba[idx + 1] = 207;
        rgba[idx + 2] = 219;
        rgba[idx + 3] = 255;
      } else {
        // Crisp light calendar paper body (#EFF3F8)
        rgba[idx] = 239;
        rgba[idx + 1] = 243;
        rgba[idx + 2] = 248;
        rgba[idx + 3] = 255;
      }
    }
  }

  // Small metallic binder rings tucked cleanly outside month text (at x=24 & x=103)
  for (const rx of [24, 103]) {
    for (let y = 3; y <= 17; y++) {
      for (let x = rx - 3; x <= rx + 3; x++) {
        if (x < 0 || x >= S || y < 0 || y >= S) continue;
        const idx = (y * S + x) * 4;
        const isEdge = x === rx - 3 || x === rx + 3 || y === 3;
        rgba[idx] = isEdge ? 148 : 226;
        rgba[idx + 1] = isEdge ? 163 : 232;
        rgba[idx + 2] = isEdge ? 184 : 240;
        rgba[idx + 3] = 255;
      }
    }
  }

  // White bold Month label centered cleanly between rings
  drawBitmapText(rgba, S, S, monthAbbr, {
    centerX: 64,
    topY: 19,
    scaleX: 3,
    scaleY: 3,
    gap: 4,
    color: [255, 255, 255, 255],
    bold: true
  });

  // Large dark slate Day number centered on white body
  const dayStr = String(dayNum);
  const singleDigit = dayStr.length === 1;
  drawBitmapText(rgba, S, S, dayStr, {
    centerX: 64,
    topY: 56,
    scaleX: singleDigit ? 9 : 8,
    scaleY: 8,
    gap: singleDigit ? 0 : 8,
    color: [43, 52, 69, 255],
    bold: true
  });

  return encodePngRGBA(S, S, rgba);
}

/**
 * Resolves Date | UnixSeconds | 'MM/DD/YYYY' | 'YYYY-MM-DD' into { monthAbbr, day, emojiName, key }.
 */
function resolveCalendarDateInfo(dateInput = new Date(), tz = getTimeZone()) {
  let monthIdx;
  let day;

  if (typeof dateInput === 'string') {
    const s = dateInput.trim();
    const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (mdy) {
      monthIdx = parseInt(mdy[1], 10);
      day = parseInt(mdy[2], 10);
    } else if (iso) {
      monthIdx = parseInt(iso[2], 10);
      day = parseInt(iso[3], 10);
    }
  }

  if (!monthIdx || !day) {
    let dateObj;
    if (dateInput instanceof Date) {
      dateObj = dateInput;
    } else if (typeof dateInput === 'number' && Number.isFinite(dateInput)) {
      const ms = dateInput > 1e12 ? dateInput : dateInput * 1000;
      dateObj = new Date(ms);
    } else {
      dateObj = new Date();
    }
    const parts = getLocalParts(dateObj, tz);
    monthIdx = parts.month;
    day = parts.day;
  }

  const safeMonthIdx = Math.max(1, Math.min(12, Number(monthIdx) || 1));
  const safeDay = Math.max(1, Math.min(31, Number(day) || 1));
  const monthAbbr = MONTH_ABBRS[safeMonthIdx - 1];
  const dayPadded = String(safeDay).padStart(2, '0');
  const emojiName = `cal_${monthAbbr.toLowerCase()}_${dayPadded}`;

  return {
    monthIdx: safeMonthIdx,
    monthAbbr,
    day: safeDay,
    key: emojiName,
    emojiName
  };
}

function resolveCalendarDateKey(dateInput = new Date(), tz = getTimeZone()) {
  return resolveCalendarDateInfo(dateInput, tz).key;
}

const resolvedCache = new Map(); // emojiName -> '<:cal_nov_27:1234>'
const inFlightCreations = new Map();
let appEmojisHydrated = false;
let hydratePromise = null;

async function ensureAppEmojisHydrated(app) {
  if (appEmojisHydrated || !app?.emojis?.fetch) return;
  if (!hydratePromise) {
    hydratePromise = (async () => {
      try {
        if (!app.id) await app.fetch().catch(() => {});
        const fetched = await app.emojis.fetch().catch(() => null);
        if (fetched) {
          for (const emoji of fetched.values()) {
            if (emoji.name?.startsWith('cal_')) {
              resolvedCache.set(emoji.name, `<:${emoji.name}:${emoji.id}>`);
            }
          }
          appEmojisHydrated = true;
        }
      } catch (err) {
        console.warn('[CalendarEmoji] Could not fetch application emojis:', err.message);
      } finally {
        hydratePromise = null;
      }
    })();
  }
  await hydratePromise;
}

async function pruneOldCalendarEmojis(app, keepNames = new Set()) {
  try {
    const allCal = [...app.emojis.cache.values()]
      .filter(e => e.name?.startsWith('cal_') && !keepNames.has(e.name))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    const excess = allCal.length - 45;
    if (excess <= 0) return;
    for (let i = 0; i < excess; i++) {
      const target = allCal[i];
      await app.emojis.delete(target.id).catch(() => {});
      resolvedCache.delete(target.name);
    }
  } catch (_) {}
}

/**
 * Returns a custom Discord Application Emoji matching the actual month & day (e.g. NOV 27),
 * creating and caching it on demand. Falls back cleanly to fallbackEmoji when headless/unavailable.
 */
async function getCalendarEmoji(client, dateInput = new Date(), tz = getTimeZone(), fallbackEmoji = '🕒') {
  if (!dateInput) return fallbackEmoji;
  const info = resolveCalendarDateInfo(dateInput, tz);

  if (resolvedCache.has(info.emojiName)) {
    return resolvedCache.get(info.emojiName);
  }

  const app = client?.application;
  if (!app?.emojis?.create) {
    return fallbackEmoji;
  }

  if (inFlightCreations.has(info.emojiName)) {
    return inFlightCreations.get(info.emojiName);
  }

  const createTask = (async () => {
    try {
      await ensureAppEmojisHydrated(app);

      const existing = [...app.emojis.cache.values()].find(e => e.name === info.emojiName);
      if (existing) {
        const formatted = `<:${existing.name}:${existing.id}>`;
        resolvedCache.set(info.emojiName, formatted);
        return formatted;
      }

      if (!app.id) await app.fetch().catch(() => {});
      await pruneOldCalendarEmojis(app, new Set([info.emojiName]));

      const pngBuffer = renderCalendarPng(info.monthAbbr, info.day);
      const created = await app.emojis.create({
        attachment: pngBuffer,
        name: info.emojiName
      });

      if (created?.id) {
        const formatted = `<:${created.name}:${created.id}>`;
        resolvedCache.set(info.emojiName, formatted);
        console.log(`[CalendarEmoji] Created dynamic date emoji ${formatted} (${info.monthAbbr} ${info.day})`);
        return formatted;
      }
      return fallbackEmoji;
    } catch (err) {
      console.warn(`[CalendarEmoji] Failed creating ${info.emojiName}:`, err.message);
      return fallbackEmoji;
    } finally {
      inFlightCreations.delete(info.emojiName);
    }
  })();

  inFlightCreations.set(info.emojiName, createTask);
  return createTask;
}

/**
 * Batch-resolves unique calendar emojis for multiple dates/timestamps cleanly.
 */
async function getCalendarEmojisForDates(client, dateInputs = [], tz = getTimeZone(), fallbackEmoji = '🕒') {
  const uniqueByKey = new Map();
  for (const input of dateInputs) {
    if (!input) continue;
    const info = resolveCalendarDateInfo(input, tz);
    if (!uniqueByKey.has(info.key)) {
      uniqueByKey.set(info.key, input);
    }
  }

  const result = new Map();
  await Promise.all(
    [...uniqueByKey.entries()].map(async ([key, sampleInput]) => {
      const emoji = await getCalendarEmoji(client, sampleInput, tz, fallbackEmoji);
      result.set(key, emoji);
    })
  );
  return result;
}

module.exports = {
  renderCalendarPng,
  resolveCalendarDateInfo,
  resolveCalendarDateKey,
  getCalendarEmoji,
  getCalendarEmojisForDates
};
