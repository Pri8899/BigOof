// utils/codeforces.js — Codeforces API wrapper
const axios = require('axios');

const CF_BASE = 'https://codeforces.com/api';
const CF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*'
};

/**
 * Fetch user info from Codeforces
 * @param {string} handle
 * @returns {{ rating, maxRating, rankTitle, solved }} or null
 */
async function getCFUser(handle) {
  try {
    const infoRes = await axios.get(`${CF_BASE}/user.info?handles=${handle}`, { timeout: 8000, headers: CF_HEADERS });
    if (infoRes.data.status !== 'OK') return null;
    const user = infoRes.data.result[0];

    // Count accepted submissions
    let solved = 0;
    try {
      const subRes = await axios.get(
        `${CF_BASE}/user.status?handle=${handle}&from=1&count=10000`,
        { timeout: 10000, headers: CF_HEADERS }
      );
      if (subRes.data.status === 'OK') {
        const seen = new Set();
        for (const sub of subRes.data.result) {
          if (sub.verdict === 'OK' && sub.problem) {
            const key = sub.problem.name
              ? `${sub.problem.name.trim().toLowerCase()}_${sub.problem.rating || 0}`
              : `${sub.problem.contestId}-${sub.problem.index}`;
            seen.add(key);
          }
        }
        solved = seen.size;
      }
    } catch (_) { /* ignore solve count errors */ }

    let lastContest = null;
    try {
      const ratingRes = await axios.get(`${CF_BASE}/user.rating?handle=${handle}`, { timeout: 6000, headers: CF_HEADERS });
      if (ratingRes.data.status === 'OK' && ratingRes.data.result.length > 0) {
        const last = ratingRes.data.result[ratingRes.data.result.length - 1];
        lastContest = {
          contestName: last.contestName,
          rank: last.rank
        };
      }
    } catch (_) {}

    return {
      rating:    user.rating    ?? 0,
      max_rating: user.maxRating ?? 0,
      rank_title: user.rank      ?? 'Unrated',
      solved,
      acceptance: 0,
      lastContest
    };
  } catch (err) {
    console.error(`[CF] Error fetching ${handle}:`, err.message);
    return null;
  }
}

/**
 * Fetch upcoming/running contests from Codeforces
 * @returns {Array<{id, name, startTimeSeconds, durationSeconds}>}
 */
async function getCFContests() {
  try {
    const res = await axios.get(`${CF_BASE}/contest.list?gym=false`, { timeout: 15000, headers: CF_HEADERS });
    if (res.data.status !== 'OK') return [];
    const now = Math.floor(Date.now() / 1000);
    return res.data.result
      .filter(c => c.phase === 'BEFORE' && c.startTimeSeconds > now)
      .map(c => ({
        id:           `cf_${c.id}`,
        platform:     'Codeforces',
        name:         c.name,
        startTime:    c.startTimeSeconds,
        durationSec:  c.durationSeconds,
        url:          `https://codeforces.com/contests/${c.id}`
      }));
  } catch (err) {
    console.error('[CF] Contest fetch error:', err.message);
    return [];
  }
}

/**
 * Validate a Codeforces handle
 */
async function validateCFHandle(handle) {
  try {
    const res = await axios.get(`${CF_BASE}/user.info?handles=${handle}`, { timeout: 6000, headers: CF_HEADERS });
    return res.data.status === 'OK';
  } catch {
    return false;
  }
}

let cachedProblems = null;
let lastCacheFetchTime = 0;
let cachedContests = null;
let lastContestCacheFetchTime = 0;
const CACHE_DURATION = 6 * 3600 * 1000; // 6 hours

