' Hustronix OS Silent Launcher
' Starts both the Bot and Mission Control in the background with no visible windows.
Set WshShell = CreateObject("WScript.Shell")

' Launch the Bot silently
WshShell.Run "cmd /c ""cd /d """"d:\Hustronix OS"""" && npm run dev >> """"d:\Hustronix OS\bot.log"""" 2>&1""", 0, False

' Wait 6 seconds for the bot to bind its port
WScript.Sleep 6000

' Launch hustronix-ui silently
WshShell.Run "cmd /c ""cd /d """"d:\Hustronix OS\hustronix-ui"""" && npm run dev >> """"d:\Hustronix OS\dashboard.log"""" 2>&1""", 0, False
