# 🏆 CP-Bot: The Ultimate Autonomous Competitive Programming Discord Engine

Welcome to the **CP-Bot**, a highly advanced, fully autonomous Discord bot engineered from the ground up for Competitive Programming (CP) communities. 

Whether your server is a small college coding club or a massive regional hub for CP enthusiasts, CP-Bot completely automates the tracking, gamification, and organization of your members' coding journeys across platforms like **Codeforces** and **AtCoder**.

---

## 📖 Table of Contents

1. [Vision & Philosophy](#-vision--philosophy)
2. [The Autonomous Engine (Cron Jobs)](#-the-autonomous-engine-cron-jobs)
3. [Ranking & Leaderboard System](#-ranking--leaderboard-system)
4. [Gamification: VS Matches & Virtual Contests](#-gamification-vs-matches--virtual-contests)
5. [Analytics & Insights](#-analytics--insights)
6. [Comprehensive Command Reference](#-comprehensive-command-reference)
7. [Database Architecture & Schema](#-database-architecture--schema)
8. [API Integrations & Caching](#-api-integrations--caching)
9. [Complete Setup & Installation Guide](#-complete-setup--installation-guide)
10. [Deployment (Railway / VPS)](#-deployment-railway--vps)
11. [Roadmap](#-roadmap)

---

## 👁️ Vision & Philosophy

Managing a Competitive Programming Discord server manually is exhausting. Tracking who solved what, announcing upcoming contests, updating roles when someone reaches a new rank, and keeping members engaged takes constant administrative effort.

**CP-Bot changes everything.** Once deployed and configured, it requires **zero human intervention**. It autonomously orchestrates the server by assigning roles, posting live feeds, updating leaderboards, and running daily algorithmic challenges. 

Built with **Discord.js v14** and **SQLite**, it uses a highly modular background cron system that guarantees precision timing without hitting API rate limits.

---

## ⚙️ The Autonomous Engine (Cron Jobs)

The heart of CP-Bot is its `tasks/` directory. Unlike traditional bots that only respond to commands, CP-Bot acts as an active agent, continuously polling and pushing updates based on an internal clock.

### 1. The Minute-by-Minute Loop (Live Feeds & Games)
- **Live Submission Feed (`submissionFeed.js`):** Every 60 seconds, the bot queries the Codeforces and AtCoder APIs for recent submissions of all linked users. If it detects a new "Accepted" verdict, it instantly broadcasts an embed in the designated Feed channel. It also instantaneously calculates and updates the user's active daily solving streak!
- **Match Poller (`vsPoller.js`):** Monitors active 1v1 and group Versus (`/vs`) matches. It tracks the time remaining, queries the Codeforces API to see who solved the assigned problems first, updates the live scoreboard, and gracefully concludes the match when time expires.
- **First Blood Tracker (`dailyChallenge.js`):** Every 5 minutes, the bot checks if any member has solved the current day's Daily Challenges. The first solver gets a server-wide "First Blood 🩸" announcement.

### 2. The Hourly Loop (Contest Radar)
- **Contest Fetcher (`contestFetcher.js`):** At the top of every hour, the bot queries the Codeforces and AtCoder schedules. It cross-references its internal `notified_contests` database to handle contest delays and renaming dynamically.
- **Radar Updates:** It maintains a single pinned message in the Contest channel, keeping it constantly updated with upcoming contests.
- **Automated Pings:** Exactly 24 hours and 1 hour before a contest starts, the bot automatically pings the `<@&ContestPing>` role (or DMs users) to ensure nobody misses a rated round.

### 3. The Daily Loop (Leaderboards & Challenges)
- **Morning Sync (9:00 AM):** The bot performs a deep sync of all users (`ratingSync.js`). It updates everyone's max ratings, total solved counts, and calculates if any streaks were broken due to inactivity on the previous day. The main Dashboard embed is refreshed.
- **Nightly Challenges (9:00 PM):** The bot randomly selects three Codeforces problems (e.g., 800, 1000, and 1200 difficulty) that have a low solve-rate among server members. It posts them as the "Daily Challenges".

### 4. The Weekly Loop (Sunday Wrap-Up)
- **Weekly Wrap-Up (`weeklyWrapup.js`):** Every Sunday at midnight, the bot compares current user ratings/solves against the previous week's snapshot. It announces the "Top Climbers" (most rating gained) and "Top Grinders" (most problems solved).

---

## 🏆 Ranking & Leaderboard System

### Exact Rank Roles
When a user links their account, the bot automatically creates a Discord Role matching their exact Codeforces Rank (e.g., *Newbie*, *Pupil*, *Specialist*, *Expert*, *Candidate Master*, etc.). 
- **Exact Colors:** The roles are painted using the exact hex codes used on the Codeforces website.
- **Auto-Promotion:** If a user gains rating in a contest and promotes to a new rank, the bot automatically strips their old role and grants them their new rank role during the next sync.

### The Autonomous Dashboard
Instead of users constantly typing `/leaderboard`, the bot maintains a permanent, auto-updating dashboard in a designated channel.
The dashboard sorts members by:
1. **Global Codeforces Rating**
2. **AtCoder Rating**
3. **Total Problems Solved**
4. **Current Active Streaks (🔥)**

### Timezone-Aware Streaks
Streaks are fundamental to gamification. The bot tracks consecutive days a user has solved at least one problem. The day boundary is rigidly set to midnight in the local configured timezone, ensuring fair streak keeping. Users receive milestone streak roles (7 Days, 30 Days, 100 Days).

---

## ⚔️ Gamification: VS Matches & Virtual Contests

To foster healthy competition, CP-Bot introduces native matchmaking and contest hosting directly inside Discord.

### Versus Matches (`/vs`)
Members can challenge each other to live coding duels.
1. **Creation:** User A types `/vs create rating:1400 duration:60`.
2. **Lobby:** The bot opens a lobby. User B (and others) can click "Join Match" on the embed.
3. **Problem Selection:** Once started, the bot fetches a random 1400-rated Codeforces problem that **none** of the participants have solved before.
4. **Live Scoreboard:** The bot tracks submissions in real-time. The first person to get an Accepted verdict wins the match and claims the glory!

### Virtual Contests (`/vc`)
For server-wide practice, admins can start a Virtual Contest.
1. **Start:** `/vc-start duration:120 difficulty:div2`
2. **Problemset:** The bot builds a balanced 5-problem set (A, B, C, D, E) mimicking a real Codeforces Div. 2 round.
3. **Participation:** Members type `/vc-join` to enter.
4. **Tracking:** The bot tracks exactly how many problems each participant solves during the 2-hour window and ranks them by finish time.

### AI Team Builder (`/build-teams`)
Preparing for ICPC? The `/build-teams` command analyzes the Codeforces histories of all interested members. It maps their strongest tags (Math, DP, Graphs, Greedy) and runs a Depth-First Search (DFS) algorithm to group members into balanced 3-person teams with diverse, non-overlapping skill sets.

---

## 🔎 Analytics & Insights

### `/skills <handle>`
This command generates a gorgeous **Radar Chart** image natively in Discord. It scans a user's entire Codeforces submission history, tallies up the tags of their solved problems, and plots their proficiency in areas like Data Structures, Dynamic Programming, Math, and Strings.

### `/graph <handle>`
Fetches a user's entire rating history from the Codeforces API and plots a 2D line graph over time, overlaying the background colors of the Codeforces rank tiers.

### `/whosolved <problem_link>`
Stuck on a problem and need a hint? Paste the link into this command. The bot will scan the server's database and list every single member in the Discord who has an Accepted verdict on that exact problem, telling you exactly who to DM for help.

---

## 📚 Comprehensive Command Reference

### 👤 User Account Commands
| Command | Options | Description |
|---|---|---|
| `/link` | `platform` (Codeforces/AtCoder), `handle` | Links a CP account to your Discord ID. Instantly updates the dashboard and assigns rank roles. |
| `/unlink` | `platform` | Removes a linked account and deletes your history from the local database. |
| `/profile` | `user` (Optional) | Displays an elegant summary card of a user's ratings, max ratings, total solves, and current streaks. |

### 📊 Statistics & Analytics Commands
| Command | Options | Description |
|---|---|---|
| `/leaderboard` | None | Generates an on-demand, paginated leaderboard of all server members. |
| `/contests` | `platform` (Optional) | Fetches the upcoming contest radar to your current channel. |
| `/graph` | `handle` | Generates a rating history line graph. |
| `/skills` | `handle` | Generates a radar chart of CP topic proficiencies. |
| `/whosolved` | `problem_link` | Finds all server members who have solved a specific problem. |

### 🎮 Gamification Commands
| Command | Options | Description |
|---|---|---|
| `/suggest` | `tag` (Optional), `difficulty` (Optional) | The bot queries the CF API to find a problem you haven't solved matching the criteria. |
| `/vs create` | `rating`, `duration`, `tag` (Optional) | Opens a VS Match lobby. |
| `/vs join` | `match_id` | Joins an open match lobby. |
| `/vs start` | `match_id` | Starts the match and reveals the problem. |
| `/vs cancel` | `match_id` | Cancels a pending lobby. |
| `/vc-start` | `duration`, `difficulty` | Starts a server-wide Virtual Contest. |
| `/vc-join` | None | Joins the active Virtual Contest. |
| `/vc-end` | None | Force-ends an active Virtual Contest early. |
| `/build-teams` | None | Generates balanced 3-person teams based on CF tags. |

### ⚙️ Admin Configuration Commands
*Only accessible to users with the Administrator permission.*
| Command | Options | Description |
|---|---|---|
| `/admin set-channel` | `type` (feed, radar, daily, dashboard), `channel` | Configures which Discord channels the background crons will post their automated messages to. |

---

## 🗄️ Database Architecture & Schema

CP-Bot uses **SQLite** (`better-sqlite3`) for blazing-fast, synchronous local data storage. The database leverages **Write-Ahead Logging (WAL)** for high concurrency.

### Core Tables:
- **`users`**: Maps Discord IDs to Codeforces and AtCoder handles.
- **`ratings`**: Stores cached ratings, max ratings, rank titles, and solve counts to avoid spamming the APIs.
- **`streaks`**: Tracks the `current_streak`, `max_streak`, and `last_active_date` for every user.
- **`rating_history`**: Appends a new row every time a user's rating changes, used for weekly wrap-ups and analysis.
- **`last_submissions`**: Stores the highest submission ID seen for a user to know where to resume polling for the Live Feed.
- **`notified_contests`**: Caches upcoming contests. Includes `notified_24h` and `notified_1h` flags to prevent duplicate pings. Uses `ON CONFLICT DO UPDATE` to elegantly handle Codeforces contest rescheduling and renaming.
- **`daily_problems`**: Stores the 3 problems randomly selected for the day and who got "First Blood" on them.
- **`vs_matches` & `vs_participants`**: Ephemeral tables managing the state of live 1v1 duels.
- **`virtual_contests` & `vc_participants`**: Manages active server-wide virtual contests.
- **`guild_config`**: Key-value store for channel IDs and bot settings.

---

## 🌐 API Integrations & Caching

Competitive Programming APIs (especially Codeforces) have strict rate limits. CP-Bot is specifically engineered to never get IP-banned.

### Codeforces API (`https://codeforces.com/api/`)
- **Problemset Caching:** Calling `problemset.problems` is incredibly heavy (returning thousands of problems). CP-Bot caches the entire problemset in memory and only refreshes it once every 6 hours. When generating VS Matches or Daily Problems, it filters locally from the cache!
- **Batching & Delays:** When syncing 50+ users simultaneously, the bot batches requests using `Promise.all` in chunks of 5, injecting artificial 1-second delays between chunks to satisfy the CF API's 5-requests-per-second limit.
- **Error Fallbacks:** If the CF API goes down (returns 503), the bot gracefully catches the error, preserves the user's existing data in SQLite, and tries again on the next cron cycle without crashing.

### AtCoder API (`https://kenkoooo.com/atcoder/`)
- The bot relies on the unofficial Kenkoooo API for AtCoder submissions and ratings. Similar caching and timeout logic is applied to ensure stability.

---

## 🚀 Complete Setup & Installation Guide

Follow these steps carefully to self-host the CP-Bot on your own machine or server.

### Prerequisites
- **Node.js** v18.16.0 or higher.
- **npm** or **yarn** package manager.
- Git.

### Step 1: Discord Developer Portal
1. Navigate to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Click **New Application** and give it a name (e.g., "CP-Bot").
3. Go to the **Bot** tab on the left.
4. Click **Reset Token** and copy your **Bot Token**. Keep this highly secure.
5. Scroll down to **Privileged Gateway Intents** and enable:
   - ✅ **Server Members Intent** (Required to iterate over server members for syncing).
   - ✅ **Message Content Intent** (Required for reading chat messages).
6. Go to **OAuth2 > URL Generator**.
7. Select scopes: `bot` and `applications.commands`.
8. Select bot permissions: `Administrator` (or manually select Manage Roles, Send Messages, Embed Links, Attach Files, Manage Channels).
9. Copy the generated URL and paste it into your browser to invite the bot to your server.
10. Go to the **General Information** tab and copy your **Application ID (Client ID)**.

### Step 2: Local Project Setup
Open your terminal and run the following:

```bash
# Clone the repository
git clone https://github.com/yourusername/DC-Bot.git
cd DC-Bot

# Install dependencies (Discord.js, Axios, Better-SQLite3, Chart.js, Canvas, etc.)
npm install
```

### Step 3: Environment Configuration
Create a file named `.env` in the root directory of the project:

```env
# Required Authentication
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_application_id_here
GUILD_ID=your_discord_server_id_here

# (Optional initially) Channel IDs for autonomous posts
# You can also set these inside Discord using /admin set-channel
CONTEST_CHANNEL_ID=your_channel_id_here
DASHBOARD_CHANNEL_ID=your_channel_id_here
SUGGEST_CHANNEL_ID=your_channel_id_here
FEED_CHANNEL_ID=your_channel_id_here
```

*To get a Channel ID, enable "Developer Mode" in your Discord User Settings, right-click a channel, and select "Copy Channel ID".*

### Step 4: Deploy Slash Commands
Before running the bot, you must register the Slash Commands with Discord's API.

```bash
node deploy-commands.js
```
*You should see a success message indicating that 15+ commands were registered.*

### Step 5: Start the Engine
```bash
node index.js
```
*The console will light up, indicating that the SQLite database has initialized, the Codeforces caches are warming up, and the cron jobs have started ticking.*

---

## ☁️ Deployment (Railway / VPS)

Running the bot on your local PC means it turns off when you sleep. For 24/7 uptime, you must deploy it to a cloud provider.

### Deploying to Railway.app (Recommended)
1. Push your code to a private GitHub repository.
2. Go to [Railway](https://railway.app/), create a New Project, and connect your GitHub repo.
3. Railway will automatically detect Node.js and run `npm install` & `node index.js`.
4. **Environment Variables:** Go to the Variables tab in Railway and paste your `.env` variables.

**CRITICAL: Persistent SQLite Storage**
By default, Railway containers are ephemeral. Every time you push an update, the filesystem is wiped, meaning your `cpbot.db` database will be deleted!
To fix this:
1. In your Railway service settings, go to **Volumes**.
2. Click **Create Volume** and map it to the Mount Path: `/data`
3. The bot's `database/db.js` file is automatically programmed to detect the `/data` folder on Railway and will save the database there safely, persisting it across deployments!

### Deploying to a VPS (Ubuntu/Linux)
If using a standard VPS (like DigitalOcean or AWS EC2), you should use `pm2` to keep the bot alive.

```bash
npm install -g pm2
pm2 start index.js --name "cpbot"
pm2 save
pm2 startup
```

---

## 🔮 Roadmap

We are constantly improving CP-Bot. Upcoming planned features include:
- **LeetCode Integration:** Fetching LeetCode contest ratings and daily challenges.
- **CodeChef Integration:** Tracking CodeChef Star ratings.
- **Web Dashboard:** A companion website connected via Discord OAuth to view your server's stats visually.
- **Custom Problem Sets:** The ability for admins to upload custom JSON problemsets for Virtual Contests instead of relying purely on Codeforces.

---

## 📜 License & Credits

Built with passion for the Competitive Programming community. 
Powered by the incredible [Codeforces API](https://codeforces.com/apiHelp) and [Kenkoooo's AtCoder API](https://github.com/kenkoooo/AtCoderProblems).

This project is open-source. Feel free to fork, modify, and contribute via Pull Requests!

> *"Talk is cheap. Show me the code." - Linus Torvalds*
