#!/bin/bash

# Script to stop the background Electron app
# Usage: ./stop-background.sh

cd "$(dirname "$0")"

if [ -f logs/app.pid ]; then
    APP_PID=$(cat logs/app.pid)
    echo "Stopping app (PID: $APP_PID)..."
    
    # Kill the process
    kill $APP_PID 2>/dev/null
    
    # Also kill any child processes
    pkill -P $APP_PID 2>/dev/null
    
    # Remove PID file
    rm logs/app.pid
    
    echo "✅ App stopped"
else
    echo "⚠️  No PID file found. Trying to kill by name..."
    pkill -f "electron-app"
    pkill -f "cheating-daddy"
    echo "✅ Done"
fi
