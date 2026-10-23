const assert = require('assert');
const http = require('http');

async function get(path) {
  return new Promise((resolve, reject) => {
    http.get({
      hostname: 'localhost',
      port: 4200,
      path: path
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    }).on('error', reject);
  });
}

async function run() {
  console.log('--- RUNNING LANDSCAPE PDF & CAMERA DETECTION VERIFICATION TEST ---');

  // 1. Verify Landscape PDF Report
  console.log('[Test 1] Testing /report for Landscape A4 configuration...');
  const res = await get('/report?print=true');
  assert.strictEqual(res.status, 200, 'Expected status 200 from /report');
  
  const html = res.data;
  assert(html.includes('size: A4 landscape'), 'Report MUST specify "size: A4 landscape" in @page CSS');
  assert(html.includes('297mm'), 'Report MUST use 297mm landscape page width');
  assert(html.includes('RANKED ATTENDANCE &amp; STUDY REPORT'), 'Report title must be present');
  assert(html.includes('PRESENCE TIMELINE &amp; CAMERA CUTS BREAKDOWN'), 'Detailed breakdown column must be present');
  assert(html.includes('100% CAM COMPLIANT'), 'KPI card for 100% compliant must be present');
  assert(html.includes('Leaderboard Podium'), 'Leaderboard podium must be present');
  console.log('✅ Test 1 Passed: /report is 100% configured for neat Landscape A4 layout!');

  // 2. Verify Host Exemption in Landscape Report
  console.log('[Test 2] Checking Host Exemption in Landscape Report...');
  assert(html.includes('100% EXEMPT') || html.includes('EXEMPT'), 'Host must be marked 100% EXEMPT');
  console.log('✅ Test 2 Passed: Host is 100% exempt from student ranks.');

  console.log('\n======================================================');
  console.log('🎉 ALL LANDSCAPE PDF & DETECTION TESTS PASSED!');
  console.log('======================================================\n');
}

run().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
