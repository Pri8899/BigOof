// utils/atcoder.js — AtCoder wrapper (scrapes atcoder.jp directly)
const axios = require('axios');

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
  'Accept':     'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Referer':    'https://atcoder.jp'
};

const KENKOOOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
  'Origin':     'https://kenkoooo.com',
  'Referer':    'https://kenkoooo.com/atcoder/'
};

// ─── Fetch Upcoming Contests ──────────────────────────────────
async function getACContests() {
  // Try Kenkoooo first
  try {
    const res = await axios.get(
      'https://kenkoooo.com/atcoder/resources/contests.json',
      { timeout: 10000, headers: KENKOOOO_HEADERS }
    );
    if (Array.isArray(res.data)) {
      const now = Math.floor(Date.now() / 1000);
      const upcoming = res.data.filter(c => c.start_epoch_second > now).slice(0, 20).map(c => ({
        id:          `ac_${c.id}`,
        platform:    'AtCoder',
        name:        c.title,
        startTime:   c.start_epoch_second,
        durationSec: c.duration_second,
        url:         `https://atcoder.jp/contests/${c.id}`
      }));
      if (upcoming.length > 0) {
        console.log(`[AC] Fetched ${upcoming.length} contests from kenkoooo.`);
        return upcoming;
      }
    }
  } catch (e) {
    console.warn('[AC] Kenkoooo failed:', e.message);
  }
  // Fallback: scrape atcoder.jp
  return scrapeAtCoderContests();
}

// ─── Scrape atcoder.jp/contests ───────────────────────────────
async function scrapeAtCoderContests() {
  try {
    const res = await axios.get('https://atcoder.jp/contests/?lang=en', {
      timeout: 15000,
      headers: BROWSER_HEADERS
    });

    const html     = res.data;
    const now      = Math.floor(Date.now() / 1000);
    const contests = [];

    // Slice just the Upcoming Contests section
    const startIdx = html.indexOf('contest-table-upcoming');
    const endIdx   = html.indexOf('contest-table-recent', startIdx);
    if (startIdx === -1) {
      console.warn('[AC] Could not find upcoming contests table.');
      return [];
    }
    const section = html.slice(startIdx, endIdx > -1 ? endIdx : startIdx + 60000);

    // Parse each <tr> block
    // AtCoder HTML: <time class='fixtime fixtime-full'>2026-05-23 21:00:00+0900</time>
    const rowRegex = /<tr>([\s\S]*?)<\/tr>/g;
    let m;
    while ((m = rowRegex.exec(section)) !== null) {
      const row = m[1];

      // ── Start Time ──
      const timeMatch = row.match(/<time[^>]*>([\d]{4}-[\d]{2}-[\d]{2} [\d]{2}:[\d]{2}:[\d]{2}\+\d{4})<\/time>/);
      if (!timeMatch) continue;
      // "2026-05-23 21:00:00+0900" → ISO: replace space with T
      const isoStr    = timeMatch[1].replace(' ', 'T');
      const startTime = Math.floor(new Date(isoStr).getTime() / 1000);
      if (!startTime || isNaN(startTime) || startTime <= now) continue;

      // ── Contest Name & URL ──
      const linkMatch = row.match(/href="\/contests\/([^"]+)"[^>]*>([^<]+)<\/a>/);
      if (!linkMatch) continue;
      const contestId = linkMatch[1].trim();
      const name      = linkMatch[2].trim();
      if (!name || contestId === 'archive') continue;

      // ── Duration ── plain text in a <td> like "01:40" or "240:00"
      let durationSec = 7200;
      const tdIter    = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)];
      for (const td of tdIter) {
        const inner = td[1].replace(/<[^>]+>/g, '').trim();
        const dur   = inner.match(/^(\d+):(\d{2})$/);
        if (dur) {
          durationSec = parseInt(dur[1]) * 3600 + parseInt(dur[2]) * 60;
          break;
        }
      }

      contests.push({
        id:          `ac_${contestId}`,
        platform:    'AtCoder',
        name,
        startTime,
        durationSec,
        url:         `https://atcoder.jp/contests/${contestId}`
      });
    }

    console.log(`[AC] Scraped ${contests.length} upcoming contests from atcoder.jp`);
    return contests.slice(0, 20);
  } catch (err) {
    console.error('[AC] Scrape error:', err.message);
    return [];
  }
}

