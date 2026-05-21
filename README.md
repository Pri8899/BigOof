# 🤖 CP Discord Bot

A feature-rich Discord bot for Competitive Programming communities. Auto-assigns roles, tracks ratings across **Codeforces**, **LeetCode**, and **AtCoder**, sends contest notifications, and maintains a live leaderboard dashboard.

---

## ✨ Features

- 🎭 **Auto CP Role** — Every new member gets the `CP` role on join
- 📬 **Welcome DM** — New members receive setup instructions in DM
- 🔗 **Account Linking** — Link Codeforces, LeetCode, AtCoder accounts
- 🏆 **Contest Notifications** — 24h and 1h alerts for upcoming contests
- 🔔 **DM Reminders** — React with 🔔 on a contest to get a personal DM reminder
- 📊 **Live Dashboard** — Auto-updating leaderboard in a dedicated channel
- 🏅 **Composite Ranking** — Scores weighted across all 3 platforms

---

## ⚙️ Setup

### 1. Create a Discord Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** → name it (e.g. `CP Bot`)
3. Go to **Bot** tab → click **Add Bot**
4. Under **Privileged Gateway Intents**, enable:
   - ✅ Server Members Intent
   - ✅ Message Content Intent
5. Copy your **Bot Token**
6. Go to **OAuth2 → General** and copy your **Client ID**

### 2. Invite Bot to Your Server

Use this URL (replace `YOUR_CLIENT_ID`):

```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=8&scope=bot%20applications.commands
```

> Permission `8` = Administrator (recommended for role management)

### 3. Get Your IDs

In Discord, go to **Settings → Advanced** and enable **Developer Mode**.

- **Guild ID**: Right-click your server → Copy ID
- **Channel IDs**: Right-click a channel → Copy ID

### 4. Configure `.env`

Copy the example file and fill it in:

```bash
cp .env.example .env
```

Edit `.env`:

```env
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_client_id_here
GUILD_ID=your_server_id_here
CONTEST_CHANNEL_ID=your_contest_channel_id
DASHBOARD_CHANNEL_ID=your_dashboard_channel_id
```

### 5. Deploy Slash Commands

```bash
npm run deploy
```

### 6. Start the Bot

```bash
npm start
```

---

## 📋 Slash Commands

### Member Commands

| Command | Description |
|---|---|
| `/link <platform> <handle>` | Link a CP account (validated against the API) |
| `/unlink <platform>` | Remove a linked account |
| `/profile [@member]` | View CP stats for yourself or another member |
| `/contests [platform]` | List upcoming contests (optionally filter by platform) |
| `/leaderboard` | Show the full server ranking |

### Admin Commands

| Command | Description |
|---|---|
| `/setup-roles` | Create the `CP` role and assign it to all members |
| `/set-contest-channel #channel` | Set where contest notifications are posted |
| `/set-dashboard-channel #channel` | Set where the leaderboard is displayed |
| `/refresh-dashboard` | Force-refresh the leaderboard now |

---

## 🏗️ Project Structure

```
DC-Bot/
├── index.js                    ← Bot entry point
├── deploy-commands.js          ← Register slash commands
├── .env                        ← Your secrets (never commit!)
├── .env.example                ← Template
├── database/
│   └── db.js                   ← SQLite schema + all helpers
├── commands/
│   ├── link.js
│   ├── unlink.js
│   ├── profile.js
│   ├── contests.js
│   ├── leaderboard.js
│   └── admin/
│       ├── setup-roles.js
│       ├── set-contest-channel.js
│       ├── set-dashboard-channel.js
│       └── refresh-dashboard.js
├── events/
│   ├── guildMemberAdd.js       ← Auto-role + welcome DM
│   ├── interactionCreate.js    ← Slash command router
│   └── messageReactionAdd.js   ← 🔔 reminder subscriptions
├── tasks/
│   ├── contestFetcher.js       ← Cron: fetch & notify (every 30 min)
│   └── ratingSync.js           ← Cron: sync ratings + dashboard (every 1h)
└── utils/
    ├── codeforces.js
    ├── leetcode.js
    ├── atcoder.js
    └── embeds.js
```

---

## 📡 APIs Used

| Platform | API | Auth |
|---|---|---|
| Codeforces | `https://codeforces.com/api/` | None |
| LeetCode | GraphQL `https://leetcode.com/graphql` | None |
| AtCoder | Kenkoooo `https://kenkoooo.com/atcoder` | None |

All APIs are **free and public** — no API keys required!

---

## 🔧 Development

```bash
# Run with auto-restart on file changes (Node 18+)
npm run dev
```

---

## 📌 Notes

- The dashboard auto-updates **every hour** — it edits the same pinned message
- Contest checks run **every 30 minutes**
- Handle validation hits the real API before saving
- Stats are cached in SQLite — no redundant API calls between refreshes
