@echo off
echo Starting Hustronix OS Backend...
start "Hustronix Backend" cmd /k "npm run dev"

echo Starting hustronix-ui...
start "Hustronix UI" cmd /k "cd hustronix-ui && npm run dev"

echo Both processes launched in separate windows!
