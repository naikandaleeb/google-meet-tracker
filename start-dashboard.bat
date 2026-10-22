@echo off
title Cockroach Library - 12H Meet & Camera Tracker (Port 4200)
color 0B
echo =====================================================================
echo       COCKROACH LIBRARY - 12-HOUR MEET ATTENDANCE & CAMERA TRACKER
echo =====================================================================
echo.
echo [*] Checking Node.js environment...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Please install Node.js from https://nodejs.org
    pause
    exit /b 1
)

echo [*] Starting Dedicated Localhost Dashboard on Port 4200...
echo [*] Separate from your primary study tracker port!
echo.
cd /d "%~dp0server"

if not exist "node_modules" (
    echo [*] Installing dependencies...
    call npm install
)

start "" http://localhost:4200
node server.js

pause
