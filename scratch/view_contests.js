const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, '..', 'cpbot.db'));

const rows = db.prepare("SELECT * FROM cf_contest_cache").all();
console.log("Total cached contests:", rows.length);

console.log("=== Educational ===");
console.log(rows.filter(r => r.name.toLowerCase().includes('educational')).slice(0, 10));

console.log("=== Global ===");
console.log(rows.filter(r => r.name.toLowerCase().includes('global')).slice(0, 10));

console.log("=== Div. 1 + Div. 2 ===");
console.log(rows.filter(r => r.name.toLowerCase().includes('div. 1 + div. 2') || r.name.toLowerCase().includes('div 1 + div 2')).slice(0, 10));
