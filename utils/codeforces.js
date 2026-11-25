// utils/codeforces.js — Codeforces REST API wrapper with shared headers, caching, and retries
const axios = require('axios');

const CF_BASE = 'https://codeforces.com/api';
const CF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*'
};

const CACHE_DURATION = 6 * 3600 * 1000; // 6 hours
let cachedProblems = null;
let lastCacheFetchTime = 0;
let cachedContests = null;
let lastContestCacheFetchTime = 0;
let problemFetchPromise = null;
let contestFetchPromise = null;

/**
 * Performs a resilient GET request to Codeforces API with browser headers & retry backoff.
 */
async function cfGet(endpoint, timeout = 12000, retries = 3) {
  const url = endpoint.startsWith('http') ? endpoint : `${CF_BASE}${endpoint}`;
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      return await axios.get(url, { timeout, headers: CF_HEADERS });
    } catch (err) {
      lastErr = err;
      const status = err.response?.status;
      const retryable =
        status === 429 ||
        status === 503 ||
        (status && status >= 500) ||
        err.code === 'ECONNABORTED' ||
        err.code === 'ECONNRESET' ||
        err.message?.includes('timeout');
      if (retryable && i < retries - 1) {
        const delay = 1500 * Math.pow(2, i);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

function getCFProblemKey(problem) {
  if (!problem) return null;
  if (problem.contestId !== undefined && problem.index !== undefined) {
    return `${problem.contestId}-${problem.index}`;
  }
  return problem.name ? `${problem.name.trim().toLowerCase()}_${problem.rating || 0}` : null;
}

/**
 * Fetches Codeforces user submissions safely. Returns array on OK, or null if API failed.
 */
async function getCFStatus(handle, count = 2000, from = 1) {
  try {
    const res = await cfGet(
      `/user.status?handle=${encodeURIComponent(handle)}&from=${from}&count=${count}`,
      12000
    );
    if (res.data?.status === 'OK' && Array.isArray(res.data.result)) {
      return res.data.result;
    }
    return null;
  } catch (err) {
    console.warn(`[CF] user.status failed for ${handle}:`, err.message);
    return null;
  }
}

/**
 * Fetch user info, solved count, and last rated contest from Codeforces.
 */
async function getCFUser(handle, { includeSolvedSet = false } = {}) {
  try {
    const infoRes = await cfGet(`/user.info?handles=${encodeURIComponent(handle)}`, 8000);
    if (infoRes.data?.status !== 'OK' || !Array.isArray(infoRes.data.result) || !infoRes.data.result[0]) {
      return null;
    }
    const user = infoRes.data.result[0];

    let solved = null;
    const seen = new Set();
    const subs = await getCFStatus(handle, 10000);
    if (subs) {
      for (const sub of subs) {
        if (sub.verdict === 'OK' && sub.problem) {
          const key = getCFProblemKey(sub.problem);
          if (key) seen.add(key);
        }
      }
      solved = seen.size;
    }

    let lastContest = null;
    try {
      const ratingRes = await cfGet(`/user.rating?handle=${encodeURIComponent(handle)}`, 8000);
      if (ratingRes.data?.status === 'OK' && Array.isArray(ratingRes.data.result) && ratingRes.data.result.length > 0) {
        const last = ratingRes.data.result[ratingRes.data.result.length - 1];
        lastContest = {
          contestName: last.contestName,
          rank: last.rank
        };
      }
    } catch (_) {}

    const result = {
      rating: user.rating ?? 0,
      max_rating: user.maxRating ?? 0,
      rank_title: user.rank ?? 'Unrated',
      solved,
      acceptance: 0,
      lastContest
    };
    if (includeSolvedSet) result.solvedSet = seen;
    return result;
  } catch (err) {
    console.error(`[CF] Error fetching ${handle}:`, err.message);
    return null;
  }
}

/**
 * Fetch upcoming contests from Codeforces.
 */
async function getCFContests() {
  try {
    const res = await cfGet('/contest.list?gym=false', 15000);
    if (res.data?.status !== 'OK') return [];
    const now = Math.floor(Date.now() / 1000);
    return res.data.result
      .filter(c => c.phase === 'BEFORE' && c.startTimeSeconds > now)
      .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds)
      .map(c => ({
        id: `cf_${c.id}`,
        platform: 'Codeforces',
        name: c.name,
        startTime: c.startTimeSeconds,
        durationSec: c.durationSeconds,
        url: `https://codeforces.com/contests/${c.id}`
      }));
  } catch (err) {
    console.error('[CF] Contest fetch error:', err.message);
    return [];
  }
}

async function validateCFHandle(handle) {
  try {
    const res = await cfGet(`/user.info?handles=${encodeURIComponent(handle)}`, 6000, 2);
    return res.data?.status === 'OK';
  } catch {
    return false;
  }
}

async function ensureProblemCache(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedProblems && (now - lastCacheFetchTime <= CACHE_DURATION)) {
    return cachedProblems;
  }

  if (!problemFetchPromise) {
    problemFetchPromise = (async () => {
      try {
        const res = await cfGet('/problemset.problems', 20000);
        if (res.data?.status === 'OK' && Array.isArray(res.data.result?.problems)) {
          cachedProblems = res.data.result.problems;
          lastCacheFetchTime = Date.now();
        }
      } catch (err) {
        console.warn('[CF] Failed to refresh problemset cache:', err.message);
      } finally {
        problemFetchPromise = null;
      }
      return cachedProblems;
    })();
  }
  return problemFetchPromise;
}

