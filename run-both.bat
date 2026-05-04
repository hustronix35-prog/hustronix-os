@echo off
echo Starting Hustronix OS Backend...
start "Hustronix Backend" cmd /k "npm run dev"

echo Starting Hustronix Mission Control...
start "Hustronix Dashboard" cmd /k "cd mission-control && npm run dev"

echo Both processes launched in separate windows!
