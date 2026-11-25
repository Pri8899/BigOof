// database/db.js — SQLite setup, migrations, transactions, and helper functions
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

let defaultDbPath = path.join(__dirname, '..', 'bigoof.db');
if (!fs.existsSync(defaultDbPath) && fs.existsSync(path.join(__dirname, '..', 'cpbot.db'))) {
  defaultDbPath = path.join(__dirname, '..', 'cpbot.db');
}

const DB_PATH = process.env.DATABASE_PATH || defaultDbPath;
let dbInstance;

function ensureSchema(instance) {
  instance.exec(`
    CREATE TABLE IF NOT EXISTS users (
      discord_id    TEXT PRIMARY KEY,
      username      TEXT,
      cf_handle     TEXT,
      lc_handle     TEXT,
      ac_handle     TEXT,
      toph_handle   TEXT,
      github_handle TEXT,
      joined_at     INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS ratings (
      discord_id   TEXT NOT NULL,
      platform     TEXT NOT NULL,
      rating       INTEGER DEFAULT 0,
      max_rating   INTEGER DEFAULT 0,
      rank_title   TEXT DEFAULT 'Unrated',
      solved       INTEGER DEFAULT 0,
      acceptance   REAL DEFAULT 0,
      updated_at   INTEGER DEFAULT (strftime('%s','now')),
      PRIMARY KEY (discord_id, platform)
    );

    CREATE TABLE IF NOT EXISTS cf_contest_cache (
      contest_id   TEXT PRIMARY KEY,
      name         TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notified_contests (
      contest_id     TEXT PRIMARY KEY,
      platform       TEXT NOT NULL,
      name           TEXT,
      start_time     INTEGER,
      duration_sec   INTEGER,
      url            TEXT,
      notified_24h   INTEGER DEFAULT 0,
      notified_1h    INTEGER DEFAULT 0,
      discord_msg_id TEXT,
      time_na        INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS guild_config (
      guild_id TEXT NOT NULL DEFAULT 'global',
      key      TEXT NOT NULL,
      value    TEXT,
      PRIMARY KEY (guild_id, key)
    );

    CREATE TABLE IF NOT EXISTS rating_history (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_id   TEXT NOT NULL,
      platform     TEXT NOT NULL,
      rating       INTEGER NOT NULL,
      recorded_at  INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS streaks (
      discord_id       TEXT NOT NULL,
      platform         TEXT NOT NULL,
      current_streak   INTEGER DEFAULT 0,
      max_streak       INTEGER DEFAULT 0,
      last_active_date TEXT,
      PRIMARY KEY (discord_id, platform)
    );

    CREATE TABLE IF NOT EXISTS vs_matches (
      id             TEXT PRIMARY KEY,
      channel_id     TEXT NOT NULL,
      guild_id       TEXT NOT NULL,
      creator_id     TEXT NOT NULL,
      rating         INTEGER NOT NULL,
      tag            TEXT,
      division       TEXT,
      duration_min   INTEGER NOT NULL,
      problems_count INTEGER NOT NULL,
      problems       TEXT,
      mode           TEXT DEFAULT 'grid',
      locks          TEXT DEFAULT '{}',
      status         TEXT NOT NULL DEFAULT 'lobby',
      started_at     INTEGER,
      ends_at        INTEGER
    );

    CREATE TABLE IF NOT EXISTS vs_participants (
      match_id       TEXT NOT NULL,
      discord_id     TEXT NOT NULL,
      cf_handle      TEXT NOT NULL,
      score          INTEGER DEFAULT 0,
      solves         TEXT DEFAULT '{}',
      wrong_attempts TEXT DEFAULT '{}',
      PRIMARY KEY (match_id, discord_id)
    );

    CREATE TABLE IF NOT EXISTS virtual_contests (
      id           TEXT PRIMARY KEY,
      channel_id   TEXT NOT NULL,
      guild_id     TEXT NOT NULL,
      started_by   TEXT NOT NULL,
      difficulty   TEXT NOT NULL,
      duration_sec INTEGER NOT NULL,
      started_at   INTEGER NOT NULL,
      ends_at      INTEGER NOT NULL,
      ended        INTEGER DEFAULT 0,
      problems     TEXT,
      type         TEXT DEFAULT 'individual'
    );

    CREATE TABLE IF NOT EXISTS vc_participants (
      vc_id       TEXT NOT NULL,
      discord_id  TEXT NOT NULL,
      cf_handle   TEXT,
      solved      INTEGER DEFAULT 0,
      finish_time INTEGER,
      team        TEXT DEFAULT NULL,
      PRIMARY KEY (vc_id, discord_id)
    );

    CREATE TABLE IF NOT EXISTS daily_problems (
      date_str        TEXT PRIMARY KEY,
      p1_id           TEXT,
      p2_id           TEXT,
      p3_id           TEXT,
      p4_id           TEXT,
      p5_id           TEXT,
      first_blood_1   TEXT,
      first_blood_2   TEXT,
      first_blood_3   TEXT,
      first_blood_4   TEXT,
      first_blood_5   TEXT,
      sweep_announced TEXT DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS last_submissions (
      discord_id TEXT NOT NULL,
      platform   TEXT NOT NULL,
      last_id    INTEGER,
      PRIMARY KEY (discord_id, platform)
    );

    CREATE TABLE IF NOT EXISTS weekly_snapshots (
      discord_id    TEXT NOT NULL,
      platform      TEXT NOT NULL,
      rating        INTEGER DEFAULT 0,
      solved        INTEGER DEFAULT 0,
      snapshot_date TEXT,
      PRIMARY KEY (discord_id, platform)
    );

    CREATE TABLE IF NOT EXISTS processed_submissions (
      id        TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contest_wrapups (
      contest_id TEXT NOT NULL,
      guild_id   TEXT NOT NULL,
      posted_at  INTEGER DEFAULT (strftime('%s','now')),
      PRIMARY KEY (contest_id, guild_id)
    );

    CREATE TABLE IF NOT EXISTS processed_github_commits (
      sha        TEXT PRIMARY KEY,
      repo       TEXT NOT NULL,
      author     TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );
  `);
}

