' Hustronix OS Silent Launcher
' Starts both the Bot and Mission Control in the background with no visible windows.
Set WshShell = CreateObject("WScript.Shell")

' Launch the Bot silently
WshShell.Run "cmd /c ""cd /d """"C:\Users\spandan\Desktop\ai agents\Hustronix OS"""" && npm run dev >> """"C:\Users\spandan\Desktop\ai agents\Hustronix OS\bot.log"""" 2>&1""", 0, False

' Wait 6 seconds for the bot to bind its port
WScript.Sleep 6000

' Launch Mission Control silently
WshShell.Run "cmd /c ""cd /d """"C:\Users\spandan\Desktop\ai agents\Hustronix OS\mission-control"""" && npm run dev >> """"C:\Users\spandan\Desktop\ai agents\Hustronix OS\dashboard.log"""" 2>&1""", 0, False
