# 🏆 Ultimate Competitive Programming Discord Bot

A completely autonomous, highly-advanced Discord bot designed specifically for Competitive Programming communities. Built with **Discord.js v14**, **SQLite**, and powered by a highly modular background cron system.

This bot connects seamlessly to **Codeforces** and **AtCoder**, tracking user ratings, live submissions, and organizing server-wide leaderboards without any manual intervention required.

---

## ✨ "Superman" Features

- 🎭 **Auto Rank Roles** — Automatically creates and assigns exact Codeforces rank roles (e.g., *Newbie*, *Pupil*, *Expert*) and their exact official hex colors to server members based on their synced ratings.
- 🩸 **Daily Challenge & First Blood** — Every day at 9:00 PM, the bot posts exactly three Codeforces problems (Rating 800, 1000, 1200). The bot monitors submissions live and blasts a **"First Blood"** announcement when the first member solves a problem.
- 📡 **Live Submission Feed** — Automatically polls every member's recent Codeforces and AtCoder activity. When a member gets an "Accepted" verdict, the bot immediately posts the achievement in the general lobby!
- 📊 **Hands-Off Dashboard** — A 100% autonomous leaderboard that ranks your server members based on their ratings and solved counts. The bot force-updates it exactly at 9:00 AM every morning and instantly upon new account linkages.
- 📅 **Contest Radar** — An hourly-updated, pinned message that cleanly displays upcoming contests from Codeforces and AtCoder. Members can react with 🔔 to receive a DM exactly 15 minutes before a contest starts!
- 🗓️ **Weekly Wrap-Up** — Every Sunday at midnight, the bot analyzes the server's weekly statistics and posts a beautiful summary of who solved the most problems and who gained the most rating points.
- 🧠 **AI Team Builder** — Uses an advanced graph traversal algorithm (DFS) to build perfectly balanced, multi-skill 3-person teams for ICPC and Codeforces team contests based on members' top tags (e.g., Math, DP, Graphs).
- 📈 **Visual Progress Graphs** — Generates a 2D line-graph image directly in Discord showing a member's rating history over time.

---

## ⚙️ How It Works (Autonomy)

Once the initial setup is complete, the bot requires **zero administrative effort**.

1. **New Members Join:** They use `/link codeforces <handle>`.
2. **Instant Sync:** The bot instantly fetches their data, updates the database, creates their rank role, and updates the dashboard.
3. **Daily Routine:**
   - **9:00 AM:** Full leaderboard refresh.
   - **9:00 PM:** Daily problem suggestions are posted.
4. **Hourly Routine:**
   - Every hour exactly on the hour, the bot checks for new contests and refreshes the pinned Contest Radar.
5. **Minute-by-Minute Routine:**
   - Every 2 minutes, the bot checks for new Accepted submissions to post in the Live Feed.
   - Every 5 minutes, it checks for First Blood winners on the Daily Problems.

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
> Ensure you attach an **SQLite Volume** to your service in Railway, mapped to `/app/database`, so that the local SQLite database persists across deployments.

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
| `/suggest [tag] [difficulty]` | Force the bot to give you custom problem recommendations. |
| `/graph <handle>` | Generates a 2D line graph of a Codeforces rating history. |

### Server Features / Games
| Command | Description |
|---|---|
| `/build-teams` | Generates balanced 3-person ICPC teams using Graph algorithms. |
| `/vc-start <name>` | Starts a Pomodoro-style Voice Channel timer for virtual contests. |

### Admin Setup Commands
*Run these to configure which channels the autonomous loops post to.*
| Command | Description |
|---|---|
| `/set-contest-channel #channel` | Sets where the hourly Contest Radar updates. |
| `/set-dashboard-channel #channel` | Sets where the morning Leaderboard updates. |
| `/set-suggest-channel #channel` | Sets where the 9 PM Daily Challenges post. |
| `/set-feed-channel #channel` | Sets where Live Accepted submissions stream. |

---

## 🏗️ Architecture

- **`index.js`** — The main entry point. Registers events and spins up background crons.
- **`database/db.js`** — Fully synchronous SQLite operations using `better-sqlite3`.
- **`tasks/`** — The brain of the bot. Contains independent cron jobs (`contestFetcher.js`, `dailyChallenge.js`, `ratingSync.js`, `submissionFeed.js`, `weeklyWrapup.js`).
- **`utils/`** — API wrappers for Codeforces and AtCoder, plus the master `embeds.js` file for UI consistency.

---

## 📡 APIs Used
- **Codeforces:** Official API (`https://codeforces.com/api/`)
- **AtCoder:** Kenkoooo Unofficial API (`https://kenkoooo.com/atcoder`)

*Built with precision to ensure no rate limits are hit by employing sequential delays and optimized local caching.*
