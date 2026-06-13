@echo off
TITLE Hustronix OS Launcher
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"

echo [Hustronix OS] Starting API...
start "Hustronix API" /MIN cmd /k "cd /d "%ROOT%" && npm run dev:api"

ping -n 6 127.0.0.1 >nul

echo [Hustronix OS] Starting UI...
start "Hustronix UI" /MIN cmd /k "cd /d "%ROOT%" && npm run dev:web"

echo [Hustronix OS] Both services launched.
exit