function addColumnIfMissing(instance, table, colDef) {
  const colName = colDef.trim().split(/\s+/)[0];
  const cols = instance.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === colName)) {
    instance.exec(`ALTER TABLE ${table} ADD COLUMN ${colDef};`);
  }
}

function runMigrations(instance) {
  ensureSchema(instance);

  addColumnIfMissing(instance, 'users', 'toph_handle TEXT');
  addColumnIfMissing(instance, 'users', 'github_handle TEXT');
  addColumnIfMissing(instance, 'notified_contests', 'discord_msg_id TEXT');
  addColumnIfMissing(instance, 'notified_contests', 'time_na INTEGER DEFAULT 0');
  addColumnIfMissing(instance, 'virtual_contests', "type TEXT DEFAULT 'individual'");
  addColumnIfMissing(instance, 'vc_participants', 'team TEXT DEFAULT NULL');
  addColumnIfMissing(instance, 'daily_problems', "sweep_announced TEXT DEFAULT '[]'");
  ['p4_id TEXT', 'p5_id TEXT', 'first_blood_4 TEXT', 'first_blood_5 TEXT'].forEach(col =>
    addColumnIfMissing(instance, 'daily_problems', col)
  );
  addColumnIfMissing(instance, 'vs_matches', 'division TEXT');
  addColumnIfMissing(instance, 'vs_matches', "mode TEXT DEFAULT 'grid'");
  addColumnIfMissing(instance, 'vs_matches', "locks TEXT DEFAULT '{}'");

  // Upgrade legacy single-guild guild_config schema if needed
  try {
    const tableInfo = instance.prepare('PRAGMA table_info(guild_config)').all();
    const hasGuildId = tableInfo.some(col => col.name === 'guild_id');
    if (tableInfo.length > 0 && !hasGuildId) {
      instance.exec(`
        CREATE TABLE guild_config_new (
          guild_id TEXT NOT NULL DEFAULT 'global',
          key      TEXT NOT NULL,
          value    TEXT,
          PRIMARY KEY (guild_id, key)
        );
        INSERT OR IGNORE INTO guild_config_new (guild_id, key, value)
        SELECT 'global', key, value FROM guild_config;
        DROP TABLE guild_config;
        ALTER TABLE guild_config_new RENAME TO guild_config;
      `);
      console.log('[Migration] Upgraded guild_config to multi-guild schema.');
    }
  } catch (e) {
    console.error('[Migration] guild_config check error:', e.message);
  }
}

