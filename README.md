# 🏆 Ultimate Competitive Programming Discord Bot

Welcome to the most advanced, fully autonomous **Competitive Programming (CP)** Discord Bot ever built. Powered by **Discord.js v14**, **SQLite**, and a highly robust background cron ecosystem, this bot acts as the central hub for any serious CP community.

By deeply integrating with the **Codeforces** and **AtCoder** APIs, this bot is designed to replace manual moderation, manual contest tracking, and manual leaderboard management. It gamifies the competitive programming experience, tracks daily solving streaks natively, and brings an unmatched level of automation to your server.

---

## 🌟 Comprehensive Feature Breakdown

### 1. 📡 Minute-by-Minute Live Submission Feed & Streak Tracking
The heart of the bot's engagement. Every 60 seconds, the bot silently polls the Codeforces and AtCoder API for every linked user in your server.
* **Instant AC Announcements:** The moment a user gets an `Accepted` (AC) verdict, the bot blasts an embed in the Feed channel celebrating their solve.
* **Native Streak Calculation:** The bot automatically calculates and updates a user's daily problem-solving streak. Streaks are natively bound to the **UTC+6 (Dhaka)** timezone, ensuring that the day rolls over at midnight exactly when users expect it to.
* **Milestone Roles:** When users hit streak milestones (e.g., 7 Days, 15 Days, 30 Days), the bot dynamically celebrates and could theoretically assign specific server roles.

### 2. 📊 Fully Autonomous Dashboard & Leaderboard
Say goodbye to updating Google Sheets or typing manual commands. The bot maintains a live Dashboard channel.
* **The 9:00 AM Sync:** Every single morning at 9:00 AM, the bot initiates a server-wide API crawl. It updates ratings, total solved counts, and crucially checks if anyone lost their streak overnight.
* **Instant Re-renders:** If a user solves a problem at 2:00 PM, their solved count and streak are updated on the dashboard within 60 seconds.
* **Smart Sorting:** Users are ranked on the leaderboard by Codeforces Rating, then AtCoder Rating, and then Total Solved count.

### 3. 📅 Dynamic Contest Radar
A dedicated channel that acts as a living, breathing contest schedule.
* **Hourly Polling:** Every hour, the bot queries Codeforces and AtCoder for upcoming contests.
* **Smart Rescheduling:** If Codeforces delays a contest (which happens often) or changes its name, the bot instantly detects this and updates the database without duplicating entries.
* **Pre-Contest Pings:** The bot automatically sends a reminder ping to the channel exactly **24 hours** before, and **1 hour** before a contest begins.

### 4. 🎭 Auto-Syncing Rank Roles
Your server role hierarchy is completely automated.
* **Dynamic Hex Colors:** The bot automatically creates Discord roles that exactly match the official Codeforces colors (e.g., `#AA0000` for Legendary Grandmaster, `#03A89E` for Specialist).
* **Auto-Assignment:** When a user links their account or their rating changes after a contest, the bot instantly strips their old role and assigns their new rank role.

### 5. 🩸 Daily Challenges & First Blood System
To keep the server active every single day, the bot runs a Daily Challenge system.
* **The 9:00 PM Drop:** Every night at 9:00 PM, the bot drops exactly 3 Codeforces problems (scaled by difficulty, typically 800, 1000, 1200 rating).
* **First Blood:** The bot monitors these specific 3 problems. The very first person to solve one of them receives a special "First Blood 🩸" announcement in the channel.

### 6. ⚔️ The Versus (`/vs`) Matchmaking System
Gamify training with live 1v1 or group duels.
* **Instant Lobbies:** A user runs `/vs create <rating> <duration>`, and the bot generates a matchmaking lobby.
* **Algorithmically Fair:** Once started, the bot fetches random Codeforces problems matching the exact requested rating that *no participant has ever solved before*.
* **Live Scoreboard:** The bot tracks the match live, issuing points for solves and applying point penalties for wrong attempts (WA/TLE).

### 7. 🏁 Virtual Contests (`/vc`)
Run server-wide virtual contests directly in Discord.
* **Pomodoro-Style Tracking:** Run `/vc-start <duration> <difficulty>`, and the bot pulls a curated list of problems.
* **Individual or Team Mode:** Participants can join solo or form teams. The bot tracks finish times and solve counts, posting a final scoreboard when the timer hits zero.

### 8. 🧠 Graph-Theory Team Builder
Preparing for ICPC? The bot includes an advanced Team Builder.
* **DFS Tag Matching:** The bot analyzes the historical solved tags (e.g., Math, Dynamic Programming, Graphs) of every member.
* **Perfect Balance:** Using a Depth-First Search algorithm, it partitions the server into 3-person teams ensuring that each team has a balanced spread of distinct skill sets (e.g., pairing a math expert with a graph theory expert).

### 9. 📈 Advanced Analytics & Profiling
A suite of commands for deep-diving into user stats.
* **`/profile`**: View current ratings, peak ratings, exact solve counts, and active streaks across all platforms in one beautiful embed.
* **`/graph`**: Generates a high-quality 2D line graph image of a user's entire Codeforces rating history directly in the chat.
* **`/skills`**: Renders a custom Radar Chart image mapping out a user's proficiency across various Codeforces tags.
* **`/whosolved`**: Stuck on a problem? Paste the link, and the bot will scan the entire server's database to tell you exactly who has solved it so you can ask them for a hint.

---

## ⚙️ The Autonomy Engine (Cron Architecture)

The bot operates on a meticulously designed event loop architecture using `node-cron` and `setInterval` to ensure it never hits API rate limits.

