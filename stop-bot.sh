#!/bin/bash
# stop-bot.sh — Stop and unload CP Bot background service on macOS
echo "🛑 Stopping CP Bot..."
launchctl stop com.cpbot 2>/dev/null || true
launchctl unload ~/Library/LaunchAgents/com.cpbot.plist 2>/dev/null || true
echo "✅ Bot stopped successfully."
