const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, '..', 'cpbot.db'));

console.log("=== USERS ===");
console.log(db.prepare("SELECT * FROM users").all());

console.log("=== RATINGS ===");
console.log(db.prepare("SELECT * FROM ratings").all());