async function ensureContestCache(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedContests && (now - lastContestCacheFetchTime <= CACHE_DURATION)) {
    return cachedContests;
  }

  if (!contestFetchPromise) {
    contestFetchPromise = (async () => {
      try {
        const res = await cfGet('/contest.list?gym=false', 15000);
        if (res.data?.status === 'OK' && Array.isArray(res.data.result)) {
          const contestMap = {};
          for (const c of res.data.result) {
            contestMap[c.id] = c.name;
          }
          cachedContests = contestMap;
          lastContestCacheFetchTime = Date.now();
        }
      } catch (err) {
        console.warn('[CF] Failed to refresh contest list cache:', err.message);
      } finally {
        contestFetchPromise = null;
      }
      return cachedContests;
    })();
  }
  return contestFetchPromise;
}

async function getProblemsetCache() {
  return ensureProblemCache(false);
}

async function initializeProblemCache() {
  console.log('[CF] Warming up Codeforces problemset and contest caches...');
  await Promise.all([ensureProblemCache(false), ensureContestCache(false)]);
  if (cachedProblems) {
    console.log(`[CF] Problemset cache warmed up: ${cachedProblems.length} problems loaded.`);
  }
  if (cachedContests) {
    console.log(`[CF] Contest list cache warmed up: ${Object.keys(cachedContests).length} contests loaded.`);
  }
}

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

