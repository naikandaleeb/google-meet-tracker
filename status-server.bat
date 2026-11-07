@echo off
echo ===============================================================
echo 🪳 COCKROACH MEET TRACKER SERVER STATUS
echo ===============================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$conn = Get-NetTCPConnection -LocalPort 4200 -ErrorAction SilentlyContinue; " ^
  "if ($conn) { " ^
  "  Write-Host 'STATUS: [ RUNNING 24/7 IN BACKGROUND ]' -ForegroundColor Green; " ^
  "  Write-Host ('PID: ' + $conn[0].OwningProcess); " ^
  "  Write-Host 'URL: http://localhost:4200' -ForegroundColor Cyan; " ^
  "  try { " ^
  "    $res = Invoke-RestMethod -Uri 'http://localhost:4200/api/session/current' -TimeoutSec 2; " ^
  "    $count = ($res.participants.PSObject.Properties | Measure-Object).Count; " ^
  "    Write-Host ('Active Session: ' + $res.sessionId + ' | Total Students: ' + $count + ' | Tracking: ' + $res.isTracking + ' | Paused: ' + $res.isPaused) -ForegroundColor White; " ^
  "  } catch { Write-Host 'Connecting to server...' } " ^
  "} else { " ^
  "  Write-Host 'STATUS: [ NOT RUNNING ]' -ForegroundColor Red; " ^
  "  Write-Host 'Run start-server.bat to start the server.' -ForegroundColor Yellow; " ^
  "}"

echo.
echo ===============================================================
pause