| Routine | File | Frequency | Action |
|---|---|---|---|
| **Live Feed** | `submissionFeed.js` | Every 60s | Scans for recent ACs, updates streaks natively, posts to Feed channel. |
| **First Blood** | `dailyChallenge.js` | Every 5m | Specifically polls the 3 Daily Problems for the first solver. |
| **Radar Sync** | `contestFetcher.js` | Hourly at `:00` | Refreshes upcoming Codeforces/AtCoder contests and updates the pinned schedule. |
| **Morning Sync** | `ratingSync.js` | 9:00 AM Daily | Full server database crawl. Refreshes the Dashboard, updates roles, breaks dead streaks. |
| **Daily Drop** | `dailyChallenge.js` | 9:00 PM Daily | Curates and posts the 3 Daily Challenge problems. |
| **Weekly Wrap** | `weeklyWrapup.js` | Sun 11:59 PM | Calculates the highest rating gainers and most problems solved for the week. |
| **VS Poller** | `vsPoller.js` | Every 30s | Updates live scoreboards for active Versus Matches. |

---

## 🛠️ Database Schema Overview (SQLite)

The bot uses `better-sqlite3` in WAL (Write-Ahead Logging) mode for lightning-fast, synchronous reads/writes.

* **`users`**: Maps `discord_id` to `cf_handle` and `ac_handle`.
* **`ratings`**: Caches current rating, max rating, and total solved counts.
* **`streaks`**: Tracks `current_streak`, `max_streak`, and `last_active_date`.
* **`notified_contests`**: Stores the Contest Radar. Uses `ON CONFLICT DO UPDATE` to gracefully handle Codeforces rescheduling contests without spamming the server.
* **`vs_matches` / `vs_participants`**: Tracks active lobbies, problems, live scores, and wrong attempt penalties.
* **`daily_problems`**: Caches today's problem IDs and the IDs of the members who claimed First Blood.

---

## 🚀 Setup & Deployment Instructions

### 1. Discord Developer Portal
1. Create a New Application on the [Discord Developer Portal](https://discord.com/developers/applications).
2. Under the **Bot** tab, **enable the following Privileged Gateway Intents**:
   - ✅ **Server Members Intent** (Required to iterate over server members for the leaderboard)
   - ✅ **Message Content Intent** (Required for reading chat)
3. Copy your **Bot Token** and **Client ID**.

### 2. Configure Your Environment (`.env`)
Clone the repository and create your `.env` file in the root directory:
```env
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_client_id_here
GUILD_ID=your_server_id_here

# Channel IDs for the autonomous loops (Copy these by right-clicking channels in Discord)
CONTEST_CHANNEL_ID=your_contest_channel_id
DASHBOARD_CHANNEL_ID=your_dashboard_channel_id
SUGGEST_CHANNEL_ID=your_suggest_channel_id
FEED_CHANNEL_ID=your_feed_channel_id
```

### 3. Deploy Slash Commands
Before booting the bot, you must register the Slash Commands with the Discord API. Run:
```bash
node deploy-commands.js
```

### 4. Start the Bot
```bash
node index.js
```

> ⚠️ **IMPORTANT: Railway / Docker Users**
> If you are hosting this bot on a platform like Railway, Render, or Docker, you **must** attach a persistent storage volume. Map your volume to the `/data` directory in the container. The bot is programmed to automatically detect the `/data` folder and store `cpbot.db` there, ensuring your leaderboards, streaks, and settings survive deployments.

---

## 📋 Full Command Glossary

### 🧑‍💻 Member Commands
| Command | Usage | Description |
|---|---|---|
| `/link` | `/link <platform> <handle>` | Instantly links your account, updates the dashboard, and assigns your rank role. |
| `/unlink` | `/unlink <platform>` | Removes your linked account and purges your history from the leaderboard. |
| `/profile` | `/profile [@user]` | View an elegant summary of your CP stats and streaks. |
| `/leaderboard` | `/leaderboard` | Spawns an on-demand, static view of the server leaderboard. |
| `/contests` | `/contests [platform]` | Fetch the upcoming contests list directly to your screen (doesn't ping the channel). |
| `/whosolved` | `/whosolved <link>` | See exactly who in the server has solved a specific Codeforces problem. |
| `/suggest` | `/suggest [tag] [difficulty]` | Force the bot to give you custom problem recommendations on demand. |
| `/graph` | `/graph <handle>` | Generates a 2D line graph of a Codeforces rating history. |
| `/skills` | `/skills <handle>` | Renders a radar chart analyzing a user's strongest problem tags. |

### 🎮 Gamification Commands
| Command | Usage | Description |
|---|---|---|
| `/vs create` | `/vs create <rating> <duration>` | Start a live matchup on perfectly rated CF problems. |
| `/vs join` | `/vs join <match_id>` | Join a pending match lobby before the creator starts it. |
| `/vc-start` | `/vc-start <duration> <difficulty>` | Starts a server-wide Virtual Contest. |
| `/vc-join` | `/vc-join` | Joins the currently active virtual contest in the channel. |
| `/vc-end` | `/vc-end` | Force-ends the current virtual contest early. |
| `/build-teams`| `/build-teams` | Generates balanced 3-person ICPC teams based on historical tags. |

### ⚙️ Admin Setup Commands
| Command | Usage | Description |
|---|---|---|
| `/admin` | `/admin set-channel <type> #channel` | Sets where specific bot modules (feed, radar, daily) post. |

---

*Built with ❤️ to push the limits of Competitive Programming communities.*
