' Hustronix OS Silent Launcher
' Starts API and web dev servers in the background.
Set WshShell = CreateObject("WScript.Shell")
Set Fso = CreateObject("Scripting.FileSystemObject")
Root = Fso.GetParentFolderName(WScript.ScriptFullName)

WshShell.Run "cmd /c ""cd /d """" & Root & """" && npm run dev:api >> """" & Root & "\api.log"""" 2>&1""", 0, False

WScript.Sleep 6000

WshShell.Run "cmd /c ""cd /d """" & Root & """" && npm run dev:web >> """" & Root & "\web.log"""" 2>&1""", 0, False
