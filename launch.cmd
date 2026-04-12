@echo off
setlocal
cd /d "%~dp0"

echo Checking for an existing server on port 3000...
powershell -NoProfile -Command ^
  "$connections = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue; " ^
  "if ($connections) { $connections | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { try { Stop-Process -Id $_ -Force -ErrorAction Stop; Write-Host ('Stopped process ' + $_ + ' on port 3000.'); } catch {} } }"

echo Starting Connexa dev server...
call npm.cmd run dev
