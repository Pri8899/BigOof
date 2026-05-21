#!/bin/bash
# start-bot.sh — Load and start CP Bot as a background service on macOS
echo "🚀 Starting CP Bot in background..."
launchctl load ~/Library/LaunchAgents/com.cpbot.plist 2>/dev/null || true
launchctl start com.cpbot
echo "✅ Bot started successfully! Logs are written to out.log and err.log."
echo "👉 Run 'tail -f out.log' or 'tail -f err.log' to monitor bot output."
