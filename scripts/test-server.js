const http = require('http');

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 4200,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: res.headers['content-type']?.includes('json') ? JSON.parse(data) : data });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('[Test 1] Checking /api/status...');
  const statusRes = await request('GET', '/api/status');
  console.log('Status Response:', statusRes.data);

  console.log('\n[Test 2] Testing START Attendance action...');
  const startRes = await request('POST', '/api/session/action', { action: 'start' });
  console.log('Start Response:', startRes.data);
  if (!startRes.data.isTracking) throw new Error('Expected isTracking: true');

  console.log('\n[Test 3] Testing PAUSE Break action...');
  const pauseRes = await request('POST', '/api/session/action', { action: 'pause' });
  console.log('Pause Response:', pauseRes.data);
  if (!pauseRes.data.isPaused) throw new Error('Expected isPaused: true');

  console.log('\n[Test 4] Testing RESUME Break action...');
  const resumeRes = await request('POST', '/api/session/action', { action: 'resume' });
  console.log('Resume Response:', resumeRes.data);
  if (resumeRes.data.isPaused) throw new Error('Expected isPaused: false');

  console.log('\n[Test 5] Testing STOP / OFF Attendance action...');
  const stopRes = await request('POST', '/api/session/action', { action: 'stop' });
  console.log('Stop Response:', stopRes.data);
  if (stopRes.data.isTracking) throw new Error('Expected isTracking: false');

  console.log('\n[Test 6] Testing CSV Export with OFF status...');
  const csvRes = await request('GET', '/api/session/export/csv');
  console.log('CSV Status:', csvRes.status);
  console.log('CSV Snippet:\n', csvRes.data.slice(0, 200));

  console.log('\n>>> ALL START, OFF, PAUSE, RESUME TESTS PASSED! <<<');
}

runTests().catch(err => {
  console.error('[Test Failed]', err);
  process.exit(1);
});
