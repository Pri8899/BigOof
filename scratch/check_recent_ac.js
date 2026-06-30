const axios = require('axios');

const KENKOOOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36'
};

async function getRecentAC() {
  try {
    const res = await axios.get(
      'https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions?user=ImposterBhO0&from_second=0',
      { headers: KENKOOOO_HEADERS }
    );
    if (Array.isArray(res.data)) {
      const sorted = res.data.sort((a, b) => b.epoch_second - a.epoch_second);
      console.log("Recent AtCoder submissions:");
      sorted.slice(0, 5).forEach(s => {
        console.log(`- Problem: ${s.problem_id} | Verdict: ${s.result} | Time: ${new Date(s.epoch_second * 1000).toISOString()}`);
      });
    } else {
      console.log("Response is not an array:", res.data);
    }
  } catch (err) {
    console.error("Error:", err.message);
  }
}

getRecentAC();
