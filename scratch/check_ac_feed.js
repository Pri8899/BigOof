const axios = require('axios');
const { db, getAllUsers } = require('../database/db');

async function testACFeed(handle) {
  try {
    const queryTime = Math.floor(Date.now() / 1000) - 86400 * 3; // 3 days ago
    
    // First, try with simple user-agent header (as in submissionFeed.js)
    console.log('Testing with simple User-Agent...');
    try {
      const res = await axios.get(
        `https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions?user=${handle}&from_second=${queryTime}`,
        { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' } }
      );
      console.log(`Success: Found ${res.data.length} submissions.`);
    } catch (e) {
      console.error('Simple UA Failed:', e.message);
    }

    // Second, try with KENKOOOO_HEADERS (as in utils/atcoder.js)
    console.log('\nTesting with Kenkoooo Headers...');
    const KENKOOOO_HEADERS = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
      'Origin':     'https://kenkoooo.com',
      'Referer':    'https://kenkoooo.com/atcoder/'
    };
    try {
      const res = await axios.get(
        `https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions?user=${handle}&from_second=${queryTime}`,
        { timeout: 8000, headers: KENKOOOO_HEADERS }
      );
      console.log(`Success: Found ${res.data.length} submissions.`);
    } catch (e) {
      console.error('Kenkoooo Headers Failed:', e.message);
    }
  } catch (err) {
    console.error(err);
  }
}

testACFeed('ImposterBhO0');
