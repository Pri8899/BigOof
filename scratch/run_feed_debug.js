const axios = require('axios');
const { db, getAllUsers, getLastSubmission, setLastSubmission } = require('../database/db');

async function fetchACSubmissions(user) {
  if (!user.ac_handle) return [];
  try {
    let lastTime = getLastSubmission(user.discord_id, 'ac');
    const now = Math.floor(Date.now() / 1000);
    
    let queryTime = lastTime;
    if (queryTime === null) {
      queryTime = now - 10800; // 3 hours
    }
    
    console.log(`[AC Debug] User: ${user.username} | ac_handle: ${user.ac_handle}`);
    console.log(`[AC Debug] lastTime in DB: ${lastTime} (${lastTime ? new Date(lastTime*1000).toLocaleString() : 'null'})`);
    console.log(`[AC Debug] queryTime used: ${queryTime} (${new Date(queryTime*1000).toLocaleString()})`);

    const res = await axios.get(
      `https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions?user=${user.ac_handle}&from_second=${queryTime + 1}`,
      { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    
    console.log(`[AC Debug] API response length: ${res.data ? res.data.length : 'undefined'}`);
    if (!Array.isArray(res.data) || res.data.length === 0) {
      return [];
    }
    
    const submissions = res.data.sort((a, b) => a.epoch_second - b.epoch_second);
    let highestTime = lastTime || queryTime;
    const newAc = [];
    
    for (const sub of submissions) {
      highestTime = Math.max(highestTime, sub.epoch_second);
      console.log(`[AC Debug] Sub ID: ${sub.id} | Epoch: ${sub.epoch_second} (${new Date(sub.epoch_second*1000).toLocaleString()}) | Result: ${sub.result} | Prob: ${sub.problem_id}`);
      if (sub.result === 'AC') {
        newAc.push({
          name: `${sub.problem_id}`,
          url: `https://atcoder.jp/contests/${sub.contest_id}/tasks/${sub.problem_id}`,
          difficulty: null,
          tags: [],
          contestId: sub.contest_id
        });
      }
    }
    
    console.log(`[AC Debug] New AC count: ${newAc.length}`);
    return newAc;
  } catch (err) {
    console.error(`[AC Debug] Error:`, err.message);
    return [];
  }
}

async function run() {
  const users = getAllUsers();
  const imposter = users.find(u => u.cf_handle === 'ImposterBhO0');
  if (imposter) {
    await fetchACSubmissions(imposter);
  } else {
    console.log('User ImposterBhO0 not found in local DB');
  }
}

run();
