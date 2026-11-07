@echo off
echo ===============================================================
echo 🪳 STOPPING COCKROACH MEET TRACKER SERVER
echo ===============================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Write-Host 'Stopping background daemon and server processes...' -ForegroundColor Cyan; " ^
  "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*daemon.js*' -or $_.CommandLine -like '*server.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; " ^
  "Get-NetTCPConnection -LocalPort 4200 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }; " ^
  "Start-Sleep -Seconds 1; " ^
  "$conn = Get-NetTCPConnection -LocalPort 4200 -ErrorAction SilentlyContinue; " ^
  "if (-not $conn) { " ^
  "  Write-Host 'SUCCESS: Cockroach Tracker Server has been completely stopped.' -ForegroundColor Green; " ^
  "} else { " ^
  "  Write-Host 'Warning: Some process is still listening on port 4200.' -ForegroundColor Yellow; " ^
  "}"

echo.
echo ===============================================================
pause
