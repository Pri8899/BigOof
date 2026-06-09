const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, '..', 'cpbot.db');
console.log('Opening DB at:', dbPath);
const db = new Database(dbPath);

try {
  const users = db.prepare('SELECT * FROM users').all();
  console.log('--- USERS ---');
  console.log(JSON.stringify(users, null, 2));
} catch (e) {
  console.error('Failed to query users:', e.message);
}

try {
  const ratings = db.prepare('SELECT * FROM ratings').all();
  console.log('--- RATINGS ---');
  console.log(JSON.stringify(ratings, null, 2));
} catch (e) {
  console.error('Failed to query ratings:', e.message);
}

try {
  const lastSub = db.prepare('SELECT * FROM last_submissions').all();
  console.log('--- LAST SUBMISSIONS ---');
  console.log(JSON.stringify(lastSub, null, 2));
} catch (e) {
  console.error('Failed to query last_submissions:', e.message);
}

try {
  const guildConfig = db.prepare('SELECT * FROM guild_config').all();
  console.log('--- GUILD CONFIG ---');
  console.log(JSON.stringify(guildConfig, null, 2));
} catch (e) {
  console.error('Failed to query guild_config:', e.message);
}
