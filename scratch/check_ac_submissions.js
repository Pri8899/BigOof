const axios = require('axios');

const KENKOOOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
  'Origin':     'https://kenkoooo.com',
  'Referer':    'https://kenkoooo.com/atcoder/'
};

async function testSubmissions(handle) {
  try {
    const res = await axios.get(
      `https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions?user=${handle}&from_second=0`,
      { timeout: 8000, headers: KENKOOOO_HEADERS }
    );
    console.log(`Handle: ${handle} | Submissions status: ${res.status} | Data length: ${res.data ? res.data.length : 'N/A'}`);
  } catch (err) {
    console.error(`Handle: ${handle} | Submissions Error: ${err.message}`);
  }
}

testSubmissions('_yasir_newb_');
