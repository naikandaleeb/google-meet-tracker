# Cockroach Library - 12H Meet & Camera Tracker (Port 4200)
Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host "      COCKROACH LIBRARY - 12-HOUR MEET ATTENDANCE & CAMERA TRACKER   " -ForegroundColor Cyan
Write-Host "=====================================================================" -ForegroundColor Cyan

Set-Location -Path "$PSScriptRoot\server"

if (-not (Test-Path "node_modules")) {
    Write-Host "[*] Installing server dependencies..." -ForegroundColor Yellow
    npm install
}

Write-Host "[*] Launching Dashboard on http://localhost:4200 (Isolated Port)..." -ForegroundColor Green
Start-Process "http://localhost:4200"

node server.js