function initDb() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  try {
    dbInstance = new Database(DB_PATH);
    dbInstance.pragma('journal_mode = WAL');
    runMigrations(dbInstance);
  } catch (err) {
    if (err.message && err.message.toLowerCase().includes('malformed')) {
      const stamp = Date.now();
      console.warn(`[Database] Database is malformed! Preserving corrupt copy as .corrupt-${stamp} and recreating...`);
      for (const suffix of ['', '-wal', '-shm']) {
        const src = DB_PATH + suffix;
        if (fs.existsSync(src)) {
          fs.renameSync(src, `${src}.corrupt-${stamp}`);
        }
      }
      dbInstance = new Database(DB_PATH);
      dbInstance.pragma('journal_mode = WAL');
      runMigrations(dbInstance);
    } else {
      throw err;
    }
  }
}

initDb();

const db = new Proxy({}, {
  get(target, prop) {
    const val = dbInstance[prop];
    return typeof val === 'function' ? val.bind(dbInstance) : val;
  }
});

function checkpointWal() {
  if (dbInstance) {
    dbInstance.pragma('wal_checkpoint(TRUNCATE)');
  }
}

async function createBackupCopy(destPath) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  await dbInstance.backup(destPath);
}

/**
 * Validates an uploaded/fetched SQLite buffer, backs up current DB, swaps safely, and re-runs migrations.
 */
function reloadDatabase(dataBuffer) {
  if (!Buffer.isBuffer(dataBuffer) || dataBuffer.length < 100) {
    throw new Error('Invalid or empty database file buffer.');
  }

  const header = dataBuffer.subarray(0, 16).toString('utf8');
  if (!header.startsWith('SQLite format 3\0')) {
    throw new Error('File is not a valid SQLite 3 database.');
  }

  const tmpPath = `${DB_PATH}.restore-${Date.now()}`;
  try {
    fs.writeFileSync(tmpPath, dataBuffer);
    const probe = new Database(tmpPath, { fileMustExist: true });
    try {
      const integrity = probe.pragma('quick_check', { simple: true });
      if (integrity !== 'ok') {
        throw new Error(`SQLite integrity check failed: ${integrity}`);
      }
      const requiredTables = probe.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users', 'guild_config')"
      ).all();
      if (requiredTables.length < 2) {
        throw new Error('Uploaded file does not match BigOof database schema (missing users or guild_config).');
      }
    } finally {
      probe.close();
    }

    if (fs.existsSync(DB_PATH)) {
      try {
        checkpointWal();
        fs.copyFileSync(DB_PATH, `${DB_PATH}.pre-restore.bak`);
      } catch (_) {}
    }

    try {
      dbInstance.close();
    } catch (_) {}

    if (fs.existsSync(DB_PATH + '-wal')) fs.unlinkSync(DB_PATH + '-wal');
    if (fs.existsSync(DB_PATH + '-shm')) fs.unlinkSync(DB_PATH + '-shm');

    fs.renameSync(tmpPath, DB_PATH);
    initDb();
    console.log('[Database] Successfully reloaded & migrated database in memory.');
  } catch (err) {
    if (fs.existsSync(tmpPath)) {
      try { fs.unlinkSync(tmpPath); } catch (_) {}
    }
    if (!dbInstance || !dbInstance.open) {
      initDb();
    }
    throw err;
  }
}

// ─── Allowlists for dynamic column names ──────────────────────
const ALLOWED_PLATFORMS = new Set(['cf', 'ac', 'toph', 'github', 'lc']);
const ALLOWED_CONTEST_NOTIFY_FIELDS = new Set(['notified_24h', 'notified_1h']);
const ALLOWED_FIRST_BLOOD_FIELDS = new Set([
  'first_blood_1', 'first_blood_2', 'first_blood_3', 'first_blood_4', 'first_blood_5'
]);

function assertAllowed(set, val, label) {
  if (!set.has(val)) {
    throw new Error(`Invalid ${label}: ${val}`);
  }
}

// ─── User Helpers ────────────────────────────────────────────
function getUser(discordId) {
  return db.prepare('SELECT * FROM users WHERE discord_id = ?').get(discordId);
}

function upsertUser(discordId, username) {
  db.prepare(`
    INSERT INTO users (discord_id, username) VALUES (?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET username = excluded.username
  `).run(discordId, username);
}

function linkPlatform(discordId, platform, handle) {
  assertAllowed(ALLOWED_PLATFORMS, platform, 'platform');
  const col = `${platform}_handle`;
  db.prepare(`UPDATE users SET ${col} = ? WHERE discord_id = ?`).run(handle, discordId);
}

