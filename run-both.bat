@echo off
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"

echo Starting Hustronix OS Backend...
start "Hustronix Backend" cmd /k "cd /d "%ROOT%" && npm run dev:api"

echo Starting Hustronix Web...
start "Hustronix Web" cmd /k "cd /d "%ROOT%" && npm run dev:web"

echo Both processes launched in separate windows!
