@echo off
TITLE Hustronix OS Launcher

:: ──── Hustronix OS Bot ────
echo [Hustronix OS] Starting bot...
start "Hustronix OS Bot" /MIN cmd /k "cd /d "d:\Hustronix OS" && npm run dev"

:: Wait a moment for the bot to bind its port before starting the dashboard
ping -n 6 127.0.0.1 >nul

:: ──── Next.js UI (hustronix-ui) ────
echo [Hustronix OS] Starting hustronix-ui...
start "Hustronix UI" /MIN cmd /k "cd /d "d:\Hustronix OS\hustronix-ui" && npm run dev"

echo [Hustronix OS] Both services launched. Closing launcher...
exit