// Pre-populate problemset and contest cache on boot
async function initializeProblemCache() {
  console.log('[CF] Warming up Codeforces problem set and contest caches...');
  try {
    const [probRes, contestRes] = await Promise.all([
      axios.get(`${CF_BASE}/problemset.problems`, { timeout: 20000, headers: CF_HEADERS }),
      axios.get(`${CF_BASE}/contest.list?gym=false`, { timeout: 15000, headers: CF_HEADERS }).catch(() => null)
    ]);
    
    if (probRes && probRes.data && probRes.data.status === 'OK' && probRes.data.result && Array.isArray(probRes.data.result.problems)) {
      cachedProblems = probRes.data.result.problems;
      lastCacheFetchTime = Date.now();
      console.log(`[CF] Problem set cache warmed up: ${cachedProblems.length} problems loaded.`);
    }

    if (contestRes && contestRes.data && contestRes.data.status === 'OK' && Array.isArray(contestRes.data.result)) {
      const contestMap = {};
      for (const c of contestRes.data.result) {
        contestMap[c.id] = c.name;
      }
      cachedContests = contestMap;
      lastContestCacheFetchTime = Date.now();
      console.log(`[CF] Contest list cache warmed up: ${Object.keys(cachedContests).length} contests loaded.`);
    }
  } catch (err) {
    console.warn('[CF] Failed to warm up caches on startup:', err.message);
  }
}

// Check if a contest name matches the selected division filter
function matchesDivision(contestName, division, rating = null) {
  if (!contestName) {
    if (!rating) return true;
    if (division === 'div1') return rating >= 1600;
    if (division === 'div2') return rating <= 2200;
    if (division === 'div3') return rating <= 1600;
    if (division === 'div4') return rating <= 1400;
    return true;
  }
  
  const lowerName = contestName.toLowerCase();
  const hasDiv1 = /div\.?\s*1\b/i.test(lowerName) || lowerName.includes('global') || lowerName.includes('div. 1 + div. 2');
  const hasDiv2 = /div\.?\s*2\b/i.test(lowerName) || lowerName.includes('educational') || lowerName.includes('div. 1 + div. 2');
  const hasDiv3 = /div\.?\s*3\b/i.test(lowerName);
  const hasDiv4 = /div\.?\s*4\b/i.test(lowerName);

  if (division === 'div1') return hasDiv1;
  if (division === 'div2') return hasDiv2;
  if (division === 'div3') return hasDiv3;
  if (division === 'div4') return hasDiv4;

  return true;
}

/**
 * Helper to filter problem candidates from cache
 */