const unlinkPlatform = db.transaction((discordId, platform) => {
  assertAllowed(ALLOWED_PLATFORMS, platform, 'platform');
  const col = `${platform}_handle`;
  db.prepare(`UPDATE users SET ${col} = NULL WHERE discord_id = ?`).run(discordId);
  db.prepare('DELETE FROM ratings WHERE discord_id = ? AND platform = ?').run(discordId, platform);
  db.prepare('DELETE FROM last_submissions WHERE discord_id = ? AND platform = ?').run(discordId, platform);
  db.prepare('DELETE FROM streaks WHERE discord_id = ? AND platform = ?').run(discordId, platform);
  db.prepare('DELETE FROM weekly_snapshots WHERE discord_id = ? AND platform = ?').run(discordId, platform);
  db.prepare('DELETE FROM rating_history WHERE discord_id = ? AND platform = ?').run(discordId, platform);
  db.prepare('DELETE FROM processed_submissions WHERE id LIKE ?').run(`${platform}_prob_${discordId}_%`);
});

const purgeUser = db.transaction((discordId) => {
  const user = getUser(discordId);
  if (!user) return false;

  db.prepare(`
    DELETE FROM vs_participants
    WHERE match_id IN (SELECT id FROM vs_matches WHERE creator_id = ? AND status = 'lobby')
  `).run(discordId);
  db.prepare("DELETE FROM vs_matches WHERE creator_id = ? AND status = 'lobby'").run(discordId);
  db.prepare('DELETE FROM vs_participants WHERE discord_id = ?').run(discordId);
  db.prepare('DELETE FROM vc_participants WHERE discord_id = ?').run(discordId);
  db.prepare('DELETE FROM virtual_contests WHERE started_by = ? AND ended = 0').run(discordId);
  db.prepare('DELETE FROM processed_submissions WHERE id LIKE ?').run(`%_prob_${discordId}_%`);
  db.prepare('DELETE FROM ratings WHERE discord_id = ?').run(discordId);
  db.prepare('DELETE FROM last_submissions WHERE discord_id = ?').run(discordId);
  db.prepare('DELETE FROM streaks WHERE discord_id = ?').run(discordId);
  db.prepare('DELETE FROM weekly_snapshots WHERE discord_id = ?').run(discordId);
  db.prepare('DELETE FROM rating_history WHERE discord_id = ?').run(discordId);
  db.prepare('DELETE FROM users WHERE discord_id = ?').run(discordId);

  return true;
});

function getAllUsers() {
  return db.prepare('SELECT * FROM users').all();
}

// ─── Rating Helpers ──────────────────────────────────────────
function upsertRating(discordId, platform, data) {
  db.prepare(`
    INSERT INTO ratings (discord_id, platform, rating, max_rating, rank_title, solved, acceptance, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%s','now'))
    ON CONFLICT(discord_id, platform) DO UPDATE SET
      rating     = excluded.rating,
      max_rating = MAX(ratings.max_rating, excluded.max_rating),
      rank_title = excluded.rank_title,
      solved     = MAX(ratings.solved, excluded.solved),
      acceptance = excluded.acceptance,
      updated_at = excluded.updated_at
  `).run(
    discordId,
    platform,
    data.rating ?? 0,
    data.max_rating ?? 0,
    data.rank_title ?? 'Unrated',
    data.solved ?? 0,
    data.acceptance ?? 0
  );
}

function getRatings(discordId) {
  return db.prepare('SELECT * FROM ratings WHERE discord_id = ?').all(discordId);
}

function getAllRatings() {
  return db.prepare('SELECT * FROM ratings').all();
}

// ─── Contest Helpers ──────────────────────────────────────────
function contestExists(contestId) {
  return Boolean(db.prepare('SELECT 1 FROM notified_contests WHERE contest_id = ?').get(contestId));
}

