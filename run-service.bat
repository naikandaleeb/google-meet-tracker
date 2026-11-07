@echo off
title Cockroach Meet Tracker Background Service
cd /d "%~dp0"

:loop
echo [%date% %time%] Starting Cockroach Tracker Server on port 4200... >> "%~dp0server\data\service.log"
node server\server.js >> "%~dp0server\data\service.log" 2>&1
echo [%date% %time%] Server process stopped or crashed. Restarting in 2 seconds... >> "%~dp0server\data\service.log"
ping 127.0.0.1 -n 3 >nul
goto loop