function filterProblemCandidates(problems, minRating, maxRating, tag, excludeIds, division, excludeTags, contestMap) {
  return problems.filter(p => {
    const pId = `${p.contestId}${p.index}`;
    
    // Check rating
    if (p.rating === undefined || p.rating === null || p.rating < minRating || p.rating > maxRating) {
      return false;
    }
    
    // Check exclusions (solved problems)
    if (excludeIds && excludeIds.has(pId)) {
      return false;
    }
    
    // Check tag if provided
    if (tag) {
      const lowerTag = tag.toLowerCase();
      if (!p.tags || !p.tags.some(t => t.toLowerCase() === lowerTag)) {
        return false;
      }
    }

    // Check division if provided
    if (division) {
      const contestName = contestMap ? contestMap[p.contestId] : null;
      if (!matchesDivision(contestName, division, p.rating)) {
        return false;
      }
    }
    
    // Check exclude tags
    if (excludeTags && excludeTags.size > 0 && p.tags) {
      for (const t of p.tags) {
        if (excludeTags.has(t.toLowerCase())) return false;
      }
    }

    // Filter out Surprise Language Rounds and Gym contests — they don't allow C++
    if (p.contestId >= 100000) return false; // Gym contest
    if (contestMap) {
      const cName = (contestMap[p.contestId] || '').toLowerCase();
      if (cName.includes('surprise') || cName.includes('language round') || cName.includes('kotlin') || cName.includes('java') || cName.includes('scala')) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Fetch CF problems filtered by rating range, optional tag, and optional division
 * @param {number} minRating
 * @param {number} maxRating
 * @param {string|null} tag
 * @param {number} count - how many to return
 * @param {Set} excludeIds - solved problem IDs
 * @param {string|null} division - 'div1', 'div2', 'div3', 'div4'
 * @param {Set} excludeTags - tags to exclude
 */
async function getCFProblems(minRating = 800, maxRating = 3500, tag = null, count = 5, excludeIds = new Set(), division = null, excludeTags = new Set()) {
  try {
    const now = Date.now();
    
    // Fetch problemset cache if needed
    if (!cachedProblems || (now - lastCacheFetchTime > CACHE_DURATION)) {
      console.log('[CF] Cache expired or empty. Fetching full problemset from Codeforces API...');
      const res = await axios.get(`${CF_BASE}/problemset.problems`, { timeout: 20000, headers: CF_HEADERS });
      if (res.data && res.data.status === 'OK' && res.data.result && Array.isArray(res.data.result.problems)) {
        cachedProblems = res.data.result.problems;
        lastCacheFetchTime = now;
        console.log(`[CF] Successfully cached ${cachedProblems.length} problems.`);
      }
    }

    // Fetch contest list cache if needed
    if (!cachedContests || (now - lastContestCacheFetchTime > CACHE_DURATION)) {
      const res = await axios.get(`${CF_BASE}/contest.list?gym=false`, { timeout: 20000, headers: CF_HEADERS }).catch(() => null);
      if (res && res.data && res.data.status === 'OK' && Array.isArray(res.data.result)) {
        const contestMap = {};
        for (const c of res.data.result) {
          contestMap[c.id] = c.name;
        }
        cachedContests = contestMap;
        lastContestCacheFetchTime = now;
      }
    }

    if (!cachedProblems || cachedProblems.length === 0) {
      console.error('[CF] Problem cache is empty and API fetch failed.');
      return [];
    }

    // Attempt 1: Strict filter
    let filtered = filterProblemCandidates(cachedProblems, minRating, maxRating, tag, excludeIds, division, excludeTags, cachedContests);

    // Attempt 2: If no matches and minRating === maxRating, widen rating window (±100)
    if (filtered.length === 0 && minRating === maxRating) {
      const wMin = Math.max(800, minRating - 100);
      const wMax = Math.min(3500, maxRating + 100);
      filtered = filterProblemCandidates(cachedProblems, wMin, wMax, tag, excludeIds, division, excludeTags, cachedContests);
    }

    // Attempt 3: If still no matches, widen rating window (±200)
    if (filtered.length === 0 && (minRating === maxRating || minRating > 800 || maxRating < 3500)) {
      const wMin = Math.max(800, minRating - 200);
      const wMax = Math.min(3500, maxRating + 200);
      filtered = filterProblemCandidates(cachedProblems, wMin, wMax, tag, excludeIds, division, excludeTags, cachedContests);
    }

    // Attempt 4: If still no matches and division was specified, relax division filter
    if (filtered.length === 0 && division) {
      const wMin = Math.max(800, minRating - 200);
      const wMax = Math.min(3500, maxRating + 200);
      filtered = filterProblemCandidates(cachedProblems, wMin, wMax, tag, excludeIds, null, excludeTags, cachedContests);
    }

    // Attempt 5: If still no matches, ignore excludeIds (if user solved everything matching criteria)
    if (filtered.length === 0 && excludeIds && excludeIds.size > 0) {
      filtered = filterProblemCandidates(cachedProblems, Math.max(800, minRating - 200), Math.min(3500, maxRating + 200), tag, null, null, excludeTags, cachedContests);
    }

    // Shuffle and pick
    filtered = filtered.sort(() => Math.random() - 0.5).slice(0, count);

    return filtered.map(p => ({
      id:         `${p.contestId}${p.index}`,
      name:       p.name,
      rating:     p.rating ?? '?',
      tags:       (p.tags ?? []).slice(0, 4),
      url:        `https://codeforces.com/problemset/problem/${p.contestId}/${p.index}`,
      contestId:  p.contestId,
      index:      p.index
    }));
  } catch (err) {
    console.error('[CF] getCFProblems error:', err.message);
    if (cachedProblems && cachedProblems.length > 0) {
      let filtered = filterProblemCandidates(cachedProblems, minRating, maxRating, tag, excludeIds, division, excludeTags, cachedContests);
      if (filtered.length === 0) {
        filtered = filterProblemCandidates(cachedProblems, Math.max(800, minRating - 200), Math.min(3500, maxRating + 200), tag, null, null, excludeTags, cachedContests);
      }
      filtered = filtered.sort(() => Math.random() - 0.5).slice(0, count);
      return filtered.map(p => ({
        id:         `${p.contestId}${p.index}`,
        name:       p.name,
        rating:     p.rating ?? '?',
        tags:       (p.tags ?? []).slice(0, 4),
        url:        `https://codeforces.com/problemset/problem/${p.contestId}/${p.index}`,
        contestId:  p.contestId,
        index:      p.index
      }));
    }
    return [];
  }
}


/**
 * Check solved status for a CF user on specific problems
 * @param {string} handle
 * @param {Array<{contestId, index}>} problems
 */
async function checkCFSolved(handle, problems) {
  try {
    const res = await axios.get(
      `${CF_BASE}/user.status?handle=${handle}&from=1&count=200`,
      { timeout: 10000 }
    );
    if (res.data.status !== 'OK') return new Set();

    const solved = new Set();
    for (const sub of res.data.result) {
      if (sub.verdict === 'OK' && sub.problem) {
        const key = `${sub.problem.contestId}-${sub.problem.index}`;
        solved.add(key);
      }
    }

    return problems.filter(p => solved.has(`${p.contestId}-${p.index}`)).length;
  } catch {
    return 0;
  }
}

/**
 * Get the solved problem breakdown by division (Div 1, 2, 3, 4) for a user
 */
async function getCFDivisionBreakdown(handle) {
  try {
    // Ensure the contest cache is populated — fetch it if missing
    if (!cachedContests) {
      try {
        const contestRes = await axios.get(`${CF_BASE}/contest.list?gym=false`, { timeout: 15000, headers: CF_HEADERS });
        if (contestRes.data.status === 'OK') {
          const contestMap = {};
          for (const c of contestRes.data.result) {
            contestMap[c.id] = c.name;
          }
          cachedContests = contestMap;
          lastContestCacheFetchTime = Date.now();
          console.log(`[CF] Contest cache loaded on-demand: ${Object.keys(cachedContests).length} contests`);
        }
      } catch (cErr) {
        console.warn('[CF] Could not fetch contest list for division breakdown:', cErr.message);
      }
    }

    const subRes = await axios.get(
      `${CF_BASE}/user.status?handle=${handle}&from=1&count=10000`,
      { timeout: 12000 }
    );
    if (subRes.data.status !== 'OK') return null;

    const uniqueSolved = new Set();
    const breakdown = { div1: 0, div2: 0, div3: 0, div4: 0, others: 0, total: 0 };

    for (const sub of subRes.data.result) {
      if (sub.verdict === 'OK' && sub.problem) {
        const key = `${sub.problem.contestId}-${sub.problem.index}`;
        if (uniqueSolved.has(key)) continue;
        uniqueSolved.add(key);

        const contestId = sub.problem.contestId;
        const contestName = cachedContests ? cachedContests[contestId] : null;

        if (contestName) {
          const lowerName = contestName.toLowerCase();
          const hasDiv1 = lowerName.includes('div. 1') || lowerName.includes('div 1') || lowerName.includes('global');
          const hasDiv2 = lowerName.includes('div. 2') || lowerName.includes('div 2') || lowerName.includes('educational');
          const hasDiv3 = lowerName.includes('div. 3') || lowerName.includes('div 3');
          const hasDiv4 = lowerName.includes('div. 4') || lowerName.includes('div 4');

          // Highest div wins: priority Div 1 > Div 2 > Div 3 > Div 4 > Others
          if (hasDiv1)      breakdown.div1++;
          else if (hasDiv2) breakdown.div2++;
          else if (hasDiv3) breakdown.div3++;
          else if (hasDiv4) breakdown.div4++;
          else              breakdown.others++;
        } else {
          breakdown.others++;
        }
      }
    }

    breakdown.total = uniqueSolved.size;
    return breakdown;
  } catch (err) {
    console.error(`[CF] Error getting division breakdown for ${handle}:`, err.message);
    return null;
  }
}

module.exports = {
  getCFUser,
  getCFContests,
  validateCFHandle,
  getCFProblems,
  checkCFSolved,
  initializeProblemCache,
  getCFDivisionBreakdown
};

