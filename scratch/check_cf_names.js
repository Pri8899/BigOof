const axios = require('axios');

async function check() {
  const res = await axios.get('https://codeforces.com/api/contest.list?gym=false');
  if (res.data.status === 'OK') {
    const contests = res.data.result;
    
    console.log("=== Sample Global Rounds ===");
    const globals = contests.filter(c => c.name.toLowerCase().includes('global'));
    console.log(globals.slice(0, 10).map(c => c.name));
    console.log("Do any global rounds contain 'div'? ", globals.some(c => c.name.toLowerCase().includes('div')));
    
    console.log("=== Sample Educational Rounds ===");
    const eds = contests.filter(c => c.name.toLowerCase().includes('educational'));
    console.log(eds.slice(0, 10).map(c => c.name));
    
    const edsNoDiv = eds.filter(c => !c.name.toLowerCase().includes('div'));
    console.log(`Educational rounds without 'div' in name: ${edsNoDiv.length} / ${eds.length}`);
    if (edsNoDiv.length > 0) {
      console.log("Sample Educational rounds without 'div':", edsNoDiv.slice(0, 10).map(c => c.name));
    }
  }
}

check();
