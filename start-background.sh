#!/bin/bash

# Script to start the Electron app in the background with nohup
# Usage: ./start-background.sh

cd "$(dirname "$0")"

# Create logs directory if it doesn't exist
mkdir -p logs

# Kill any existing instances
pkill -f "electron-app" 2>/dev/null
pkill -f "cheating-daddy" 2>/dev/null

# Start the app in the background with nohup
echo "Starting Electron app in background..."
nohup npm start > logs/app.log 2>&1 &

# Get the PID and save it
APP_PID=$!
echo $APP_PID > logs/app.pid

echo "✅ App started in background"
echo "📝 PID: $APP_PID"
echo "📄 Logs: logs/app.log"
echo ""
echo "To view logs: tail -f logs/app.log"
echo "To stop app: ./stop-background.sh"