// Helper to fetch solved count from submissions API
async function getACSolvedCount(handle) {
  try {
    const res = await axios.get(
      `https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions?user=${handle}&from_second=0`,
      { timeout: 10000, headers: KENKOOOO_HEADERS }
    );
    if (Array.isArray(res.data)) {
      const solvedProblems = new Set(
        res.data.filter(s => s.result === 'AC').map(s => s.problem_id)
      );
      return solvedProblems.size;
    }
  } catch (_) {}
  return 0;
}

// ─── User Stats ──────────────────────────────────────────────
async function getACUser(handle) {
  const solved = await getACSolvedCount(handle);
  try {
    const res = await axios.get(
      `https://kenkoooo.com/atcoder/atcoder-api/v3/user/history?user=${handle}`,
      { timeout: 10000, headers: KENKOOOO_HEADERS }
    ).catch(() => null);

    let rating = 0, maxRating = 0;
    if (res && Array.isArray(res.data) && res.data.length > 0) {
      const last = res.data[res.data.length - 1];
      rating    = last.NewRating ?? 0;
      maxRating = Math.max(...res.data.map(h => h.NewRating ?? 0));
    } else {
      // Fallback to official history JSON endpoint
      const officialRes = await axios.get(`https://atcoder.jp/users/${handle}/history/json`, {
        timeout: 10000,
        headers: BROWSER_HEADERS
      }).catch(() => null);
      if (officialRes && Array.isArray(officialRes.data) && officialRes.data.length > 0) {
        const last = officialRes.data[officialRes.data.length - 1];
        rating    = last.NewRating ?? 0;
        maxRating = Math.max(...officialRes.data.map(h => h.NewRating ?? 0));
      }
    }

    let lastContest = null;
    try {
      const histRes = await axios.get(`https://atcoder.jp/users/${handle}/history/json`, {
        timeout: 10000,
        headers: BROWSER_HEADERS
      });
      if (Array.isArray(histRes.data) && histRes.data.length > 0) {
        const last = histRes.data[histRes.data.length - 1];
        lastContest = {
          contestName: last.ContestName || last.ContestScreenName,
          rank: last.Place
        };
      }
    } catch (_) {}

    return { rating, max_rating: maxRating, rank_title: getACRankTitle(rating), solved, acceptance: 0, lastContest };
  } catch (err) {
    console.error(`[AC] User fetch error for ${handle}:`, err.message);
    // Fallback: check if handle actually exists on AtCoder
    const isValid = await validateACHandle(handle);
    if (isValid) {
      return { rating: 0, max_rating: 0, rank_title: 'Unrated', solved, acceptance: 0, lastContest: null };
    }
    return null;
  }
}

// ─── Handle Validation ───────────────────────────────────────
async function validateACHandle(handle) {
  try {
    const res = await axios.get(
      `https://kenkoooo.com/atcoder/atcoder-api/v3/user/history?user=${handle}`,
      { timeout: 8000, headers: KENKOOOO_HEADERS }
    );
    return Array.isArray(res.data);
  } catch {
    try {
      const r = await axios.get(`https://atcoder.jp/users/${handle}`, {
        timeout: 8000, headers: BROWSER_HEADERS, validateStatus: s => s < 500
      });
      return r.status === 200;
    } catch { return false; }
  }
}

function getACRankTitle(rating) {
  if (rating >= 2800) return 'Red';
  if (rating >= 2400) return 'Orange';
  if (rating >= 2000) return 'Yellow';
  if (rating >= 1600) return 'Blue';
  if (rating >= 1200) return 'Cyan';
  if (rating >= 800)  return 'Green';
  if (rating >= 400)  return 'Brown';
  if (rating > 0)     return 'Gray';
  return 'Unrated';
}

module.exports = { getACUser, getACContests, validateACHandle };
