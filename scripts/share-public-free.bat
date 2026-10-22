@echo off
title Cockroach Tracker - Free Public Cloudflare Tunnel
echo ==============================================================
echo 🪳 COCKROACH TRACKER // INSTANT 100%% FREE PUBLIC SHARING
echo ==============================================================
echo.
echo Starting secure Cloudflare HTTPS tunnel for port 4200...
echo.
echo Note: This will generate a public HTTPS link (e.g. https://xxx.trycloudflare.com)
echo Anyone on the internet can open that link on phone/laptop to view the dashboard!
echo And students can enter that link into their extension's Server URL field!
echo.
echo ==============================================================
npx --yes cloudflared tunnel --url http://localhost:4200
pause
