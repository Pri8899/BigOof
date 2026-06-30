require('dotenv').config();
const { getAllUsers } = require('../database/db');
const axios = require('axios');

async function check() {
  const users = getAllUsers();
  console.log(`Checking recent submissions for all ${users.length} users...`);
  
  for (const user of users) {
    if (user.cf_handle) {
      try {
        const res = await axios.get(`https://codeforces.com/api/user.status?handle=${user.cf_handle}&from=1&count=5`, { timeout: 8000 });
        if (res.data.status === 'OK') {
          console.log(`\nUser: ${user.username} (CF Handle: ${user.cf_handle})`);
          res.data.result.forEach(s => {
            if (s.verdict === 'OK') {
              console.log(`- CF Solved: ${s.problem.name} | Time: ${new Date(s.creationTimeSeconds * 1000).toISOString()}`);
            }
          });
        }
      } catch (err) {
        console.error(`Error for ${user.username} (CF):`, err.message);
      }
    }
    
    if (user.ac_handle) {
      try {
        const res = await axios.get(`https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions?user=${user.ac_handle}&from_second=${Math.floor(Date.now()/1000) - 5*24*3600}`, { timeout: 8000 });
        if (Array.isArray(res.data) && res.data.length > 0) {
          console.log(`\nUser: ${user.username} (AC Handle: ${user.ac_handle})`);
          res.data.forEach(s => {
            if (s.result === 'AC') {
              console.log(`- AC Solved: ${s.problem_id} | Time: ${new Date(s.epoch_second * 1000).toISOString()}`);
            }
          });
        }
      } catch (err) {
        console.error(`Error for ${user.username} (AC):`, err.message);
      }
    }
  }
}

check();
