const assert = require('assert');
const { generateRankedAttendanceHtml } = require('../server/ranked-report');
const { generatePainThemeHtml } = require('../server/pain-report');

console.log('--- RUNNING JOIN, LEAVE & REJOIN TRACKING VERIFICATION TEST ---');

const now = Date.now();
const t0 = now - 60000; // 60s ago: Participant joined
const t1 = now - 40000; // 40s ago: Participant left call (away for 15s)
const t2 = now - 25000; // 25s ago: Participant rejoined call

const testSession = {
  sessionId: 'test_session_1',
  meetingCode: 'cockroach-test',
  meetingTitle: 'Test Study Session',
  startedAt: t0,
  stoppedAt: null,
  isTracking: true,
  isPaused: false,
  totalPausedMs: 0,
  participants: {
    'local_host': {
      id: 'local_host',
      name: 'Host (You)',
      isLocal: true,
      currentStatus: 'present',
      cameraStatus: 'on',
      cameraOnMs: 60000,
      cameraOffMs: 0,
      totalPresentMs: 60000,
      presenceIntervals: [
        { joinTime: t0, leaveTime: null }
      ],
      joinLeaveHistory: [
        { event: 'joined', time: t0 }
      ]
    },
    'p_student_alpha': {
      id: 'p_student_alpha',
      name: 'Student Alpha',
      currentStatus: 'present',
      cameraStatus: 'on',
      cameraOnMs: 45000, // In meet for 20s (t0 to t1) + 25s (t2 to now) = 45s
      cameraOffMs: 0,
      totalPresentMs: 45000,
      rejoinCount: 1,
      rejoinedAt: t2,
      presenceIntervals: [
        { joinTime: t0, leaveTime: t1, durationMs: 20000 },
        { joinTime: t2, leaveTime: null }
      ],
      joinLeaveHistory: [
        { event: 'joined', time: t0, formatted: '06:00:00 AM' },
        { event: 'left', time: t1, formatted: '06:00:20 AM' },
        { event: 'rejoined', time: t2, formatted: '06:00:35 AM', awayMs: 15000, awayFormatted: '00:00:15' }
      ]
    },
    'p_student_beta': {
      id: 'p_student_beta',
      name: 'Student Beta',
      currentStatus: 'left',
      leaveTime: t1,
      lastSeen: t1,
      cameraStatus: 'off',
      cameraOnMs: 10000,
      cameraOffMs: 10000,
      totalPresentMs: 20000,
      rejoinCount: 0,
      presenceIntervals: [
        { joinTime: t0, leaveTime: t1, durationMs: 20000 }
      ],
      joinLeaveHistory: [
        { event: 'joined', time: t0, formatted: '06:00:00 AM' },
        { event: 'left', time: t1, formatted: '06:00:20 AM' }
      ]
    }
  }
};

// 1. Verify Ranked Report HTML Generation
console.log('[Test 1] Testing Ranked Attendance Report generation...');
const rankedHtml = generateRankedAttendanceHtml(testSession);
assert(rankedHtml.toUpperCase().includes('STUDENT ALPHA'), 'Ranked report must include Student Alpha');
assert(rankedHtml.toUpperCase().includes('STUDENT BETA'), 'Ranked report must include Student Beta');
assert(rankedHtml.includes('EXEMPTED') || rankedHtml.includes('EXEMPT'), 'Ranked report must exempt Host');
console.log('✅ Ranked report generated successfully with Host exempt.');

// 2. Verify Pain / Akatsuki Report HTML Generation
console.log('[Test 2] Testing Pain Akatsuki Report generation...');
const painHtml = generatePainThemeHtml(testSession);
assert(painHtml.toUpperCase().includes('STUDENT ALPHA'), 'Pain report must include Student Alpha');
assert(painHtml.toUpperCase().includes('STUDENT BETA'), 'Pain report must include Student Beta');
console.log('✅ Pain report generated successfully.');

// 3. Verify Server sync & CSV generation with live running server
const http = require('http');

function postJson(urlPath, data) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    const req = http.request({
      hostname: 'localhost',
      port: 4200,
      path: urlPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve(body);
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function get(urlPath) {
  return new Promise((resolve, reject) => {
    http.get({
      hostname: 'localhost',
      port: 4200,
      path: urlPath
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

async function runLiveServerTests() {
  console.log('[Test 3] Testing /api/session/sync with presence intervals and rejoin data...');
  const syncRes = await postJson('/api/session/sync', testSession);
  assert(syncRes.success === true, 'Sync endpoint should succeed');
  assert(syncRes.session.participants.p_student_alpha.rejoinCount === 1, 'Rejoin count must be 1 for Student Alpha');
  assert(syncRes.session.participants.p_student_alpha.presenceIntervals.length >= 2, 'Presence intervals must be preserved');
  assert(syncRes.session.participants.p_student_alpha.joinLeaveHistory.length >= 3, 'Join/Leave history must be preserved');
  console.log('✅ Sync endpoint correctly persisted presence intervals & rejoin history.');

  console.log('[Test 4] Testing CSV export contains Total In Meet, Rejoin Count, and Timeline columns...');
  const csvRes = await get('/api/session/export/csv');
  assert(csvRes.status === 200, 'CSV export should return 200');
  assert(csvRes.body.includes('Rejoin Count'), 'CSV must include Rejoin Count column');
  assert(csvRes.body.includes('Join/Leave & Rejoin Timeline'), 'CSV must include Join/Leave Timeline column');
  assert(csvRes.body.includes('Total In Meet Duration'), 'CSV must include Total In Meet Duration column');
  assert(csvRes.body.includes('REJOINED at'), 'CSV must show REJOINED log for Student Alpha');
  console.log('✅ CSV export verified with complete Rejoin count and Join/Leave timeline!');

  console.log('\n======================================================');
  console.log('🎉 ALL JOIN, LEAVE & REJOIN VERIFICATION TESTS PASSED!');
  console.log('======================================================\n');
}

runLiveServerTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
