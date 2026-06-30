const { db } = require('../database/db');

console.log("=== USERS ===");
console.log(db.prepare('SELECT * FROM users').all());

console.log("=== RATINGS ===");
console.log(db.prepare('SELECT * FROM ratings').all());

console.log("=== LAST SUBMISSIONS ===");
console.log(db.prepare('SELECT * FROM last_submissions').all());
