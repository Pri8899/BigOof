const axios = require('axios');
const CF_BASE = 'https://codeforces.com/api';

function epochToDateStr(epoch, offset) {
  return new Date((epoch + offset * 3600) * 1000).toISOString().split('T')[0];
}
function todayInOffset(offset) {
  return epochToDateStr(Date.now() / 1000, offset);
}
function computeStreakFromActivity(activityMap, offset) {
  const todayStr = todayInOffset(offset);
  const todayCount = activityMap[todayStr] || 0;
  
  let streak = 0;
  let checkDate = new Date(todayStr + "T00:00:00Z");
  
  if (todayCount === 0) {
    checkDate.setUTCDate(checkDate.getUTCDate() - 1);
  }
  
  while (true) {
    const checkStr = checkDate.toISOString().split('T')[0];
    if ((activityMap[checkStr] || 0) > 0) {
      streak++;
      checkDate.setUTCDate(checkDate.getUTCDate() - 1);
    } else {
      break;
    }
  }
  return { streak, todayCount };
}

async function test(handle) {
  const res = await axios.get(`${CF_BASE}/user.status?handle=${handle}&from=1&count=2000`);
  const subs = res.data.result.filter(sub => sub.creationTimeSeconds);
  const offset = 6;
  const activityMap = {};
  for (const sub of subs) {
    const dStr = epochToDateStr(sub.creationTimeSeconds, offset);
    activityMap[dStr] = (activityMap[dStr] || 0) + 1;
  }
  console.log(computeStreakFromActivity(activityMap, offset));
}
test('tourist');
