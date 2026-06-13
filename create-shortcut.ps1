$WshShell = New-Object -ComObject WScript.Shell
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$shortcut = $WshShell.CreateShortcut("$env:USERPROFILE\Desktop\Hustronix OS.lnk")
$shortcut.TargetPath = Join-Path $root 'start-hustronix.vbs'
$shortcut.WorkingDirectory = $root
$shortcut.Description = "Launch Hustronix OS API + Web"
$shortcut.IconLocation = "wscript.exe,0"
$shortcut.Save()
Write-Host "Shortcut created on Desktop."