function filterProblemCandidates(problems, minRating, maxRating, tag, excludeIds, division, excludeTags, contestMap) {
  return problems.filter(p => {
    const compactId = `${p.contestId}${p.index}`;
    const hyphenId = `${p.contestId}-${p.index}`;

    if (p.rating === undefined || p.rating === null || p.rating < minRating || p.rating > maxRating) {
      return false;
    }
    if (excludeIds && (excludeIds.has(compactId) || excludeIds.has(hyphenId))) {
      return false;
    }
    if (tag) {
      const lowerTag = tag.toLowerCase();
      if (!p.tags || !p.tags.some(t => t.toLowerCase() === lowerTag)) {
        return false;
      }
    }
    if (division) {
      const contestName = contestMap ? contestMap[p.contestId] : null;
      if (!matchesDivision(contestName, division, p.rating)) {
        return false;
      }
    }
    if (excludeTags && excludeTags.size > 0 && p.tags) {
      for (const t of p.tags) {
        if (excludeTags.has(t.toLowerCase())) return false;
      }
    }
    if (p.contestId >= 100000) return false;
    if (contestMap) {
      const cName = (contestMap[p.contestId] || '').toLowerCase();
      if (cName.includes('surprise') || cName.includes('language round') || cName.includes('kotlin')) {
        return false;
      }
    }
    return true;
  });
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Fetch filtered CF problems. Accepts either positional arguments or a single options object.
 */
async function getCFProblems(
  minRatingOrOpts = 800,
  maxRating = 3500,
  tag = null,
  count = 5,
  excludeIds = new Set(),
  division = null,
  excludeTags = new Set()
) {
  let minRating = minRatingOrOpts;
  if (minRatingOrOpts && typeof minRatingOrOpts === 'object' && !(minRatingOrOpts instanceof Set)) {
    minRating = minRatingOrOpts.minRating ?? 800;
    maxRating = minRatingOrOpts.maxRating ?? 3500;
    tag = minRatingOrOpts.tag ?? null;
    count = minRatingOrOpts.count ?? 5;
    excludeIds = minRatingOrOpts.excludeIds ?? new Set();
    division = minRatingOrOpts.division ?? null;
    excludeTags = minRatingOrOpts.excludeTags ?? new Set();
  }

  try {
    const [problems, contestMap] = await Promise.all([ensureProblemCache(false), ensureContestCache(false)]);

    if (!problems || problems.length === 0) {
      console.error('[CF] Problem cache is empty and API fetch failed.');
      return [];
    }

    let filtered = filterProblemCandidates(problems, minRating, maxRating, tag, excludeIds, division, excludeTags, contestMap);

    if (filtered.length === 0 && minRating === maxRating) {
      filtered = filterProblemCandidates(
        problems, Math.max(800, minRating - 100), Math.min(3500, maxRating + 100),
        tag, excludeIds, division, excludeTags, contestMap
      );
    }

    if (filtered.length === 0 && (minRating === maxRating || minRating > 800 || maxRating < 3500)) {
      filtered = filterProblemCandidates(
        problems, Math.max(800, minRating - 200), Math.min(3500, maxRating + 200),
        tag, excludeIds, division, excludeTags, contestMap
      );
    }

    if (filtered.length === 0 && division) {
      filtered = filterProblemCandidates(
        problems, Math.max(800, minRating - 200), Math.min(3500, maxRating + 200),
        tag, excludeIds, null, excludeTags, contestMap
      );
    }

    if (filtered.length === 0 && excludeTags && excludeTags.size > 0) {
      filtered = filterProblemCandidates(
        problems, Math.max(800, minRating - 200), Math.min(3500, maxRating + 200),
        tag, excludeIds, null, null, contestMap
      );
    }

    if (filtered.length === 0 && excludeIds && excludeIds.size > 0) {
      filtered = filterProblemCandidates(
        problems, Math.max(800, minRating - 200), Math.min(3500, maxRating + 200),
        tag, null, null, null, contestMap
      );
    }

    const picked = shuffleInPlace([...filtered]).slice(0, count);
    return picked.map(p => ({
      id: `${p.contestId}${p.index}`,
      name: p.name,
      rating: p.rating ?? '?',
      tags: (p.tags ?? []).slice(0, 4),
      url: `https://codeforces.com/problemset/problem/${p.contestId}/${p.index}`,
      contestId: p.contestId,
      index: p.index
    }));
  } catch (err) {
    console.error('[CF] getCFProblems error:', err.message);
    return [];
  }
}

/**
 * Returns how many of `problems` the handle has solved (optionally after minTimestamp seconds).
 */
async function checkCFSolved(handle, problems, minTimestamp = 0) {
  const subs = await getCFStatus(handle, 500);
  if (!subs) return 0;

  const solved = new Set();
  for (const sub of subs) {
    if (sub.verdict === 'OK' && sub.problem && (!minTimestamp || sub.creationTimeSeconds >= minTimestamp)) {
      solved.add(`${sub.problem.contestId}-${sub.problem.index}`);
    }
  }
  return problems.filter(p => solved.has(`${p.contestId}-${p.index}`)).length;
}

/**
 * Returns solved problem breakdown by division (Div 1..4 & Others/Gym).
 */
async function getCFDivisionBreakdown(handle) {
  try {
    const contestMap = await ensureContestCache(false);
    const subs = await getCFStatus(handle, 10000);
    if (!subs) return null;

    const uniqueSolved = new Set();
    const breakdown = { div1: 0, div2: 0, div3: 0, div4: 0, others: 0, total: 0 };

    for (const sub of subs) {
      if (sub.verdict === 'OK' && sub.problem) {
        const key = getCFProblemKey(sub.problem);
        if (!key || uniqueSolved.has(key)) continue;
        uniqueSolved.add(key);

        const contestName = contestMap ? contestMap[sub.problem.contestId] : null;
        if (contestName) {
          const lowerName = contestName.toLowerCase();
          const hasDiv1 = /div\.?\s*1\b/i.test(lowerName) || lowerName.includes('global');
          const hasDiv2 = /div\.?\s*2\b/i.test(lowerName) || lowerName.includes('educational');
          const hasDiv3 = /div\.?\s*3\b/i.test(lowerName);
          const hasDiv4 = /div\.?\s*4\b/i.test(lowerName);

          if (hasDiv1) breakdown.div1++;
          else if (hasDiv2) breakdown.div2++;
          else if (hasDiv3) breakdown.div3++;
          else if (hasDiv4) breakdown.div4++;
          else breakdown.others++;
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
  cfGet,
  getCFStatus,
  getCFUser,
  getCFContests,
  validateCFHandle,
  getCFProblems,
  getProblemsetCache,
  checkCFSolved,
  initializeProblemCache,
  getCFDivisionBreakdown
};
