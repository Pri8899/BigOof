// utils/codeforces.js — Codeforces API wrapper
const axios = require('axios');

const CF_BASE = 'https://codeforces.com/api';

/**
 * Fetch user info from Codeforces
 * @param {string} handle
 * @returns {{ rating, maxRating, rankTitle, solved }} or null
 */
async function getCFUser(handle) {
  try {
    const infoRes = await axios.get(`${CF_BASE}/user.info?handles=${handle}`, { timeout: 8000 });
    if (infoRes.data.status !== 'OK') return null;
    const user = infoRes.data.result[0];

    // Count accepted submissions
    let solved = 0;
    try {
      const subRes = await axios.get(
        `${CF_BASE}/user.status?handle=${handle}&from=1&count=10000`,
        { timeout: 10000 }
      );
      if (subRes.data.status === 'OK') {
        const seen = new Set();
        for (const sub of subRes.data.result) {
          if (sub.verdict === 'OK' && sub.problem) {
            const key = `${sub.problem.contestId}-${sub.problem.index}`;
            seen.add(key);
          }
        }
        solved = seen.size;
      }
    } catch (_) { /* ignore solve count errors */ }

    let lastContest = null;
    try {
      const ratingRes = await axios.get(`${CF_BASE}/user.rating?handle=${handle}`, { timeout: 6000 });
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
    const res = await axios.get(`${CF_BASE}/contest.list?gym=false`, { timeout: 8000 });
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
    const res = await axios.get(`${CF_BASE}/user.info?handles=${handle}`, { timeout: 6000 });
    return res.data.status === 'OK';
  } catch {
    return false;
  }
}

/**
 * Fetch CF problems filtered by rating range and optional tag
 * @param {number} minRating
 * @param {number} maxRating
 * @param {string|null} tag
 * @param {number} count - how many to return
 */
async function getCFProblems(minRating = 800, maxRating = 3500, tag = null, count = 5) {
  try {
    const url = tag
      ? `${CF_BASE}/problemset.problems?tags=${encodeURIComponent(tag)}`
      : `${CF_BASE}/problemset.problems`;
    const res = await axios.get(url, { timeout: 10000 });
    if (res.data.status !== 'OK') return [];

    let problems = res.data.result.problems.filter(p =>
      p.rating >= minRating && p.rating <= maxRating
    );

    // Shuffle and pick
    problems = problems.sort(() => Math.random() - 0.5).slice(0, count);

    return problems.map(p => ({
      id:         `${p.contestId}${p.index}`,
      name:       p.name,
      rating:     p.rating ?? '?',
      tags:       (p.tags ?? []).slice(0, 4),
      url:        `https://codeforces.com/problemset/problem/${p.contestId}/${p.index}`,
      contestId:  p.contestId,
      index:      p.index
    }));
  } catch (err) {
    console.error('[CF] Problem fetch error:', err.message);
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

module.exports = { getCFUser, getCFContests, validateCFHandle, getCFProblems, checkCFSolved };

