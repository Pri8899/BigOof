const fs = require('fs');
const path = require('path');

const bgPath = path.join(__dirname, 'codesync_pro', 'background.js');
const code = fs.readFileSync(bgPath, 'utf8');

const idx = code.indexOf('GET_AC_PROFILE');
if (idx !== -1) {
  console.log('Snippet around GET_AC_PROFILE:', code.substring(idx - 100, idx + 500));
}
