// utils/toph.js — Toph contest, profile, streak, and submission scraper
const axios = require('axios');
const { calculateStreakFromTimestamps } = require('./time');

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Referer': 'https://toph.co'
};

async function tophGet(url, options = {}, retries = 3) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      return await axios.get(url, { timeout: 25000, headers: BROWSER_HEADERS, ...options });
    } catch (err) {
      lastErr = err;
      const delay = 2000 * (i + 1);
      console.warn(`[Toph] Request to ${url} failed (attempt ${i + 1}/${retries}): ${err.message}. Retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/**
 * Scrape upcoming contests from toph.co/contests. Throws on network failure when `throwOnError` is true.
 */
async function getTophContests(throwOnError = false) {
  try {
    const res = await tophGet('https://toph.co/contests', { timeout: 15000 }, 2);
    const html = String(res.data || '');
    const now = Math.floor(Date.now() / 1000);
    const contests = [];
    const seenIds = new Set();

    const cardRegex = /<a[^>]*href=["']?\/c\/([^"'\s>]+)["']?[\s\S]*?<div class=ccard__bannertitle>([\s\S]*?)<\/div>[\s\S]*?<div class=ccard__bannermeta>([\s\S]*?)<\/div>[\s\S]*?data-timestamp=(\d+)/g;
    let m;
    while ((m = cardRegex.exec(html)) !== null) {
      const contestSlug = m[1].trim();
      const name = m[2].replace(/<[^>]+>/g, '').trim();
      const meta = m[3].replace(/<[^>]+>/g, '').trim();
      const startTime = parseInt(m[4], 10);

      if (!startTime || Number.isNaN(startTime) || startTime <= now) continue;

      let durationSec = 7200;
      const minMatch = meta.match(/(\d+)\s*minute/i);
      const hrMatch = meta.match(/(\d+)\s*hour/i);
      if (hrMatch || minMatch) {
        durationSec = 0;
        if (hrMatch) durationSec += parseInt(hrMatch[1], 10) * 3600;
        if (minMatch) durationSec += parseInt(minMatch[1], 10) * 60;
      }

      const id = `toph_${contestSlug}`;
      if (!seenIds.has(id)) {
        seenIds.add(id);
        contests.push({
          id,
          platform: 'Toph',
          name,
          startTime,
          durationSec,
          url: `https://toph.co/c/${contestSlug}`
        });
      }
    }

    const deckRegex = /<a[^>]*href=["']?\/c\/([^"'\s>]+)["']?[^>]*>([\s\S]*?)<\/a>[\s\S]*?data-timestamp=(\d+)/g;
    while ((m = deckRegex.exec(html)) !== null) {
      const contestSlug = m[1].trim();
      const name = m[2].replace(/<[^>]+>/g, '').trim();
      const startTime = parseInt(m[3], 10);
      const id = `toph_${contestSlug}`;

      if (!startTime || Number.isNaN(startTime) || startTime <= now) continue;
      if (seenIds.has(id)) continue;

      seenIds.add(id);
      contests.push({
        id,
        platform: 'Toph',
        name,
        startTime,
        durationSec: 7200,
        url: `https://toph.co/c/${contestSlug}`
      });
    }

    contests.sort((a, b) => a.startTime - b.startTime);
    console.log(`[Toph] Scraped ${contests.length} upcoming contests from toph.co`);
    return contests;
  } catch (err) {
    console.error('[Toph] Scrape error:', err.message);
    if (throwOnError) throw err;
    return [];
  }
}

async function validateTophHandle(handle) {
  try {
    const encoded = encodeURIComponent(handle);
    const res = await tophGet(`https://toph.co/u/${encoded}`, {
      timeout: 10000,
      validateStatus: status => status < 500
    }, 2);
    if (res.status !== 200) return false;
    const html = String(res.data || '');
    return !/page\s+not\s+found|404\s+not\s+found/i.test(html);
  } catch (err) {
    console.error(`[Toph] Validate handle error for ${handle}:`, err.message);
    return false;
  }
}

