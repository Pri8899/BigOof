const axios = require('axios');

const KENKOOOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36'
};

async function getSubmissions() {
  try {
    const res = await axios.get(
      'https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions?user=ImposterBhO0&from_second=0',
      { headers: KENKOOOO_HEADERS }
    );
    if (Array.isArray(res.data)) {
      console.log("Total submissions returned:", res.data.length);
      const solved = new Set();
      const acSubs = res.data.filter(s => s.result === 'AC');
      console.log("Total AC submissions:", acSubs.length);
      acSubs.forEach(s => {
        solved.add(s.problem_id);
      });
      console.log("Unique solved problems count:", solved.size);
      console.log("Unique solved problems list:", Array.from(solved));
    } else {
      console.log("Response is not an array:", res.data);
    }
  } catch (err) {
    console.error("Error:", err.message);
  }
}

getSubmissions();
