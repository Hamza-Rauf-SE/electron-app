#!/bin/bash

# Script to check the status of the background Electron app
# Usage: ./status-background.sh

cd "$(dirname "$0")"

if [ -f logs/app.pid ]; then
    APP_PID=$(cat logs/app.pid)
    if ps -p $APP_PID > /dev/null 2>&1; then
        echo "✅ App is running (PID: $APP_PID)"
        echo ""
        echo "Recent logs:"
        echo "─────────────────────────────────────"
        tail -20 logs/app.log
    else
        echo "❌ App is not running (stale PID file)"
        rm logs/app.pid
    fi
else
    echo "❌ App is not running"
fi