async function getTophUser(handle) {
  try {
    const res = await tophGet(`https://toph.co/u/${encodeURIComponent(handle)}`);
    const html = String(res.data || '');

    let rating = 0;
    const ratingMatch = html.match(/class="[^"]*rating[^"]*"[^>]*>\s*(\d+)/i) ||
                        html.match(/"currentRating"\s*:\s*(\d+)/i) ||
                        html.match(/Rating[^<]*<\/[^>]+>\s*<[^>]+>\s*(\d+)/i);
    if (ratingMatch) rating = parseInt(ratingMatch[1], 10) || 0;

    let rankTitle = 'Unrated';
    const rankMatch = html.match(/currentRatingLabel['"]\s*:\s*['"]([^'"]+)['"]/i) ||
                      html.match(/class="[^"]*handle[^"]*-([a-z]+)"/i);
    if (rankMatch) rankTitle = rankMatch[1];

    let solved = 0;
    const solvedMatch = html.match(/class="?dashlet__stat"?>(?:<[^>]+>)*\s*(\d+)\s*\/\s*\d+(?:<[^>]+>)*\s*<\/div>\s*Problems Solved/i) ||
                        html.match(/(\d+)\s*(?:problem|Problem)s?\s*(?:solved|Solved)/i) ||
                        html.match(/Solved[^<]*<[^>]+>\s*(\d+)/i);
    if (solvedMatch) solved = parseInt(solvedMatch[1], 10) || 0;

    return { rating, max_rating: rating, rank_title: rankTitle, solved, acceptance: 0 };
  } catch (err) {
    console.error(`[Toph] Get user error for ${handle}:`, err.message);
    return null;
  }
}

async function calculateTophStreak(handle) {
  try {
    const res = await tophGet(`https://toph.co/u/${encodeURIComponent(handle)}`);
    const html = String(res.data || '');

    const activitiesPanelMatch = html.match(/\bActivities\b[\s\S]*?<div class=flow-sm>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/);
    if (!activitiesPanelMatch) return { current: 0, max: 0 };

    const activitiesHtml = activitiesPanelMatch[1];
    const itemRegex = /<div class="fg-1 fs-1 fb-0">([\s\S]*?)<\/div>\s*<div[^>]*>\s*<span[^>]*data-timestamp=(\d+)[^>]*>/g;
    const timestamps = [];
    let m;
    while ((m = itemRegex.exec(activitiesHtml)) !== null) {
      const inner = m[1].trim();
      const timestamp = parseInt(m[2], 10);
      if (!inner.startsWith('Solved ')) continue;
      if (!timestamp || Number.isNaN(timestamp)) continue;
      timestamps.push(timestamp);
    }

    const { current, max } = calculateStreakFromTimestamps(timestamps);
    console.log(`[Toph Streak] ${handle}: current=${current}, max=${max}`);
    return { current, max };
  } catch (err) {
    console.error(`[Toph Streak] Error for ${handle}:`, err.message);
    return { current: 0, max: 0 };
  }
}

const _problemDetailsCache = new Map();

async function getTophProblemDetails(slug, hintContestName = null) {
  if (_problemDetailsCache.has(slug)) return _problemDetailsCache.get(slug);

  const result = { difficulty: 0, tags: [], contestName: hintContestName || 'Practice' };
  try {
    const res = await tophGet(`https://toph.co/p/${encodeURIComponent(slug)}`);
    const html = String(res.data || '');

    const pointsMatch =
      html.match(/([\d,]+)\s*Points?/i) ||
      html.match(/difficulty[^>]*>\s*([\d,]+)/i) ||
      html.match(/score["']?\s*:\s*(\d+)/i);
    if (pointsMatch) {
      result.difficulty = parseInt(pointsMatch[1].replace(/,/g, ''), 10) || 0;
    }

    const tagMatches = [...html.matchAll(/class="[^"]*(?:label|tag)[^"]*"[^>]*>\s*([^<]{1,40})\s*<\/a>/gi)];
    for (const t of tagMatches) {
      const tag = t[1].trim();
      if (tag && tag.length > 1 && !result.tags.includes(tag)) result.tags.push(tag);
    }
    result.tags = result.tags.slice(0, 5);

    if (!hintContestName) {
      const contestMatch = html.match(/href=["']?\/c\/([a-z0-9_-]+)["']?[^>]*>([^<]{2,80})<\/a>/i);
      if (contestMatch) {
        result.contestName = contestMatch[2].trim();
      }
    }

    _problemDetailsCache.set(slug, result);
  } catch (err) {
    console.warn(`[Toph] Could not fetch problem details for ${slug}: ${err.message}`);
  }
  return result;
}

async function fetchTophSubmissions(user) {
  if (!user.toph_handle) return [];
  const { db } = require('../database/db');
  try {
    const encoded = encodeURIComponent(user.toph_handle);
    const res = await tophGet(`https://toph.co/u/${encoded}`);
    const html = String(res.data || '');

    const activitiesPanelMatch = html.match(/\bActivities\b[\s\S]*?<div class=flow-sm>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/);
    if (!activitiesPanelMatch) return [];
    const activitiesHtml = activitiesPanelMatch[1];

    const itemRegex = /<div class="fg-1 fs-1 fb-0">([\s\S]*?)<\/div>\s*<div[^>]*>\s*<span[^>]*data-timestamp=(\d+)[^>]*>/g;
    let m;
    const newSubs = [];
    const now = Math.floor(Date.now() / 1000);

    while ((m = itemRegex.exec(activitiesHtml)) !== null) {
      const inner = m[1].trim();
      const timestamp = parseInt(m[2], 10);

      if (!inner.startsWith('Solved ')) continue;
      if (!timestamp || timestamp < now - 10800) continue;

      let slug, name, url;
      const linkMatch = inner.match(/Solved\s+<a\s+href=["']?\/(?:problems|p)\/([^"'\s>]+)["']?[^>]*>([^<]+)<\/a>/);
      if (linkMatch) {
        slug = linkMatch[1].trim();
        name = linkMatch[2].trim();
        url = `https://toph.co/p/${slug}`;
      } else {
        const plainMatch = inner.match(/^Solved\s+(.+?)\.?$/);
        if (!plainMatch) continue;
        name = plainMatch[1].replace(/<[^>]+>/g, '').trim();
        slug = `private_${timestamp}`;
        url = `https://toph.co/u/${encoded}`;
      }

      const uniqueId = slug.startsWith('private_')
        ? `toph_prob_${user.discord_id}_${slug}_${timestamp}`
        : `toph_prob_${user.discord_id}_${slug}`;

      const existing = db.prepare('SELECT 1 FROM processed_submissions WHERE id = ?').get(uniqueId);
      if (!existing) {
        let activityContestName = null;
        const contestInMatch = inner.match(/\bin\s+<a[^>]*>([^<]{2,120})<\/a>/i);
        if (contestInMatch) activityContestName = contestInMatch[1].trim();

        let difficulty = 0;
        let tags = [];
        let contestName = activityContestName || 'Practice';
        if (slug && !slug.startsWith('private_')) {
          try {
            const details = await getTophProblemDetails(slug, activityContestName);
            difficulty = details.difficulty;
            tags = details.tags;
            contestName = details.contestName;
          } catch (_) {}
        }
        if (slug.startsWith('private_') && activityContestName) {
          contestName = activityContestName;
        }

        newSubs.push({ id: uniqueId, name, url, difficulty, tags, contestName, timestamp, dedupKey: uniqueId });
      }
    }

    return newSubs.sort((a, b) => a.timestamp - b.timestamp);
  } catch (err) {
    console.error(`[Toph] fetchTophSubmissions error for ${user.toph_handle}:`, err.message);
    return [];
  }
}

module.exports = {
  getTophContests,
  validateTophHandle,
  getTophUser,
  calculateTophStreak,
  fetchTophSubmissions,
  getTophProblemDetails
};
