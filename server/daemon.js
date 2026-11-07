const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(__dirname, '..');
const logFile = path.join(rootDir, 'server', 'data', 'service.log');

function log(msg) {
  const line = `[${new Date().toLocaleString('en-IN')}] ${msg}\n`;
  try {
    fs.appendFileSync(logFile, line, 'utf8');
  } catch (e) {}
}

let activeChild = null;
let isShuttingDown = false;

function startServer() {
  if (isShuttingDown) return;
  log('Starting Cockroach Tracker Server (server/server.js)...');

  activeChild = spawn(process.execPath, [path.join(rootDir, 'server', 'server.js')], {
    cwd: rootDir,
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  activeChild.stdout.on('data', (d) => {
    try { fs.appendFileSync(logFile, d); } catch (e) {}
  });

  activeChild.stderr.on('data', (d) => {
    try { fs.appendFileSync(logFile, d); } catch (e) {}
  });

  activeChild.on('exit', (code, signal) => {
    log(`Server exited with code ${code}, signal ${signal}.`);
    activeChild = null;
    if (!isShuttingDown) {
      log('Restarting server in 2 seconds...');
      setTimeout(startServer, 2000);
    }
  });
}

process.on('SIGINT', () => {
  isShuttingDown = true;
  if (activeChild) activeChild.kill();
  process.exit(0);
});

process.on('SIGTERM', () => {
  isShuttingDown = true;
  if (activeChild) activeChild.kill();
  process.exit(0);
});

startServer();
