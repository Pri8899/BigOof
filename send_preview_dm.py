import urllib.request, json, time

TOKEN = open('.env').read()
# Extract token from .env
import re
TOKEN_MATCH = re.search(r'DISCORD_TOKEN\s*=\s*(\S+)', TOKEN)
TOKEN = TOKEN_MATCH.group(1).strip('"\'') if TOKEN_MATCH else None

OWNER_ID = "1367493270703444078"

def api(method, endpoint, data=None):
    url = f"https://discord.com/api/v10{endpoint}"
    headers = {
        "Authorization": f"Bot {TOKEN}",
        "Content-Type": "application/json",
        "User-Agent": "DiscordBot (https://github.com/parthopaul69/DC-Bot, 1.0.0)"
    }
    req = urllib.request.Request(url, method=method, headers=headers)
    if data:
        req.data = json.dumps(data).encode()
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        print(f"Error {e.code}: {e.read().decode()}")
        return None

# Open DM channel
dm = api("POST", "/users/@me/channels", {"recipient_id": OWNER_ID})
if not dm:
    print("Failed to open DM"); exit()

channel_id = dm["id"]
print(f"DM channel: {channel_id}")

# 1. Leaderboard Preview
embed1 = {
    "color": 0x2ECC71,
    "description": "# \u2003\u2003\u2003🏅 CP Server Leaderboard\n\n🥇 **ImposterBhO0** 🔥\n> 🔵 CF _(Expert)_ · Rating: **1624** · Solved: **146** · 🔥 **15d**\n> 🔴 AC · Rating: Unrated · Solved: **18**\n> 🟣 Toph _(A-Division)_ · Rating: **1050** · Solved: **42**\n\n🥈 **_yasir_newb_** ⚡\n> 🔵 CF _(Specialist)_ · Rating: **844** · Solved: **21** · ⚡ **3d**\n\n🥉 **_reeduu_xo**\n> 🔵 CF _(Newbie)_ · Rating: **365** · Solved: **15**\n> 🟣 Toph · Rating: Unrated · Solved: **5**",
    "fields": [
        {"name": "📊 Platforms", "value": "🔵 Codeforces · 🔴 AtCoder · 🟣 Toph", "inline": False},
        {"name": "🔢 Total Members", "value": "3 ranked", "inline": True},
        {"name": "🔥 Streak Legend", "value": "⚡ 1d+  🔥 7d+  👑 15d+  💫 30d+", "inline": True}
    ],
    "footer": {"text": "Last updated • Today at preview time"}
}

# 2. Contest Radar Preview
embed2 = {
    "color": 0x5865F2,
    "description": "# \u2003📅 Upcoming Contests — Full Overview\n\n🔵 ─────── CODEFORCES ───────\n`1.` **[Codeforces Round 1109 (Div. 3)](https://codeforces.com)**\n      📅 Tuesday, 14 July 2026 at 20:35\n      ⏱️ 2h 15m  •  <t:1752512100:R>\n\n🔴 ──────── ATCODER ─────────\n`1.` **[AtCoder Beginner Contest 406](https://atcoder.jp)**\n      📅 Saturday, 18 July 2026 at 21:00\n      ⏱️ 1h 40m  •  in 4 days\n\n🟣 ──────────── TOPH ────────\n`1.` **[Tough Dash, July 2026](https://toph.co/c/tough-dash-july-2026)**\n      📅 Tuesday, 22 July 2026 at 18:00\n      ⏱️ 40m  •  in 1w",
    "footer": {"text": "3 total upcoming contests  •  Refreshes every 12 hours"}
}

# Send both
r1 = api("POST", f"/channels/{channel_id}/messages", {"embeds": [embed1]})
print("Leaderboard preview sent:", r1 is not None)
time.sleep(1)
r2 = api("POST", f"/channels/{channel_id}/messages", {"embeds": [embed2]})
print("Contest radar preview sent:", r2 is not None)
