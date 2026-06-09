const axios = require('axios');

async function check() {
  try {
    const res1 = await axios.get('https://codeforces.com/api/user.info?handles=_yasirnewb');
    console.log('_yasirnewb rating:', res1.data.result[0].rating);
  } catch (e) {
    console.error('_yasirnewb failed:', e.message);
  }

  try {
    const res2 = await axios.get('https://codeforces.com/api/user.info?handles=_yasir_newb_');
    console.log('_yasir_newb_ rating:', res2.data.result[0].rating);
  } catch (e) {
    console.error('_yasir_newb_ failed:', e.message);
  }
}

check();
