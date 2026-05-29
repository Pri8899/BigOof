// database/db.js — SQLite setup and helper functions
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

let defaultDbPath = path.join(__dirname, '..', 'cpbot.db');

// If deployed on Railway and the /data volume exists, use it automatically!
if (process.env.RAILWAY_ENVIRONMENT && fs.existsSync('/data')) {
  defaultDbPath = '/data/cpbot.db';
}

const DB_PATH = process.env.DATABASE_PATH || defaultDbPath;
const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// ─── Create Tables ───────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    discord_id   TEXT PRIMARY KEY,
    username     TEXT,
    cf_handle    TEXT,
    lc_handle    TEXT,
    ac_handle    TEXT,
    joined_at    INTEGER DEFAULT (strftime('%s','now'))
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
    contest_id    TEXT PRIMARY KEY,
    platform      TEXT NOT NULL,
    name          TEXT,
    start_time    INTEGER,
    duration_sec  INTEGER,
    url           TEXT,
    notified_24h  INTEGER DEFAULT 0,
    notified_1h   INTEGER DEFAULT 0,
    discord_msg_id TEXT
  );

  CREATE TABLE IF NOT EXISTS guild_config (
    key   TEXT PRIMARY KEY,
    value TEXT
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
    problems     TEXT
  );

  CREATE TABLE IF NOT EXISTS vc_participants (
    vc_id       TEXT NOT NULL,
    discord_id  TEXT NOT NULL,
    cf_handle   TEXT,
    solved      INTEGER DEFAULT 0,
    finish_time INTEGER,
    PRIMARY KEY (vc_id, discord_id)
  );

  CREATE TABLE IF NOT EXISTS daily_problems (
    date_str TEXT PRIMARY KEY,
    p1_id TEXT,
    p2_id TEXT,
    p3_id TEXT,
    first_blood_1 TEXT,
    first_blood_2 TEXT,
    first_blood_3 TEXT,
    sweep_announced TEXT DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS last_submissions (
    discord_id TEXT NOT NULL,
    platform   TEXT NOT NULL,
    last_id    INTEGER,
    PRIMARY KEY (discord_id, platform)
  );

  CREATE TABLE IF NOT EXISTS weekly_snapshots (
    discord_id TEXT NOT NULL,
    platform   TEXT NOT NULL,
    rating     INTEGER DEFAULT 0,
    solved     INTEGER DEFAULT 0,
    snapshot_date TEXT,
    PRIMARY KEY (discord_id, platform)
  );
`);

// Run migration to add sweep_announced column to daily_problems if it doesn't exist
try {
  db.exec("ALTER TABLE daily_problems ADD COLUMN sweep_announced TEXT DEFAULT '[]';");
} catch (e) {
  // Column already exists
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
  const col = `${platform}_handle`;
  db.prepare(`UPDATE users SET ${col} = ? WHERE discord_id = ?`).run(handle, discordId);
}

function unlinkPlatform(discordId, platform) {
  const col = `${platform}_handle`;
  db.prepare(`UPDATE users SET ${col} = NULL WHERE discord_id = ?`).run(discordId);
  db.prepare(`DELETE FROM ratings WHERE discord_id = ? AND platform = ?`).run(discordId, platform);
}

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
      max_rating = excluded.max_rating,
      rank_title = excluded.rank_title,
      solved     = excluded.solved,
      acceptance = excluded.acceptance,
      updated_at = excluded.updated_at
  `).run(discordId, platform, data.rating ?? 0, data.max_rating ?? 0, data.rank_title ?? 'Unrated', data.solved ?? 0, data.acceptance ?? 0);
}

function getRatings(discordId) {
  return db.prepare('SELECT * FROM ratings WHERE discord_id = ?').all(discordId);
}

function getAllRatings() {
  return db.prepare('SELECT * FROM ratings').all();
}

// ─── Contest Helpers ──────────────────────────────────────────
function contestExists(contestId) {
  return !!db.prepare('SELECT 1 FROM notified_contests WHERE contest_id = ?').get(contestId);
}

function upsertContest(contestId, platform, name, startTime, durationSec, url) {
  db.prepare(`
    INSERT INTO notified_contests (contest_id, platform, name, start_time, duration_sec, url)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(contest_id) DO NOTHING
  `).run(contestId, platform, name, startTime, durationSec, url);
}

function getUpcomingContests(maxSeconds = 7 * 24 * 3600) {
  const now = Math.floor(Date.now() / 1000);
  return db.prepare(`
    SELECT * FROM notified_contests
    WHERE (start_time + duration_sec) > ? AND start_time < ?
    ORDER BY start_time ASC
  `).all(now, now + maxSeconds);
}

function markContestNotified(contestId, field) {
  db.prepare(`UPDATE notified_contests SET ${field} = 1 WHERE contest_id = ?`).run(contestId);
}

