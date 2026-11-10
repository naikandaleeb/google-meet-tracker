@echo off
cd /d "%~dp0"
echo ===============================================================
echo 🪳 STARTING COCKROACH MEET TRACKER SERVER (24/7 BACKGROUND)
echo ===============================================================
echo.

node -v >nul 2>&1
if %errorlevel% neq 0 (
  echo [ERROR] Node.js is not installed or not in PATH.
  echo Please install Node.js 18+ from https://nodejs.org and try again.
  echo.
  pause
  exit /b 1
)

if not exist "%~dp0server\data" (
  mkdir "%~dp0server\data"
)

if not exist "%~dp0server\node_modules" (
  echo [*] First-time setup: Installing server dependencies...
  pushd "%~dp0server"
  call npm install
  if %errorlevel% neq 0 (
    popd
    echo [ERROR] Failed to install server dependencies. Check internet connection.
    pause
    exit /b 1
  )
  popd
  echo.
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$conn = Get-NetTCPConnection -LocalPort 4200 -ErrorAction SilentlyContinue; " ^
  "if ($conn) { " ^
  "  Write-Host 'Server is ALREADY running at http://localhost:4200 (PID: ' $conn[0].OwningProcess ')' -ForegroundColor Yellow; " ^
  "} else { " ^
  "  Write-Host 'Spawning independent background daemon...' -ForegroundColor Cyan; " ^
  "  $rootDir = '%~dp0'.TrimEnd('\'); " ^
  "  $cmd = '\"' + (Get-Command node).Source + '\" \"' + $rootDir + '\server\daemon.js\"'; " ^
  "  $si = New-CimInstance -ClassName Win32_ProcessStartup -Property @{ ShowWindow = [uint16]0 } -ClientOnly; " ^
  "  $proc = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd; CurrentDirectory = $rootDir; ProcessStartupInformation = $si }; " ^
  "  Start-Sleep -Seconds 2; " ^
  "  $conn2 = Get-NetTCPConnection -LocalPort 4200 -ErrorAction SilentlyContinue; " ^
  "  if ($conn2) { " ^
  "    Write-Host 'SUCCESS! Server is now active in background.' -ForegroundColor Green; " ^
  "    Write-Host 'Dashboard: http://localhost:4200' -ForegroundColor Cyan; " ^
  "    Write-Host 'Notice: This server runs as an independent Windows background service.' -ForegroundColor White; " ^
  "    Write-Host 'Closing terminals or browser windows will NOT stop it.' -ForegroundColor Green; " ^
  "  } else { " ^
  "    Write-Host 'Server is starting up. Check server\data\service.log for details.' -ForegroundColor Yellow; " ^
  "  } " ^
  "}"

echo.
echo ===============================================================
echo Web Dashboard : http://localhost:4200
echo Logs File     : server\data\service.log
echo Stop Server   : Run stop-server.bat
echo ===============================================================
echo.
pause
