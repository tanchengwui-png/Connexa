@echo off
setlocal
cd /d "%~dp0"

if "%OUTBOUND_WORKER_TOKEN%"=="" set "OUTBOUND_WORKER_TOKEN=dev-worker-token"
if "%OUTBOUND_WORKER_URL%"=="" set "OUTBOUND_WORKER_URL=http://127.0.0.1:3000"
if "%SENDER_SERVICE_HOST%"=="" set "SENDER_SERVICE_HOST=127.0.0.1"
if "%SENDER_SERVICE_PORT%"=="" set "SENDER_SERVICE_PORT=3101"
if "%SENDER_SERVICE_TOKEN%"=="" set "SENDER_SERVICE_TOKEN=dev-sender-token"
if "%SENDER_SERVICE_URL%"=="" set "SENDER_SERVICE_URL=http://%SENDER_SERVICE_HOST%:%SENDER_SERVICE_PORT%"

if "%WORKSPACE_ID%"=="" (
  for /f "usebackq delims=" %%i in (`node -e "const Database=require('better-sqlite3'); const db=new Database('prisma/dev.db'); const row=db.prepare('select id from Workspace limit 1').get(); if (row && row.id) console.log(row.id)"`) do set "WORKSPACE_ID=%%i"
)

if "%WORKSPACE_ID%"=="" (
  echo Unable to determine WORKSPACE_ID. Run .\reset-db.cmd first or set WORKSPACE_ID manually.
  exit /b 1
)

echo Checking for an existing server on port 3000...
powershell -NoProfile -Command ^
  "$connections = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue; " ^
  "if ($connections) { $connections | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { try { Stop-Process -Id $_ -Force -ErrorAction Stop; Write-Host ('Stopped process ' + $_ + ' on port 3000.'); } catch {} } }"

echo Checking for an existing sender service on port %SENDER_SERVICE_PORT%...
powershell -NoProfile -Command ^
  "$connections = Get-NetTCPConnection -LocalPort %SENDER_SERVICE_PORT% -State Listen -ErrorAction SilentlyContinue; " ^
  "if ($connections) { $connections | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { try { Stop-Process -Id $_ -Force -ErrorAction Stop; Write-Host ('Stopped sender process ' + $_ + ' on port %SENDER_SERVICE_PORT%.'); } catch {} } }"

echo Starting sender service in a separate window...
start "Connexa Sender" powershell -NoExit -Command "$env:SENDER_SERVICE_HOST='%SENDER_SERVICE_HOST%'; $env:SENDER_SERVICE_PORT='%SENDER_SERVICE_PORT%'; $env:SENDER_SERVICE_TOKEN='%SENDER_SERVICE_TOKEN%'; Set-Location '%~dp0'; npm.cmd run sender:service"

echo Waiting for sender service on %SENDER_SERVICE_URL% ...
powershell -NoProfile -Command ^
  "$deadline = (Get-Date).AddMinutes(2); " ^
  "while ((Get-Date) -lt $deadline) { " ^
  "  try { $response = Invoke-WebRequest -Uri '%SENDER_SERVICE_URL%/health' -UseBasicParsing -TimeoutSec 5; if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) { exit 0 } } catch { Start-Sleep -Seconds 2 } " ^
  "} " ^
  "Write-Error 'Connexa sender service did not become ready within 2 minutes.'; exit 1"

if errorlevel 1 exit /b 1

echo Starting Connexa dev server in a separate window...
start "Connexa App" powershell -NoExit -Command "$env:SENDER_SERVICE_URL='%SENDER_SERVICE_URL%'; $env:SENDER_SERVICE_TOKEN='%SENDER_SERVICE_TOKEN%'; Set-Location '%~dp0'; npm.cmd run dev"

echo Waiting for worker API on http://localhost:3000 ...
powershell -NoProfile -Command ^
  "$deadline = (Get-Date).AddMinutes(2); " ^
  "while ((Get-Date) -lt $deadline) { " ^
  "  try { " ^
  "    $response = Invoke-WebRequest -Uri 'http://localhost:3000/api/internal/outbound-message-jobs/heartbeat' -Method POST -Headers @{ 'x-worker-token' = '%OUTBOUND_WORKER_TOKEN%' } -ContentType 'application/json' -Body '{\"workspaceId\":\"%WORKSPACE_ID%\",\"workerLabel\":\"launch-check\"}' -UseBasicParsing -TimeoutSec 5; " ^
  "    if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) { exit 0 } " ^
  "  } catch { " ^
  "    if ($_.Exception.Response -and $_.Exception.Response.StatusCode.value__ -eq 401) { exit 0 } " ^
  "    Start-Sleep -Seconds 2 " ^
  "  } " ^
  "} " ^
  "Write-Error 'Connexa worker API did not become ready within 2 minutes.'; exit 1"

if errorlevel 1 exit /b 1

echo Starting outbound worker in a separate window...
start "Connexa Worker" powershell -NoExit -Command "$env:OUTBOUND_WORKER_TOKEN='%OUTBOUND_WORKER_TOKEN%'; $env:WORKSPACE_ID='%WORKSPACE_ID%'; $env:OUTBOUND_WORKER_URL='%OUTBOUND_WORKER_URL%'; Set-Location '%~dp0'; npm.cmd run worker:messages"

echo Sender service, app server, and worker launched.
