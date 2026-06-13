$startup = [System.Environment]::GetFolderPath('Startup')
Remove-Item "$startup\start-hustronix.bat" -ErrorAction SilentlyContinue
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Copy-Item -Path (Join-Path $root 'start-hustronix.vbs') -Destination "$startup\start-hustronix.vbs" -Force
Write-Host "Done. Copied to: $startup"
