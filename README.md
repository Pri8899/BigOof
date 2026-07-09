# 🏆 CP-Bot: Ultimate Competitive Programming Discord Bot

A completely autonomous, highly-advanced Discord bot designed specifically for Competitive Programming communities. Built with **Discord.js v14**, **SQLite**, and powered by a highly modular background cron system.

This bot connects seamlessly to **Codeforces** and **AtCoder**, tracking user ratings, live submissions, managing streaks, and organizing server-wide leaderboards without any manual intervention required.

---

## ✨ Core "Superman" Features

- 🎭 **Auto Rank Roles** — Automatically creates and assigns exact Codeforces rank roles (e.g., *Newbie*, *Pupil*, *Expert*) and their exact official hex colors to server members based on their synced ratings.
- 🩸 **Daily Challenge & First Blood** — Every day at 9:00 PM, the bot posts exactly three Codeforces problems (Rating 800, 1000, 1200). The bot monitors submissions live and blasts a **"First Blood"** announcement when the first member solves a problem.
- 📡 **Live Submission Feed** — Automatically polls every member's recent Codeforces and AtCoder activity. When a member gets an "Accepted" verdict, the bot immediately posts the achievement in the general lobby and updates their live daily streak!
- 📊 **Hands-Off Dashboard & Leaderboard** — A 100% autonomous leaderboard that ranks your server members based on their ratings, solved counts, and active daily streaks. The bot force-updates it exactly at 9:00 AM every morning and instantly upon new account linkages or live AC verdicts.
- 🔥 **Daily Streak Tracking** — Computes and maintains Codeforces and AtCoder problem-solving streaks natively. The bot computes activity based on your local timezone and automatically awards special milestone streak roles (e.g., 7 Days, 15 Days, 30 Days).
- 📅 **Contest Radar** — An hourly-updated, pinned message that cleanly displays upcoming contests from Codeforces and AtCoder. The radar handles contest rescheduling dynamically and alerts members at the 24h and 1h marks.
- ⚔️ **Versus Matches (`/vs`)** — Start live 1v1 or group duels on Codeforces problems directly in your server. The bot creates a match, assigns perfectly rated problems, and tracks who solves them first within the time limit.
- 🏁 **Virtual Contests (`/vc`)** — Start server-wide virtual contests. Members can type `/vc join` and the bot will track everyone's progress and finish times in real-time.
- 🔎 **Who Solved It? (`/whosolved`)** — Paste a Codeforces problem link, and the bot will instantly search the server and tell you exactly which members have solved that problem, so you know who to ask for hints!
- 🗓️ **Weekly Wrap-Up** — Every Sunday at midnight, the bot analyzes the server's weekly statistics and posts a beautiful summary of who solved the most problems and who gained the most rating points.
- 🧠 **AI Team Builder** — Uses an advanced graph traversal algorithm (DFS) to build perfectly balanced, multi-skill 3-person teams for ICPC and Codeforces team contests based on members' top tags (e.g., Math, DP, Graphs).
- 📈 **Visual Progress Graphs** — Generates a 2D line-graph image directly in Discord showing a member's Codeforces rating history over time.

---

## ⚙️ How It Works (Autonomy)

Once the initial setup is complete, the bot requires **zero administrative effort**.

1. **New Members Join:** They use `/link codeforces <handle>`.
2. **Instant Sync:** The bot instantly fetches their data, updates the database, creates their rank role, updates the dashboard, and fetches their current streaks.
3. **Daily Routine:**
   - **9:00 AM:** Full leaderboard and streak refresh (to break inactive streaks).
   - **9:00 PM:** Daily problem suggestions are posted.
4. **Hourly Routine:**
   - Every hour exactly on the hour, the bot checks for new contests and refreshes the pinned Contest Radar.
5. **Minute-by-Minute Routine:**
   - Every 60 seconds, the bot checks for new Accepted submissions to post in the Live Feed and instantly updates the solver's streak.
   - Constantly watches live Versus matches and Virtual Contests for scoreboard updates.

---

## 🛠️ Setup Instructions

### 1. Discord Developer Portal
1. Go to [Discord Developer Portal](https://discord.com/developers/applications) and create a New Application.
2. Under the **Bot** tab, enable the following Privileged Gateway Intents:
   - ✅ Server Members Intent
   - ✅ Message Content Intent
3. Copy your **Bot Token** and **Client ID**.

### 2. Configure Environment (`.env`)
Clone the repository and create your `.env` file:
```env
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_client_id_here
GUILD_ID=your_server_id_here

# Channel IDs for the autonomous posts
CONTEST_CHANNEL_ID=your_contest_channel_id
DASHBOARD_CHANNEL_ID=your_dashboard_channel_id
SUGGEST_CHANNEL_ID=your_suggest_channel_id
FEED_CHANNEL_ID=your_feed_channel_id
```

### 3. Deploy Commands & Run
Register the slash commands with Discord:
```bash
node deploy-commands.js
```
Start the bot:
```bash
node index.js
```

> **Note for Railway Users:**
> Ensure you attach an **SQLite Volume** to your service in Railway, mapped to `/data` or `/app/database`, so that the local SQLite database persists across deployments.

---

## 📋 Slash Commands Reference

### Member Commands
| Command | Description |
|---|---|
| `/link <platform> <handle>` | Instantly links your account, updates the dashboard, and assigns your rank role. |
| `/unlink <platform>` | Removes your linked account. |
| `/profile [@user]` | View an elegant summary of your or someone else's CP stats. |
| `/leaderboard` | View the on-demand server leaderboard. |
| `/contests [platform]` | Fetch the upcoming contests list directly to your screen. |
| `/whosolved <link>` | See who in the server has solved a specific Codeforces problem. |
| `/suggest [tag] [difficulty]` | Force the bot to give you custom problem recommendations. |
| `/graph <handle>` | Generates a 2D line graph of a Codeforces rating history. |
| `/skills <handle>` | Analyzes a user's Codeforces history and displays a radar chart of their strongest problem tags. |

### Games & Match Commands
| Command | Description |
|---|---|
| `/vs create <rating> <duration> [tag]` | Start a live 1v1/group matchup on perfectly rated CF problems. |
| `/vs join <match_id>` | Join a pending match lobby before it starts. |
| `/vc-start <duration> <difficulty>` | Starts a server-wide Virtual Contest. |
| `/vc-join` | Joins the currently active virtual contest in the channel. |
| `/vc-end` | Force-ends the current virtual contest early. |
| `/build-teams` | Generates balanced 3-person ICPC teams using Graph algorithms. |

### Admin Setup Commands
*Run these to configure which channels the autonomous loops post to.*
| Command | Description |
|---|---|
| `/admin set-channel <type> #channel` | Sets where specific bot modules (feed, radar, daily) post. |

---

## 🏗️ Architecture

- **`index.js`** — The main entry point. Registers events and spins up background crons.
- **`database/db.js`** — Fully synchronous SQLite operations using `better-sqlite3`, featuring ON CONFLICT smart updates.
- **`tasks/`** — The brain of the bot. Contains independent cron jobs (`contestFetcher.js`, `dailyChallenge.js`, `ratingSync.js`, `submissionFeed.js`, `vsPoller.js`).
- **`utils/`** — API wrappers for Codeforces and AtCoder, plus the master `embeds.js` file for UI consistency.

---

## 📡 APIs Used
- **Codeforces:** Official API (`https://codeforces.com/api/`)
- **AtCoder:** Kenkoooo Unofficial API (`https://kenkoooo.com/atcoder`)

*Built with precision to ensure no rate limits are hit by employing sequential delays, request batching, and optimized local caching.*
