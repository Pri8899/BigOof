// utils/atcoder.js — AtCoder API wrapper (Kenkoooo API + official atcoder.jp fallback)
const axios = require('axios');
const { calculateStreakFromTimestamps } = require('./time');

async function axiosGetWithRetry(url, options = {}, retries = 3, backoff = 1500) {
  for (let i = 0; i < retries; i++) {
    try {
      return await axios.get(url, options);
    } catch (err) {
      const status = err.response?.status;
      const isRateLimit = status === 429;
      const isServerError = status && status >= 500;
      const isTimeout = err.code === 'ECONNABORTED' || err.message?.includes('timeout');

      if ((isRateLimit || isServerError || isTimeout) && i < retries - 1) {
        const delay = backoff * Math.pow(2, i);
        console.warn(`[AC API Retry] Failed ${url} (${status || err.code}). Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Referer': 'https://atcoder.jp'
};

const KENKOOOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
  'Origin': 'https://kenkoooo.com',
  'Referer': 'https://kenkoooo.com/atcoder/'
};

const CONTEST_CACHE_TTL = 6 * 3600 * 1000;
let acContestsCache = null;
let acContestsFetchedAt = 0;

async function ensureACContestCache() {
  const now = Date.now();
  if (acContestsCache && (now - acContestsFetchedAt <= CONTEST_CACHE_TTL)) {
    return acContestsCache;
  }
  const res = await axiosGetWithRetry(
    'https://kenkoooo.com/atcoder/resources/contests.json',
    { timeout: 10000, headers: KENKOOOO_HEADERS }
  );
  if (Array.isArray(res.data)) {
    acContestsCache = res.data;
    acContestsFetchedAt = now;
  }
  return acContestsCache;
}

/**
 * Resolves an AtCoder contest ID (e.g. `abc380`) to its full title using Kenkoooo cache.
 */
async function getACContestName(contestId) {
  if (!contestId) return 'AtCoder Practice';
  try {
    const list = await ensureACContestCache();
    const match = Array.isArray(list) ? list.find(c => c.id === contestId) : null;
    if (match?.title) return match.title;
  } catch (_) {}
  return String(contestId).toUpperCase();
}

/**
 * Fetch upcoming contests from Kenkoooo (sorted chronologically) or atcoder.jp fallback.
 */
async function getACContests() {
  try {
    const list = await ensureACContestCache();
    if (Array.isArray(list)) {
      const now = Math.floor(Date.now() / 1000);
      const upcoming = list
        .filter(c => c.start_epoch_second > now)
        .sort((a, b) => a.start_epoch_second - b.start_epoch_second)
        .slice(0, 20)
        .map(c => ({
          id: `ac_${c.id}`,
          platform: 'AtCoder',
          name: c.title,
          startTime: c.start_epoch_second,
          durationSec: c.duration_second,
          url: `https://atcoder.jp/contests/${c.id}`
        }));
      if (upcoming.length > 0) {
        console.log(`[AC] Fetched ${upcoming.length} contests from kenkoooo.`);
        return upcoming;
      }
    }
  } catch (e) {
    console.warn('[AC] Kenkoooo contests failed:', e.message);
  }
  return scrapeAtCoderContests();
}

async function scrapeAtCoderContests() {
  try {
    const res = await axiosGetWithRetry('https://atcoder.jp/contests/?lang=en', {
      timeout: 15000,
      headers: BROWSER_HEADERS
    });

    const html = res.data;
    const now = Math.floor(Date.now() / 1000);
    const contests = [];

    const startIdx = html.indexOf('contest-table-upcoming');
    const endIdx = html.indexOf('contest-table-recent', startIdx);
    if (startIdx === -1) {
      console.warn('[AC] Could not find upcoming contests table.');
      return [];
    }
    const section = html.slice(startIdx, endIdx > -1 ? endIdx : startIdx + 60000);

    const rowRegex = /<tr>([\s\S]*?)<\/tr>/g;
    let m;
    while ((m = rowRegex.exec(section)) !== null) {
      const row = m[1];
      const timeMatch = row.match(/<time[^>]*>([\d]{4}-[\d]{2}-[\d]{2} [\d]{2}:[\d]{2}:[\d]{2}\+\d{4})<\/time>/);
      if (!timeMatch) continue;
      const isoStr = timeMatch[1].replace(' ', 'T');
      const startTime = Math.floor(new Date(isoStr).getTime() / 1000);
      if (!startTime || Number.isNaN(startTime) || startTime <= now) continue;

      const linkMatch = row.match(/href="\/contests\/([^"]+)"[^>]*>([^<]+)<\/a>/);
      if (!linkMatch) continue;
      const contestId = linkMatch[1].trim();
      const name = linkMatch[2].trim();
      if (!name || contestId === 'archive') continue;

      let durationSec = 7200;
      const tdIter = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)];
      for (const td of tdIter) {
        const inner = td[1].replace(/<[^>]+>/g, '').trim();
        const dur = inner.match(/^(\d+):(\d{2})$/);
        if (dur) {
          durationSec = parseInt(dur[1], 10) * 3600 + parseInt(dur[2], 10) * 60;
          break;
        }
      }

      contests.push({
        id: `ac_${contestId}`,
        platform: 'AtCoder',
        name,
        startTime,
        durationSec,
        url: `https://atcoder.jp/contests/${contestId}`
      });
    }

    contests.sort((a, b) => a.startTime - b.startTime);
    console.log(`[AC] Scraped ${contests.length} upcoming contests from atcoder.jp`);
    return contests.slice(0, 20);
  } catch (err) {
    console.error('[AC] Scrape error:', err.message);
    return [];
  }
}

