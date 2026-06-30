const axios = require('axios');

async function test() {
  try {
    const res = await axios.get('https://atcoder.jp/contests/abc326/submissions?f.User=_yasir_newb_', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36'
      }
    });
    console.log(res.data.substring(0, 4000));
  } catch (err) {
    console.error(err);
  }
}

test();
