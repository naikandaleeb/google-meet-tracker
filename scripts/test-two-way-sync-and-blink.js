// Test Two-Way Linking between Server and Extension & Anti-Blink Verification
const http = require('http');
const WebSocket = require('../server/node_modules/ws');

async function postJson(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      hostname: 'localhost',
      port: 4200,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function run() {
  console.log('--- RUNNING TWO-WAY LINKING & ANTI-BLINK TEST ---');

  // 1. Connect WebSocket
  const ws = new WebSocket('ws://localhost:4200/ws');
  let receivedInit = false;
  let receivedActionStart = false;

  await new Promise((resolve, reject) => {
    ws.on('open', () => {
      console.log('✅ Connected to WebSocket /ws');
    });
    ws.on('message', (data) => {
      const msg = JSON.parse(data);
      if (msg.type === 'INIT') {
        receivedInit = true;
        console.log('✅ Received INIT message from WebSocket on connection');
        resolve();
      }
    });
    ws.on('error', reject);
    setTimeout(() => resolve(), 2000);
  });

  if (!receivedInit) {
    throw new Error('Did not receive INIT message from WebSocket');
  }

  // 2. Test Server Authority: Host starts attendance on Website / Server
  console.log('[Step 1] Website starts attendance via /api/session/action...');
  const startRes = await postJson('/api/session/action', { action: 'start' });
  if (!startRes.body.isTracking) {
    throw new Error('Expected isTracking=true on server');
  }
  console.log('✅ Server isTracking is now TRUE');

  // 3. Test Extension Passive Sync does NOT override server isTracking
  console.log('[Step 2] Extension sends periodic telemetry sync with local isTracking: false (off)...');
  const syncRes = await postJson('/api/session/sync', {
    meetingCode: 'test-room',
    isTracking: false, // Extension was off locally
    isPaused: false,
    participants: {
      'p_john_doe': {
        name: 'John Doe',
        cameraStatus: 'on',
        cameraOnMs: 5000,
        cameraOffMs: 0
      }
    }
  });

  if (!syncRes.body.session) {
    throw new Error('Sync response did not include authoritative session');
  }
  if (!syncRes.body.session.isTracking) {
    throw new Error('FAILED: Passive telemetry sync erroneously turned OFF server tracking!');
  }
  console.log('✅ SUCCESS: Server tracking remained TRUE despite extension having isTracking: false!');
  console.log('✅ Server returned authoritative isTracking=true to extension so extension adopts it!');

  // 4. Test Stop Action from extension (or website)
  console.log('[Step 3] Turning attendance OFF via action...');
  const stopRes = await postJson('/api/session/action', { action: 'stop' });
  if (stopRes.body.isTracking) {
    throw new Error('Expected isTracking=false after stop action');
  }
  console.log('✅ Attendance successfully turned OFF and finalized.');

  ws.close();
  console.log('\n🎉 ALL TWO-WAY LINKING & ANTI-BLINK TESTS PASSED!\n');
}

run().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