// ─── Rating History Helpers ──────────────────────────────────
function insertRatingHistory(discordId, platform, rating) {
  // Only insert if rating actually changed from last recorded
  const last = db.prepare(`
    SELECT rating FROM rating_history
    WHERE discord_id = ? AND platform = ?
    ORDER BY recorded_at DESC LIMIT 1
  `).get(discordId, platform);
  if (!last || last.rating !== rating) {
    db.prepare(`
      INSERT INTO rating_history (discord_id, platform, rating) VALUES (?, ?, ?)
    `).run(discordId, platform, rating);
  }
}

function getRatingHistory(discordId, platform, limit = 30) {
  return db.prepare(`
    SELECT rating, recorded_at FROM rating_history
    WHERE discord_id = ? AND platform = ?
    ORDER BY recorded_at ASC
    LIMIT ?
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
function createVC(id, channelId, guildId, startedBy, difficulty, durationSec, problems) {
  const now    = Math.floor(Date.now() / 1000);
  const endsAt = now + durationSec;
  db.prepare(`
    INSERT INTO virtual_contests (id, channel_id, guild_id, started_by, difficulty, duration_sec, started_at, ends_at, problems)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, channelId, guildId, startedBy, difficulty, durationSec, now, endsAt, JSON.stringify(problems));
}

function getVC(id) {
  const row = db.prepare('SELECT * FROM virtual_contests WHERE id = ?').get(id);
  if (row && row.problems) row.problems = JSON.parse(row.problems);
  return row;
}

function getActiveVCs() {
  const now = Math.floor(Date.now() / 1000);
  return db.prepare('SELECT * FROM virtual_contests WHERE ended = 0 AND ends_at <= ?').all(now);
}

function endVC(id) {
  db.prepare('UPDATE virtual_contests SET ended = 1 WHERE id = ?').run(id);
}

function joinVC(vcId, discordId, cfHandle) {
  db.prepare(`
    INSERT OR IGNORE INTO vc_participants (vc_id, discord_id, cf_handle) VALUES (?, ?, ?)
  `).run(vcId, discordId, cfHandle);
}

function getVCParticipants(vcId) {
  return db.prepare('SELECT * FROM vc_participants WHERE vc_id = ?').all(vcId);
}

function updateVCSolved(vcId, discordId, solved) {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    UPDATE vc_participants SET solved = ?, finish_time = ? WHERE vc_id = ? AND discord_id = ?
  `).run(solved, now, vcId, discordId);
}

function getActiveVCForChannel(channelId) {
  const now = Math.floor(Date.now() / 1000);
  const row = db.prepare(`
    SELECT * FROM virtual_contests
    WHERE channel_id = ? AND ended = 0 AND ends_at > ?
    ORDER BY started_at DESC LIMIT 1
  `).get(channelId, now);
  if (row && row.problems) row.problems = JSON.parse(row.problems);
  return row;
}

// ─── Daily Problems Helpers ─────────────────────────────────────
function setDailyProblems(dateStr, p1_id, p2_id, p3_id) {
  db.prepare(`
    INSERT INTO daily_problems (date_str, p1_id, p2_id, p3_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(date_str) DO UPDATE SET
      p1_id = excluded.p1_id, p2_id = excluded.p2_id, p3_id = excluded.p3_id
  `).run(dateStr, p1_id, p2_id, p3_id);
}

function getDailyProblems(dateStr) {
  return db.prepare('SELECT * FROM daily_problems WHERE date_str = ?').get(dateStr);
}

function setFirstBlood(dateStr, field, discordId) {
  db.prepare(`UPDATE daily_problems SET ${field} = ? WHERE date_str = ?`).run(discordId, dateStr);
}

function setSweepAnnounced(dateStr, sweepAnnouncedJson) {
  db.prepare('UPDATE daily_problems SET sweep_announced = ? WHERE date_str = ?').run(sweepAnnouncedJson, dateStr);
}

// ─── Config Helpers ───────────────────────────────────────────
function getConfig(key) {
  const row = db.prepare('SELECT value FROM guild_config WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setConfig(key, value) {
  db.prepare(`
    INSERT INTO guild_config (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
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

module.exports = {
  db,
  getUser, upsertUser, linkPlatform, unlinkPlatform, getAllUsers,
  upsertRating, getRatings, getAllRatings,
  contestExists, upsertContest, getUpcomingContests, markContestNotified,
  getConfig, setConfig,
  insertRatingHistory, getRatingHistory,
  upsertStreak, getStreak, getAllStreaks,
  createVC, getVC, getActiveVCs, endVC, joinVC, getVCParticipants, updateVCSolved, getActiveVCForChannel,
  setDailyProblems, getDailyProblems, setFirstBlood, setSweepAnnounced,
  getLastSubmission, setLastSubmission,
  getWeeklySnapshot, setWeeklySnapshot, getAllWeeklySnapshots,
  getCachedContestName, cacheContestName
};
