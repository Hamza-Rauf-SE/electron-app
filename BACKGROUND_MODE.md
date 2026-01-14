# Running in Background Mode

This guide explains how to run the Electron app in the background so it continues running even after you close your terminal.

## Quick Start

### Start in Background
```bash
npm run start:background
# or
./start-background.sh
```

### Check Status
```bash
npm run status:background
# or
./status-background.sh
```

### View Live Logs
```bash
npm run logs
# or
tail -f logs/app.log
```

### Stop Background App
```bash
npm run stop:background
# or
./stop-background.sh
```

## What Happens

When you run `start-background.sh`:
1. ✅ Kills any existing instances
2. ✅ Starts the app with `nohup`
3. ✅ Redirects all output to `logs/app.log`
4. ✅ Saves the process ID to `logs/app.pid`
5. ✅ Detaches from terminal (you can close it)

## Log Management

All logs are stored in the `logs/` directory:
- `app.log` - Application output (stdout and stderr)
- `app.pid` - Process ID of the running app

### View Recent Logs
```bash
tail -20 logs/app.log
```

### View Live Logs (follow mode)
```bash
tail -f logs/app.log
```

### Clear Old Logs
```bash
rm logs/app.log
```

## Troubleshooting

### App Won't Start
```bash
# Check if port is already in use
./stop-background.sh

# Check logs for errors
cat logs/app.log

# Try starting again
./start-background.sh
```

### Can't Find Process
```bash
# Manual kill by name
pkill -f "electron-app"
pkill -f "cheating-daddy"

# Remove stale PID file
rm logs/app.pid
```

### SSL Errors in Logs
These are harmless background Chromium errors and can be ignored. They don't affect functionality.

## Auto-Start on Login (Optional)

### macOS (using launchd)

Create a file at `~/Library/LaunchAgents/com.cheatingdaddy.app.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.cheatingdaddy.app</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Users/trimulabs/Documents/electron-app/start-background.sh</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>/Users/trimulabs/Documents/electron-app/logs/launchd.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/trimulabs/Documents/electron-app/logs/launchd.error.log</string>
</dict>
</plist>
```

Then enable it:
```bash
launchctl load ~/Library/LaunchAgents/com.cheatingdaddy.app.plist
```

To disable auto-start:
```bash
launchctl unload ~/Library/LaunchAgents/com.cheatingdaddy.app.plist
```

### Linux (using systemd)

Create `/etc/systemd/system/cheating-daddy.service`:

```ini
[Unit]
Description=Cheating Daddy Electron App
After=network.target

[Service]
Type=simple
User=trimulabs
WorkingDirectory=/Users/trimulabs/Documents/electron-app
ExecStart=/Users/trimulabs/Documents/electron-app/start-background.sh
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable cheating-daddy
sudo systemctl start cheating-daddy
sudo systemctl status cheating-daddy
```

## Notes

- The app will keep running even if you close the terminal
- Use the stop script to properly shut down the app
- Logs are rotated automatically by the OS (usually)
- PID file is used to track the running process
