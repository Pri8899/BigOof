// utils/toph.js — Toph contest scraper
const axios = require('axios');

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Referer': 'https://toph.co'
};

/**
 * Scrape upcoming contests from toph.co/contests
 */
async function getTophContests() {
  try {
    const res = await axios.get('https://toph.co/contests', {
      timeout: 15000,
      headers: BROWSER_HEADERS
    });

    const html = res.data;
    const now = Math.floor(Date.now() / 1000);
    const contests = [];

    // Extract all data-timestamp values for upcoming contests
    // Toph embeds them as: data-timestamp=XXXXXXXXXX data-timestamp-future=true
    const upcomingRegex = /data-timestamp=(\d+)\s+data-timestamp-type=human\s+data-timestamp-future=true/g;
    let m;

    // We need to find contest cards that have upcoming timestamps
    // Strategy: find each ccard block and extract name, url, duration, timestamp
    const cardRegex = /<a href="\/c\/([^"]+)"[\s\S]*?<div class=ccard__bannertitle>([\s\S]*?)<\/div>[\s\S]*?<div class=ccard__bannermeta>([\s\S]*?)<\/div>[\s\S]*?data-timestamp=(\d+)\s+data-timestamp-type=human\s+data-timestamp-future=true/g;

    while ((m = cardRegex.exec(html)) !== null) {
      const contestSlug = m[1].trim();
      const name = m[2].replace(/<[^>]+>/g, '').trim();
      const meta = m[3].replace(/<[^>]+>/g, '').trim(); // e.g. "Code Golf · Official · 40 minutes"
      const startTime = parseInt(m[4], 10);

      if (!startTime || isNaN(startTime) || startTime <= now) continue;

      // Parse duration from meta string (e.g. "40 minutes", "5 hours", "2 hours 30 minutes")
      let durationSec = 7200; // default 2h
      const minMatch = meta.match(/(\d+)\s*minute/i);
      const hrMatch = meta.match(/(\d+)\s*hour/i);
      if (hrMatch) durationSec = parseInt(hrMatch[1]) * 3600;
      if (minMatch) durationSec += parseInt(minMatch[1]) * 60;

      contests.push({
        id: `toph_${contestSlug}`,
        platform: 'Toph',
        name,
        startTime,
        durationSec,
        url: `https://toph.co/c/${contestSlug}`
      });
    }

    // Also try to catch contests listed in cdeck (smaller list items) with upcoming timestamps
    const deckRegex = /<a class=cdeck__name href=\/c\/([^>]+)>([\s\S]*?)<\/a>[\s\S]*?data-timestamp=(\d+)\s+data-timestamp-type=human\s+data-timestamp-future=true/g;
    while ((m = deckRegex.exec(html)) !== null) {
      const contestSlug = m[1].trim();
      const name = m[2].replace(/<[^>]+>/g, '').trim();
      const startTime = parseInt(m[3], 10);
      const id = `toph_${contestSlug}`;

      if (!startTime || isNaN(startTime) || startTime <= now) continue;
      if (contests.find(c => c.id === id)) continue; // skip duplicate

      contests.push({
        id,
        platform: 'Toph',
        name,
        startTime,
        durationSec: 7200,
        url: `https://toph.co/c/${contestSlug}`
      });
    }

    console.log(`[Toph] Scraped ${contests.length} upcoming contests from toph.co`);
    return contests;
  } catch (err) {
    console.error('[Toph] Scrape error:', err.message);
    return [];
  }
}

module.exports = { getTophContests };
