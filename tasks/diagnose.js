// tasks/diagnose.js — Live diagnostic script to run on bot startup
const { db, getAllUsers, getDailyProblems } = require('../database/db');
const axios = require('axios');

function getActiveCycleWindow(activeDate) {
  const activeYear = parseInt(activeDate.toLocaleDateString('en-US', { timeZone: 'Asia/Dhaka', year: 'numeric' }), 10);
  const activeMonth = parseInt(activeDate.toLocaleDateString('en-US', { timeZone: 'Asia/Dhaka', month: 'numeric' }), 10);
  const activeDay = parseInt(activeDate.toLocaleDateString('en-US', { timeZone: 'Asia/Dhaka', day: 'numeric' }), 10);
  
  const startTimeUtc = Date.UTC(activeYear, activeMonth - 1, activeDay, 15, 0, 0) / 1000;
  const endTimeUtc = startTimeUtc + 24 * 60 * 60;
  return { startTimeUtc, endTimeUtc };
}

async function runDiagnostics(client) {
  console.log('[Diagnostics] Running live diagnostics...');
  let report = '🔍 **CP Bot Live Diagnostics** 🔍\n\n';

  try {
    // 1. Check DB Path and /data existence
    const fs = require('fs');
    const hasData = fs.existsSync('/data');
    const dbPath = db.name;
    report += `📂 **Database Info**:\n- Database Path: \`${dbPath}\`\n- \`/data\` folder exists: \`${hasData}\`\n\n`;

    // 2. Query Users
    const users = getAllUsers();
    report += `👥 **Users in DB** (${users.length}):\n`;
    for (const u of users) {
      report += `- <@${u.discord_id}> (\`${u.username}\`): CF: \`${u.cf_handle || 'None'}\`, AC: \`${u.ac_handle || 'None'}\`\n`;
    }
    report += '\n';

    // 3. Query Daily Problems
    const now = new Date();
    const formatterHour = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dhaka', hour: 'numeric', hour12: false });
    const currentHour = parseInt(formatterHour.format(now), 10);
    
    let activeDate = now;
    if (currentHour < 21) {
      activeDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }
    
    const formatterDate = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' });
    const activeDateStr = formatterDate.format(activeDate);
    
    const daily = getDailyProblems(activeDateStr);
    report += `💡 **Active Cycle**:\n- Active Date Str: \`${activeDateStr}\`\n`;
    if (daily) {
      report += `- Daily row found: \`p1: ${daily.p1_id}\`, \`p2: ${daily.p2_id}\`, \`p3: ${daily.p3_id}\`\n`;
      report += `- First Bloods: \`Easy: ${daily.first_blood_1 || 'None'}\`, \`Medium: ${daily.first_blood_2 || 'None'}\`, \`Hard: ${daily.first_blood_3 || 'None'}\`\n`;
      report += `- Sweep Announced: \`${daily.sweep_announced || '[]'}\`\n`;
    } else {
      report += `- ❌ No daily problems row found for date \`${activeDateStr}\`!\n`;
    }
    
    const { startTimeUtc, endTimeUtc } = getActiveCycleWindow(activeDate);
    const startStr = new Date(startTimeUtc * 1000).toLocaleString('en-US', { timeZone: 'Asia/Dhaka' });
    const endStr = new Date(endTimeUtc * 1000).toLocaleString('en-US', { timeZone: 'Asia/Dhaka' });
    report += `- Cycle Window: \`${startTimeUtc}\` to \`${endTimeUtc}\`\n  (Dhaka: \`${startStr}\` to \`${endStr}\`)\n\n`;

    // 3.5 Query Virtual Contests and Versus Matches
    report += `🎮 **Virtual Contests in DB**:\n`;
    try {
      const vcs = db.prepare('SELECT * FROM virtual_contests ORDER BY started_at DESC LIMIT 5').all();
      for (const vc of vcs) {
        report += `- ID: \`${vc.id}\` | Ended: \`${vc.ended}\` | Ends At: \`${vc.ends_at}\` (<t:${vc.ends_at}:R>) | Type: \`${vc.type}\` | Started By: <@${vc.started_by}>\n`;
        const vcParts = db.prepare('SELECT * FROM vc_participants WHERE vc_id = ?').all(vc.id);
        report += `  • Participants (${vcParts.length}): ` + vcParts.map(p => `<@${p.discord_id}> (\`${p.cf_handle}\`, Solved: ${p.solved})`).join(', ') + '\n';
      }
    } catch (err) {
      report += `  • Error: ${err.message}\n`;
    }
    report += '\n';

    report += `⚔️ **Versus Matches in DB**:\n`;
    try {
      const vss = db.prepare('SELECT * FROM vs_matches ORDER BY started_at DESC LIMIT 5').all();
      for (const vs of vss) {
        report += `- ID: \`${vs.id}\` | Status: \`${vs.status}\` | Creator: <@${vs.creator_id}>\n`;
      }
    } catch (err) {
      report += `  • Error: ${err.message}\n`;
    }
    report += '\n';

    // 4. Fetch Submissions for each user and analyze
    report += `📝 **Submissions Analysis**:\n`;
    for (const u of users) {
      if (!u.cf_handle) continue;
      report += `\n**Handle: \`${u.cf_handle}\`** (<@${u.discord_id}>):\n`;
      try {
        const res = await axios.get(`https://codeforces.com/api/user.status?handle=${u.cf_handle}&from=1&count=20`, { timeout: 8000 });
        if (res.data.status === 'OK') {
          const subs = res.data.result;
          let foundCount = 0;
          for (const sub of subs) {
            const pId = `${sub.problem.contestId}${sub.problem.index}`;
            const isTarget = daily && (pId === daily.p1_id || pId === daily.p2_id || pId === daily.p3_id);
            
            // Print details for target problems or the latest 3 submissions
            if (isTarget || foundCount < 3) {
              foundCount++;
              const inWindow = sub.creationTimeSeconds >= startTimeUtc && sub.creationTimeSeconds < endTimeUtc;
              const timeStr = new Date(sub.creationTimeSeconds * 1000).toLocaleString('en-US', { timeZone: 'Asia/Dhaka' });
              
              report += `- SubID: \`${sub.id}\` | Problem: \`${pId}\` | Verdict: \`${sub.verdict}\` | Time: \`${timeStr}\` (\`${sub.creationTimeSeconds}\`)\n`;
              report += `  • Match daily problems: \`${isTarget}\` | In cycle window: \`${inWindow}\`\n`;
            }
          }
        } else {
          report += `- Codeforces API returned status: \`${res.data.status}\`\n`;
        }
      } catch (err) {
        report += `- Error fetching CF submissions: ${err.message}\n`;
      }
      // Be nice to CF API
      await new Promise(r => setTimeout(r, 2000));
    }

  } catch (err) {
    report += `\n❌ **Diagnostics crashed**: ${err.message}\n${err.stack}\n`;
  }

  // Send report to #💬-general
  const generalChannelId = process.env.GENERAL_CHANNEL_ID || '1505614835650658355';
  const channel = await client.channels.fetch(generalChannelId).catch(() => null);
  if (channel) {
    // Discord message limit is 2000 chars, chunk if necessary
    if (report.length <= 2000) {
      await channel.send(report).catch(() => {});
    } else {
      const chunks = [];
      let current = '';
      const lines = report.split('\n');
      for (const line of lines) {
        if (current.length + line.length + 1 > 2000) {
          chunks.push(current);
          current = '';
        }
        current += line + '\n';
      }
      if (current) chunks.push(current);
      
      for (const chunk of chunks) {
        await channel.send(chunk).catch(() => {});
      }
    }
  }
}

module.exports = { runDiagnostics };
