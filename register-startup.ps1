$startup = [System.Environment]::GetFolderPath('Startup')
Remove-Item "$startup\start-hustronix.bat" -ErrorAction SilentlyContinue
Copy-Item -Path 'C:\Users\spandan\Desktop\ai agents\Hustronix OS\start-hustronix.vbs' -Destination "$startup\start-hustronix.vbs" -Force
Write-Host "Done. Copied to: $startup"