function upsertContest(contestId, platform, name, startTime, durationSec, url) {
  const existing = db.prepare('SELECT start_time FROM notified_contests WHERE contest_id = ?').get(contestId);

  if (existing) {
    let query = 'UPDATE notified_contests SET name = ?, start_time = ?, duration_sec = ?, url = ?';
    const params = [name, startTime, durationSec, url];
    if (existing.start_time !== startTime) {
      query += ', notified_24h = 0, notified_1h = 0';
    }
    query += ' WHERE contest_id = ?';
    params.push(contestId);
    db.prepare(query).run(...params);
  } else {
    db.prepare(`
      INSERT INTO notified_contests (contest_id, platform, name, start_time, duration_sec, url)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(contestId, platform, name, startTime, durationSec, url);
  }
}

function getUpcomingContests(maxSeconds = 7 * 24 * 3600) {
  const now = Math.floor(Date.now() / 1000);
  return db.prepare(`
    SELECT * FROM notified_contests
    WHERE ((start_time + COALESCE(duration_sec, 0)) > ? AND start_time < ?)
       OR (platform = 'Custom' AND start_time IS NULL)
    ORDER BY COALESCE(start_time, 9999999999) ASC
  `).all(now, now + maxSeconds);
}

function getContestsNeedingReminders() {
  const now = Math.floor(Date.now() / 1000);
  return db.prepare(`
    SELECT * FROM notified_contests
    WHERE start_time IS NOT NULL
      AND start_time > ?
      AND start_time <= ?
      AND (notified_24h = 0 OR notified_1h = 0)
    ORDER BY start_time ASC
  `).all(now, now + 24 * 3600);
}

function markContestNotified(contestId, field) {
  assertAllowed(ALLOWED_CONTEST_NOTIFY_FIELDS, field, 'notification field');
  db.prepare(`UPDATE notified_contests SET ${field} = 1 WHERE contest_id = ?`).run(contestId);
}

// ─── Rating History Helpers ──────────────────────────────────
function insertRatingHistory(discordId, platform, rating) {
  const last = db.prepare(`
    SELECT rating FROM rating_history
    WHERE discord_id = ? AND platform = ?
    ORDER BY recorded_at DESC, id DESC LIMIT 1
  `).get(discordId, platform);
  if (!last || last.rating !== rating) {
    db.prepare('INSERT INTO rating_history (discord_id, platform, rating) VALUES (?, ?, ?)').run(discordId, platform, rating);
  }
}

function getRatingHistory(discordId, platform, limit = 30) {
  return db.prepare(`
    SELECT rating, recorded_at FROM (
      SELECT id, rating, recorded_at FROM rating_history
      WHERE discord_id = ? AND platform = ?
      ORDER BY recorded_at DESC, id DESC
      LIMIT ?
    )
    ORDER BY recorded_at ASC, id ASC
  `).all(discordId, platform, limit);
}

// ─── Streak Helpers ──────────────────────────────────────────
function upsertStreak(discordId, platform, currentStreak, maxStreak, lastActiveDate) {
  db.prepare(`
    INSERT INTO streaks (discord_id, platform, current_streak, max_streak, last_active_date)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(discord_id, platform) DO UPDATE SET
      current_streak   = excluded.current_streak,
      max_streak       = MAX(streaks.max_streak, excluded.max_streak),
      last_active_date = excluded.last_active_date
  `).run(discordId, platform, currentStreak, maxStreak, lastActiveDate);
}

function getStreak(discordId, platform) {
  return db.prepare('SELECT * FROM streaks WHERE discord_id = ? AND platform = ?').get(discordId, platform);
}

function getAllStreaks() {
  return db.prepare('SELECT * FROM streaks').all();
}

// ─── Virtual Contest Helpers ──────────────────────────────────
function parseVC(row) {
  if (!row) return row;
  if (typeof row.problems === 'string') {
    try { row.problems = JSON.parse(row.problems); } catch { row.problems = []; }
  }
  return row;
}

function createVC(id, channelId, guildId, startedBy, difficulty, durationSec, problems, type = 'individual') {
  const now = Math.floor(Date.now() / 1000);
  const endsAt = now + durationSec;
  db.prepare(`
    INSERT INTO virtual_contests (id, channel_id, guild_id, started_by, difficulty, duration_sec, started_at, ends_at, problems, type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, channelId, guildId, startedBy, difficulty, durationSec, now, endsAt, JSON.stringify(problems), type);
}

function getVC(id) {
  return parseVC(db.prepare('SELECT * FROM virtual_contests WHERE id = ?').get(id));
}

function getActiveVCs() {
  const now = Math.floor(Date.now() / 1000);
  return db.prepare('SELECT * FROM virtual_contests WHERE ended = 0 AND ends_at <= ?').all(now).map(parseVC);
}

function getAllActiveVCs() {
  return db.prepare('SELECT * FROM virtual_contests WHERE ended = 0').all().map(parseVC);
}

function endVC(id) {
  db.prepare('UPDATE virtual_contests SET ended = 1 WHERE id = ?').run(id);
}

function markVCEndedIfActive(id) {
  const info = db.prepare('UPDATE virtual_contests SET ended = 1 WHERE id = ? AND ended = 0').run(id);
  return info.changes > 0;
}

function joinVC(vcId, discordId, cfHandle, team = null) {
  db.prepare(`
    INSERT OR REPLACE INTO vc_participants (vc_id, discord_id, cf_handle, team) VALUES (?, ?, ?, ?)
  `).run(vcId, discordId, cfHandle, team);
}

function getVCParticipants(vcId) {
  return db.prepare('SELECT * FROM vc_participants WHERE vc_id = ?').all(vcId);
}

function updateVCSolved(vcId, discordId, solved) {
  const now = Math.floor(Date.now() / 1000);
  db.prepare('UPDATE vc_participants SET solved = ?, finish_time = ? WHERE vc_id = ? AND discord_id = ?')
    .run(solved, now, vcId, discordId);
}

function getActiveVCForChannel(channelId) {
  const now = Math.floor(Date.now() / 1000);
  const row = db.prepare(`
    SELECT * FROM virtual_contests
    WHERE channel_id = ? AND ended = 0 AND ends_at > ?
    ORDER BY started_at DESC LIMIT 1
  `).get(channelId, now);
  return parseVC(row);
}

// ─── Daily Problems Helpers ──────────────────────────────────
function setDailyProblems(dateStr, p1Id, p2Id, p3Id, p4Id, p5Id) {
  db.prepare(`
    INSERT INTO daily_problems (date_str, p1_id, p2_id, p3_id, p4_id, p5_id)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(date_str) DO UPDATE SET
      p1_id = excluded.p1_id, p2_id = excluded.p2_id, p3_id = excluded.p3_id,
      p4_id = excluded.p4_id, p5_id = excluded.p5_id
  `).run(dateStr, p1Id, p2Id, p3Id, p4Id, p5Id);
}

function getDailyProblems(dateStr) {
  return db.prepare('SELECT * FROM daily_problems WHERE date_str = ?').get(dateStr);
}

function setFirstBlood(dateStr, field, discordId) {
  assertAllowed(ALLOWED_FIRST_BLOOD_FIELDS, field, 'first_blood field');
  db.prepare(`UPDATE daily_problems SET ${field} = ? WHERE date_str = ?`).run(discordId, dateStr);
}

function tryClaimFirstBlood(dateStr, field, discordId) {
  assertAllowed(ALLOWED_FIRST_BLOOD_FIELDS, field, 'first_blood field');
  const info = db.prepare(
    `UPDATE daily_problems SET ${field} = ? WHERE date_str = ? AND ${field} IS NULL`
  ).run(discordId, dateStr);
  return info.changes > 0;
}

function setSweepAnnounced(dateStr, sweepAnnouncedJson) {
  db.prepare('UPDATE daily_problems SET sweep_announced = ? WHERE date_str = ?').run(sweepAnnouncedJson, dateStr);
}

const tryMarkSweepAnnounced = db.transaction((dateStr, discordId) => {
  const row = db.prepare('SELECT sweep_announced FROM daily_problems WHERE date_str = ?').get(dateStr);
  if (!row) return false;
  let list = [];
  try { list = JSON.parse(row.sweep_announced || '[]'); } catch { list = []; }
  if (list.includes(discordId)) return false;
  list.push(discordId);
  db.prepare('UPDATE daily_problems SET sweep_announced = ? WHERE date_str = ?').run(JSON.stringify(list), dateStr);
  return true;
});

// ─── Config Helpers ───────────────────────────────────────────
function getConfig(key, guildId = 'global') {
  if (guildId && guildId !== 'global') {
    const row = db.prepare('SELECT value FROM guild_config WHERE guild_id = ? AND key = ?').get(String(guildId), key);
    if (row && row.value !== null) return row.value;
  }
  const globalRow = db.prepare('SELECT value FROM guild_config WHERE guild_id = ? AND key = ?').get('global', key);
  return globalRow ? globalRow.value : null;
}

function setConfig(key, value, guildId = 'global') {
  const gid = guildId ? String(guildId) : 'global';
  db.prepare(`
    INSERT INTO guild_config (guild_id, key, value) VALUES (?, ?, ?)
    ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value
  `).run(gid, key, value !== null && value !== undefined ? String(value) : null);
}

function deleteConfig(key, guildId = 'global') {
  const gid = guildId ? String(guildId) : 'global';
  db.prepare('DELETE FROM guild_config WHERE guild_id = ? AND key = ?').run(gid, key);
}

function getAllGuildConfigs(key) {
  return db.prepare(
    "SELECT guild_id, value FROM guild_config WHERE key = ? AND guild_id != 'global' AND value IS NOT NULL"
  ).all(key);
}

function getFullGuildConfig(guildId) {
  const gid = guildId ? String(guildId) : 'global';
  const rows = db.prepare('SELECT key, value FROM guild_config WHERE guild_id = ?').all(gid);
  const result = {};
  for (const r of rows) result[r.key] = r.value;
  return result;
}

// ─── Live Submissions Helpers ─────────────────────────────────
function getLastSubmission(discordId, platform) {
  const row = db.prepare('SELECT last_id FROM last_submissions WHERE discord_id = ? AND platform = ?').get(discordId, platform);
  return row ? row.last_id : null;
}

function setLastSubmission(discordId, platform, lastId) {
  db.prepare(`
    INSERT INTO last_submissions (discord_id, platform, last_id) VALUES (?, ?, ?)
    ON CONFLICT(discord_id, platform) DO UPDATE SET last_id = excluded.last_id
  `).run(discordId, platform, lastId);
}

// ─── Weekly Wrap-Up Helpers ───────────────────────────────────
function getWeeklySnapshot(discordId, platform) {
  return db.prepare('SELECT * FROM weekly_snapshots WHERE discord_id = ? AND platform = ?').get(discordId, platform);
}

function setWeeklySnapshot(discordId, platform, rating, solved, dateStr) {
  db.prepare(`
    INSERT INTO weekly_snapshots (discord_id, platform, rating, solved, snapshot_date)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(discord_id, platform) DO UPDATE SET
      rating = excluded.rating,
      solved = excluded.solved,
      snapshot_date = excluded.snapshot_date
  `).run(discordId, platform, rating, solved, dateStr);
}

function getAllWeeklySnapshots() {
  return db.prepare('SELECT * FROM weekly_snapshots').all();
}

function getCachedContestName(contestId) {
  const row = db.prepare('SELECT name FROM cf_contest_cache WHERE contest_id = ?').get(String(contestId));
  return row ? row.name : null;
}

function cacheContestName(contestId, name) {
  db.prepare('INSERT OR REPLACE INTO cf_contest_cache (contest_id, name) VALUES (?, ?)').run(String(contestId), name);
}

// ─── Contest Wrap-up Helpers ──────────────────────────────────
function isContestWrappedUp(contestId, guildId = 'global') {
  const gid = guildId ? String(guildId) : 'global';
  const row = db.prepare('SELECT 1 FROM contest_wrapups WHERE contest_id = ? AND guild_id = ?').get(String(contestId), gid);
  return Boolean(row);
}

function markContestWrappedUp(contestId, guildId = 'global') {
  const gid = guildId ? String(guildId) : 'global';
  db.prepare(`
    INSERT OR REPLACE INTO contest_wrapups (contest_id, guild_id, posted_at)
    VALUES (?, ?, strftime('%s','now'))
  `).run(String(contestId), gid);
}

// ─── Versus Match Helpers ─────────────────────────────────────
function parseVSMatch(row) {
  if (!row) return row;
  if (typeof row.problems === 'string') {
    try { row.problems = JSON.parse(row.problems); } catch { row.problems = []; }
  }
  if (typeof row.locks === 'string') {
    try { row.locks = JSON.parse(row.locks); } catch { row.locks = {}; }
  } else if (!row.locks) {
    row.locks = {};
  }
  return row;
}

function createVSMatch(id, channelId, guildId, creatorId, rating, tag, division, durationMin, problemsCount, mode = 'grid') {
  db.prepare(`
    INSERT INTO vs_matches (id, channel_id, guild_id, creator_id, rating, tag, division, duration_min, problems_count, mode, locks, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', 'lobby')
  `).run(id, channelId, guildId, creatorId, rating, tag, division, durationMin, problemsCount, mode);
}

function getVSMatch(id) {
  return parseVSMatch(db.prepare('SELECT * FROM vs_matches WHERE id = ?').get(id));
}

function updateVSMatchStatus(id, status, startedAt = null, endsAt = null) {
  db.prepare('UPDATE vs_matches SET status = ?, started_at = ?, ends_at = ? WHERE id = ?')
    .run(status, startedAt, endsAt, id);
}

function claimVSMatchStart(id, problems, startedAt, endsAt) {
  const info = db.prepare(`
    UPDATE vs_matches
    SET status = 'active', problems = ?, started_at = ?, ends_at = ?
    WHERE id = ? AND status = 'lobby'
  `).run(JSON.stringify(problems), startedAt, endsAt, id);
  return info.changes > 0;
}

function concludeVSMatchIfActive(id, startedAt = null, endsAt = null) {
  const info = db.prepare(`
    UPDATE vs_matches
    SET status = 'concluded',
        started_at = COALESCE(?, started_at),
        ends_at = COALESCE(?, ends_at)
    WHERE id = ? AND status = 'active'
  `).run(startedAt, endsAt, id);
  return info.changes > 0;
}

function updateVSMatchProblems(id, problems) {
  db.prepare('UPDATE vs_matches SET problems = ? WHERE id = ?').run(JSON.stringify(problems), id);
}

function updateVSMatchLocks(id, locks) {
  db.prepare('UPDATE vs_matches SET locks = ? WHERE id = ?').run(JSON.stringify(locks), id);
}

function joinVSMatch(matchId, discordId, cfHandle) {
  db.prepare('INSERT OR IGNORE INTO vs_participants (match_id, discord_id, cf_handle) VALUES (?, ?, ?)')
    .run(matchId, discordId, cfHandle);
}

function getVSParticipants(matchId) {
  const rows = db.prepare('SELECT * FROM vs_participants WHERE match_id = ?').all(matchId);
  return rows.map(r => {
    try { r.solves = JSON.parse(r.solves || '{}'); } catch { r.solves = {}; }
    try { r.wrong_attempts = JSON.parse(r.wrong_attempts || '{}'); } catch { r.wrong_attempts = {}; }
    return r;
  });
}

function updateVSParticipantScore(matchId, discordId, score, solvesJson, wrongAttemptsJson) {
  db.prepare(`
    UPDATE vs_participants SET score = ?, solves = ?, wrong_attempts = ?
    WHERE match_id = ? AND discord_id = ?
  `).run(score, solvesJson, wrongAttemptsJson, matchId, discordId);
}

function getActiveVSMatches() {
  return db.prepare("SELECT * FROM vs_matches WHERE status = 'active'").all().map(parseVSMatch);
}

const removeVSMatch = db.transaction((id) => {
  db.prepare('DELETE FROM vs_participants WHERE match_id = ?').run(id);
  db.prepare('DELETE FROM vs_matches WHERE id = ?').run(id);
});

function getHeadToHeadVersus(discordId1, discordId2) {
  try {
    const rows = db.prepare(`
      SELECT p1.score AS score1, p2.score AS score2
      FROM vs_participants p1
      JOIN vs_participants p2 ON p1.match_id = p2.match_id
      JOIN vs_matches m ON m.id = p1.match_id
      WHERE p1.discord_id = ? AND p2.discord_id = ? AND m.status = 'concluded'
    `).all(discordId1, discordId2);

    let wins1 = 0;
    let wins2 = 0;
    let ties = 0;
    for (const r of rows) {
      if (r.score1 > r.score2) wins1++;
      else if (r.score2 > r.score1) wins2++;
      else ties++;
    }
    return { total: rows.length, wins1, wins2, ties };
  } catch (err) {
    console.error('[DB] getHeadToHeadVersus error:', err.message);
    return { total: 0, wins1: 0, wins2: 0, ties: 0 };
  }
}

module.exports = {
  DB_PATH,
  db,
  checkpointWal,
  createBackupCopy,
  reloadDatabase,
  getUser,
  upsertUser,
  linkPlatform,
  unlinkPlatform,
  purgeUser,
  getAllUsers,
  upsertRating,
  getRatings,
  getAllRatings,
  contestExists,
  upsertContest,
  getUpcomingContests,
  getContestsNeedingReminders,
  markContestNotified,
  getConfig,
  setConfig,
  deleteConfig,
  getAllGuildConfigs,
  getFullGuildConfig,
  insertRatingHistory,
  getRatingHistory,
  upsertStreak,
  getStreak,
  getAllStreaks,
  createVC,
  getVC,
  getActiveVCs,
  getAllActiveVCs,
  endVC,
  markVCEndedIfActive,
  joinVC,
  getVCParticipants,
  updateVCSolved,
  getActiveVCForChannel,
  setDailyProblems,
  getDailyProblems,
  setFirstBlood,
  tryClaimFirstBlood,
  setSweepAnnounced,
  tryMarkSweepAnnounced,
  getLastSubmission,
  setLastSubmission,
  getWeeklySnapshot,
  setWeeklySnapshot,
  getAllWeeklySnapshots,
  getCachedContestName,
  cacheContestName,
  isContestWrappedUp,
  markContestWrappedUp,
  createVSMatch,
  getVSMatch,
  updateVSMatchStatus,
  claimVSMatchStart,
  concludeVSMatchIfActive,
  updateVSMatchProblems,
  updateVSMatchLocks,
  joinVSMatch,
  getVSParticipants,
  updateVSParticipantScore,
  getActiveVSMatches,
  removeVSMatch,
  getHeadToHeadVersus
};
