$WshShell = New-Object -ComObject WScript.Shell
$shortcut = $WshShell.CreateShortcut("$env:USERPROFILE\Desktop\Hustronix OS.lnk")
$shortcut.TargetPath = 'C:\Users\spandan\Desktop\ai agents\Hustronix OS\start-hustronix.vbs'
$shortcut.WorkingDirectory = 'C:\Users\spandan\Desktop\ai agents\Hustronix OS'
$shortcut.Description = "Launch Hustronix OS Bot + Mission Control"
$shortcut.IconLocation = "wscript.exe,0"
$shortcut.Save()
Write-Host "Shortcut created on Desktop."
