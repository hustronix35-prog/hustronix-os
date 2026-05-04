@echo off
TITLE Hustronix OS Launcher

:: ──── Hustronix OS Bot ────
echo [Hustronix OS] Starting bot...
start "Hustronix OS Bot" /MIN cmd /k "cd /d "d:\Hustronix OS" && npm run dev"

:: Wait a moment for the bot to bind its port before starting the dashboard
ping -n 6 127.0.0.1 >nul

:: ──── Mission Control Dashboard ────
echo [Hustronix OS] Starting Mission Control dashboard...
start "Mission Control" /MIN cmd /k "cd /d "d:\Hustronix OS\mission-control" && npm run dev"

echo [Hustronix OS] Both services launched. Closing launcher...
exit
