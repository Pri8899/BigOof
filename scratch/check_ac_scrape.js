const axios = require('axios');

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
  'Accept':     'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Referer':    'https://atcoder.jp'
};

async function testProfile(handle) {
  try {
    const res = await axios.get(`https://atcoder.jp/users/${handle}`, {
      timeout: 10000,
      headers: BROWSER_HEADERS
    });
    const html = res.data;
    const linkRegex = /href="([^"]*)"/g;
    let m;
    const links = new Set();
    while ((m = linkRegex.exec(html)) !== null) {
      links.add(m[1]);
    }
    console.log('--- All Links in Profile ---');
    console.log(Array.from(links));
  } catch (err) {
    console.error(err);
  }
}

testProfile('ImposterBhO0');
