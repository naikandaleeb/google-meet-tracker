Write-Host "==============================================================" -ForegroundColor Green
Write-Host "🪳 COCKROACH TRACKER // INSTANT 100% FREE PUBLIC SHARING" -ForegroundColor Green
Write-Host "==============================================================" -ForegroundColor Green
Write-Host "`nStarting secure Cloudflare HTTPS tunnel for port 4200..." -ForegroundColor Cyan
Write-Host "Anyone on the internet can open the generated HTTPS link to see live stats & reports!" -ForegroundColor Yellow
Write-Host "==============================================================`n"

npx --yes cloudflared tunnel --url http://localhost:4200