/**
 * Iterates Kenkoooo user submission pages (up to 50 pages / 25k submissions).
 */
async function forEachACSubmissionPage(handle, onPage, timeout = 15000) {
  let fromSecond = 0;
  let pagesFetched = 0;
  const encoded = encodeURIComponent(handle);

  while (pagesFetched < 50) {
    const res = await axiosGetWithRetry(
      `https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions?user=${encoded}&from_second=${fromSecond}`,
      { timeout, headers: KENKOOOO_HEADERS }
    );
    if (!Array.isArray(res.data) || res.data.length === 0) break;

    onPage(res.data);
    if (res.data.length < 500) break;

    const maxEpoch = Math.max(...res.data.map(s => s.epoch_second));
    if (maxEpoch + 1 <= fromSecond) break;
    fromSecond = maxEpoch + 1;
    pagesFetched++;
  }
}

/**
 * Fetches total distinct AC problems solved by an AtCoder handle (up to 50 pages / 25k subs).
 */
async function getACSolvedCount(handle) {
  const solvedProblems = new Set();
  await forEachACSubmissionPage(handle, (page) => {
    for (const s of page) {
      if (s.result === 'AC') solvedProblems.add(s.problem_id);
    }
  });
  return solvedProblems.size;
}

/**
 * Computes current and max daily solving streak for an AtCoder handle.
 */
async function calculateACStreak(handle) {
  try {
    const timestamps = [];
    await forEachACSubmissionPage(handle, (page) => {
      for (const s of page) {
        if (s.epoch_second) timestamps.push(s.epoch_second);
      }
    }, 12000);
    const { current, max } = calculateStreakFromTimestamps(timestamps);
    return { current, max };
  } catch (err) {
    console.error(`[StreakCalc] AC streak error for ${handle}:`, err.message);
    return { current: 0, max: 0 };
  }
}

/**
 * Fetches AtCoder rating, peak rating, rank title, solved count, and last contest.
 */
async function getACUser(handle) {
  const encoded = encodeURIComponent(handle);
  let solved = null;
  try {
    try {
      solved = await getACSolvedCount(handle);
    } catch (solvedErr) {
      console.warn(`[AC] Solved count lookup failed for ${handle}:`, solvedErr.message);
    }

    const res = await axiosGetWithRetry(
      `https://kenkoooo.com/atcoder/atcoder-api/v3/user/history?user=${encoded}`,
      { timeout: 15000, headers: KENKOOOO_HEADERS }
    ).catch(() => null);

    let rating = 0;
    let maxRating = 0;
    let lastContest = null;

    if (res && Array.isArray(res.data) && res.data.length > 0) {
      const last = res.data[res.data.length - 1];
      rating = last.NewRating ?? 0;
      maxRating = Math.max(...res.data.map(h => h.NewRating ?? 0));
      lastContest = {
        contestName: last.ContestName || last.ContestScreenName,
        rank: last.Place
      };
    }

    // Fetch official AtCoder JSON when Kenkoooo history didn't supply contest metadata or was empty
    if (!lastContest || rating === 0) {
      try {
        const officialRes = await axiosGetWithRetry(
          `https://atcoder.jp/users/${encoded}/history/json`,
          { timeout: 15000, headers: BROWSER_HEADERS }
        );
        if (Array.isArray(officialRes.data) && officialRes.data.length > 0) {
          const last = officialRes.data[officialRes.data.length - 1];
          rating = last.NewRating ?? rating;
          maxRating = Math.max(maxRating, ...officialRes.data.map(h => h.NewRating ?? 0));
          lastContest = {
            contestName: last.ContestName || last.ContestScreenName,
            rank: last.Place
          };
        }
      } catch (_) {}
    }

    return {
      rating,
      max_rating: maxRating,
      rank_title: getACRankTitle(rating),
      solved: solved ?? 0,
      acceptance: 0,
      lastContest
    };
  } catch (err) {
    console.error(`[AC] User fetch error for ${handle}:`, err.message);
    return null;
  }
}

/**
 * Validates that an AtCoder user actually exists (checks atcoder.jp profile status first).
 */
async function validateACHandle(handle) {
  const encoded = encodeURIComponent(handle);
  try {
    const r = await axiosGetWithRetry(`https://atcoder.jp/users/${encoded}`, {
      timeout: 8000,
      headers: BROWSER_HEADERS,
      validateStatus: s => s < 500
    }, 2);
    return r.status === 200;
  } catch {
    try {
      const res = await axiosGetWithRetry(
        `https://kenkoooo.com/atcoder/atcoder-api/v3/user/history?user=${encoded}`,
        { timeout: 8000, headers: KENKOOOO_HEADERS },
        2
      );
      return Array.isArray(res.data) && res.data.length > 0;
    } catch {
      return false;
    }
  }
}

function getACRankTitle(rating) {
  if (rating >= 2800) return 'Red';
  if (rating >= 2400) return 'Orange';
  if (rating >= 2000) return 'Yellow';
  if (rating >= 1600) return 'Blue';
  if (rating >= 1200) return 'Cyan';
  if (rating >= 800) return 'Green';
  if (rating >= 400) return 'Brown';
  if (rating > 0) return 'Gray';
  return 'Unrated';
}

module.exports = {
  axiosGetWithRetry,
  KENKOOOO_HEADERS,
  getACUser,
  getACContests,
  getACContestName,
  validateACHandle,
  getACSolvedCount,
  calculateACStreak
};
