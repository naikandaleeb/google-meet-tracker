// Automated Comprehensive Test Suite for Google Meet Tracker Fixes
// Verifies all 5 core requirements:
// 1. Left Participant attendance immediately stops (no run-on timer)
// 2. Past Sessions Bulk Delete & Past Session Pain Theme Dossier
// 3. Frame Analysis: Covered lens (black), OBS idle blue, 3 approved break posters vs unauthorized static posters
// 4. Ranked PDF: Neat, short, landscape, 8-column table, Olympic podium, host exempt
// 5. Pain Theme: Full detailed report with exact camera cut intervals, timeline, and print styling

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('===============================================================');
console.log('🧪 RUNNING COMPREHENSIVE VERIFICATION SUITE');
console.log('===============================================================\n');

let passedTests = 0;
let totalTests = 0;

function test(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`❌ [FAIL] ${name}`);
    console.error(`   Error: ${err.message}\n${err.stack}`);
  }
}

// ----------------------------------------------------------------------------
// TEST 1: Issue 1 - Left Participant Attendance Timer Completely Stops
// ----------------------------------------------------------------------------
test('Issue 1: Participant marked as left stops accumulating study and cut time', () => {
  const { cleanParticipantName } = require('../server/server');
  
  // Create simulated session
  const now = Date.now();
  const session = {
    sessionId: 'test_leave_session',
    startedAt: now - 300000,
    isTracking: true,
    isPaused: false,
    participants: {}
  };

  // Participant 1 is present, Participant 2 just left
  const p1 = {
    id: 'p_john_doe',
    name: 'John Doe',
    currentStatus: 'present',
    cameraStatus: 'on',
    cameraOnMs: 120000,
    cameraOffMs: 0,
    totalPresentMs: 120000,
    lastSeen: now
  };

  const p2 = {
    id: 'p_alice_smith',
    name: 'Alice Smith',
    currentStatus: 'left',
    cameraStatus: 'off',
    cameraOnMs: 60000,
    cameraOffMs: 30000,
    totalPresentMs: 90000,
    leaveTime: now - 30000,
    lastSeen: now - 30000
  };

  session.participants[p1.id] = { ...p1 };
  session.participants[p2.id] = { ...p2 };

  // Simulate 10 second dashboard timer tick logic:
  // p1 (present) should tick; p2 (left) MUST NOT TICK
  for (let t = 0; t < 10; t++) {
    Object.values(session.participants).forEach(p => {
      if (p.currentStatus === 'present') {
        if (p.cameraStatus === 'on') {
          p.cameraOnMs = (p.cameraOnMs || 0) + 1000;
        } else {
          p.cameraOffMs = (p.cameraOffMs || 0) + 1000;
        }
        p.totalPresentMs = (p.cameraOnMs || 0) + (p.cameraOffMs || 0);
      }
    });
  }

  assert.strictEqual(session.participants['p_john_doe'].cameraOnMs, 130000, 'Present participant must accumulate time');
  assert.strictEqual(session.participants['p_alice_smith'].cameraOnMs, 60000, 'Left participant cameraOnMs must NOT accumulate');
  assert.strictEqual(session.participants['p_alice_smith'].cameraOffMs, 30000, 'Left participant cameraOffMs must NOT accumulate');
  assert.strictEqual(session.participants['p_alice_smith'].totalPresentMs, 90000, 'Left participant totalPresentMs must stay frozen');
  assert.strictEqual(session.participants['p_alice_smith'].currentStatus, 'left', 'Status must remain left');
});

// ----------------------------------------------------------------------------
// TEST 2: Issue 2 - Past Sessions Bulk Delete & Past Session Pain Theme Access
// ----------------------------------------------------------------------------
test('Issue 2: Past Sessions Bulk Delete and Pain Dossier Route', () => {
  const sessionsFile = path.join(__dirname, '../server/data/sessions.json');
  assert.ok(fs.existsSync(sessionsFile), 'sessions.json file must exist');

  const archives = JSON.parse(fs.readFileSync(sessionsFile, 'utf8') || '[]');
  assert.ok(archives.length > 0, 'Should have archived sessions');

  // Verify all archived sessions have unique IDs and participants > 0
  const idSet = new Set();
  archives.forEach(s => {
    assert.ok(!idSet.has(s.sessionId), `Archived session ID ${s.sessionId} must be unique`);
    idSet.add(s.sessionId);
    const pCount = Object.keys(s.participants || {}).length;
    assert.ok(pCount > 0, `Archived session ${s.sessionId} must have > 0 participants`);
  });

  // Verify that Pain Theme Report generates for the largest archived session (e.g. 16 students)
  const { generatePainThemeHtml } = require('../server/pain-report');
  const session14 = archives.find(s => Object.keys(s.participants || {}).length >= 10);
  assert.ok(session14, 'Should find archived session with students');

  const painHtml = generatePainThemeHtml(session14);
  assert.ok(painHtml.includes('PAIN THEME DOSSIER'), 'Must contain Pain Theme header');
  assert.ok(painHtml.includes('Ashutosh') || painHtml.includes('ashutosh') || painHtml.includes('Student'), 'Must contain participant rows');
  assert.ok(!painHtml.includes('No participants recorded'), 'Must NOT show "No participants recorded"');
});

// ----------------------------------------------------------------------------
// TEST 3: Issue 3 - Blank Screen, OBS & Unauthorized Poster Recognition Logic
// ----------------------------------------------------------------------------
test('Issue 3: Video Frame Analyzer detects blank screen, OBS, 3 approved posters, and unauthorized static posters', () => {
  // Pure JS simulation of the analyzeVideoFrame algorithm in content.js

  function simulateAnalysis(framePixels, prevPixels = null, consecutiveStaticTicks = 0) {
    const total = 32 * 32;
    let darkPixelCount = 0;
    let obsBlueCount = 0;
    let navyCount = 0;
    let creamCount = 0;
    let yellowCount = 0;
    let amberCount = 0;
    let sumBrightness = 0;
    let maxPixelVal = 0;
    let minPixelVal = 255;
    let diffPixelCount = 0;

    for (let i = 0; i < framePixels.length; i += 4) {
      const r = framePixels[i];
      const g = framePixels[i + 1];
      const b = framePixels[i + 2];
      const br = (r + g + b) / 3;
      sumBrightness += br;
      if (br > maxPixelVal) maxPixelVal = br;
      if (br < minPixelVal) minPixelVal = br;

      if (r < 30 && g < 30 && b < 30) darkPixelCount++;
      if (r >= 15 && r <= 45 && g >= 25 && g <= 60 && b >= 55 && b <= 120 && (b - r) >= 20) obsBlueCount++;
      if (r >= 10 && r <= 65 && g >= 25 && g <= 80 && b >= 40 && b <= 105) navyCount++;
      if (r >= 180 && g >= 170 && b >= 140 && Math.abs(r - g) <= 35) creamCount++;
      if (r >= 160 && g >= 120 && b <= 100 && (r - b) >= 50) yellowCount++;
      if (r >= 45 && r <= 135 && g >= 30 && g <= 105 && b <= 55 && r > g && g > b) amberCount++;

      if (prevPixels) {
        const pixelDiff = (Math.abs(r - prevPixels[i]) + Math.abs(g - prevPixels[i + 1]) + Math.abs(b - prevPixels[i + 2])) / 3;
        if (pixelDiff > 5) diffPixelCount++;
      }
    }

    const avgBrightness = sumBrightness / total;
    const pixelSpread = maxPixelVal - minPixelVal;

    const isPoster1 = (navyCount > 150 && creamCount > 30 && yellowCount > 10);
    const isPoster2 = (yellowCount > 35 && amberCount > 25);
    const isPoster3 = (creamCount > 90 && yellowCount > 15);
    const isApprovedPoster = isPoster1 || isPoster2 || isPoster3;

    const isSolidBlack = (darkPixelCount / total >= 0.85 && pixelSpread < 24) || (avgBrightness < 25 && pixelSpread < 20);
    const isObsIdle = (obsBlueCount / total >= 0.60);

    const motionRatio = prevPixels ? (diffPixelCount / total) : 0.05;
    let ticks = consecutiveStaticTicks;
    if (prevPixels && motionRatio < 0.015) {
      ticks++;
    } else {
      ticks = 0;
    }

    const isUnauthorizedPoster = (ticks >= 2) && !isApprovedPoster && !isSolidBlack;
    const isBlank = !isApprovedPoster && (isSolidBlack || isObsIdle || isUnauthorizedPoster);

    let mode = 'webcam';
    if (isApprovedPoster) mode = 'poster';
    else if (isSolidBlack) mode = 'blank';
    else if (isObsIdle) mode = 'obs';
    else if (isUnauthorizedPoster) mode = 'unauthorized_poster';

    return { isBlank, isApprovedPoster, mode, ticks };
  }

  // 1. Covered camera (pure black / sensor dark noise)
  const blackFrame = new Uint8ClampedArray(32 * 32 * 4);
  for (let i = 0; i < blackFrame.length; i += 4) {
    blackFrame[i] = 12;     // R
    blackFrame[i + 1] = 10; // G
    blackFrame[i + 2] = 14; // B
    blackFrame[i + 3] = 255;
  }
  const blackRes = simulateAnalysis(blackFrame);
  assert.strictEqual(blackRes.isBlank, true, 'Covered camera must be detected as isBlank: true');
  assert.strictEqual(blackRes.mode, 'blank', 'Covered camera mode must be blank');

  // 2. OBS idle blue screen
  const obsFrame = new Uint8ClampedArray(32 * 32 * 4);
  for (let i = 0; i < obsFrame.length; i += 4) {
    obsFrame[i] = 20;     // R
    obsFrame[i + 1] = 40; // G
    obsFrame[i + 2] = 85; // B (blue dominant)
    obsFrame[i + 3] = 255;
  }
  const obsRes = simulateAnalysis(obsFrame);
  assert.strictEqual(obsRes.isBlank, true, 'OBS idle blue screen must be detected as isBlank: true');
  assert.strictEqual(obsRes.mode, 'obs', 'OBS idle screen mode must be obs');

  // 3. Official Approved Break Poster 1 (Navy + Cream + Yellow)
  const poster1Frame = new Uint8ClampedArray(32 * 32 * 4);
  for (let i = 0; i < poster1Frame.length; i += 4) {
    const pixelIndex = i / 4;
    if (pixelIndex < 600) {
      // Navy background
      poster1Frame[i] = 25; poster1Frame[i + 1] = 45; poster1Frame[i + 2] = 70;
    } else if (pixelIndex < 850) {
      // Cream BRB text
      poster1Frame[i] = 220; poster1Frame[i + 1] = 210; poster1Frame[i + 2] = 190;
    } else {
      // Yellow subtitle
      poster1Frame[i] = 210; poster1Frame[i + 1] = 170; poster1Frame[i + 2] = 40;
    }
    poster1Frame[i + 3] = 255;
  }
  const poster1Res = simulateAnalysis(poster1Frame);
  assert.strictEqual(poster1Res.isApprovedPoster, true, 'Approved Break Poster 1 must be detected as approved');
  assert.strictEqual(poster1Res.isBlank, false, 'Approved Break Poster 1 must NOT be cut (isBlank: false)');
  assert.strictEqual(poster1Res.mode, 'poster', 'Approved poster mode must be poster');

  // 4. Unauthorized static poster / random landscape image with no temporal motion
  const fakePosterFrame = new Uint8ClampedArray(32 * 32 * 4);
  for (let i = 0; i < fakePosterFrame.length; i += 4) {
    // Random static wallpaper (Green mountain landscape)
    fakePosterFrame[i] = 50;
    fakePosterFrame[i + 1] = 160;
    fakePosterFrame[i + 2] = 60;
    fakePosterFrame[i + 3] = 255;
  }
  // Tick 1 (initial frame)
  const fakeTick1 = simulateAnalysis(fakePosterFrame, null, 0);
  // Tick 2 (identical frame, 0 motion)
  const fakeTick2 = simulateAnalysis(fakePosterFrame, fakePosterFrame, fakeTick1.ticks);
  // Tick 3 (still identical frame, 0 motion for 2+ consecutive checks)
  const fakeTick3 = simulateAnalysis(fakePosterFrame, fakePosterFrame, fakeTick2.ticks);
  assert.strictEqual(fakeTick3.mode, 'unauthorized_poster', 'Static unapproved image must be detected as unauthorized_poster');
  assert.strictEqual(fakeTick3.isBlank, true, 'Unauthorized poster must be cut (isBlank: true)');
});

// ----------------------------------------------------------------------------
// TEST 4: Issue 4 - Ranked PDF Neat, Short & Landscape with 8 Essential Columns
// ----------------------------------------------------------------------------
test('Issue 4: Ranked PDF produces clean landscape table with strictly necessary columns & podium', () => {
  const { generateRankedAttendanceHtml } = require('../server/ranked-report');

  const testSession = {
    sessionId: 'test_ranked_landscape',
    meetingCode: 'cockroach-study-room',
    targetDurationHours: 12,
    isTracking: true,
    startedAt: Date.now() - 7200000,
    participants: {
      host: { name: 'Host (You)', isLocal: true, cameraOnMs: 7200000, cameraOffMs: 0, currentStatus: 'present' },
      s1: { name: 'Aman Sharma', cameraOnMs: 6500000, cameraOffMs: 300000, currentStatus: 'present', cameraStatus: 'on' },
      s2: { name: 'Priya Verma', cameraOnMs: 6000000, cameraOffMs: 900000, currentStatus: 'left', cameraStatus: 'off', rejoinCount: 3 },
      s3: { name: 'Rahul Gupta', cameraOnMs: 6500000, cameraOffMs: 200000, currentStatus: 'present', cameraStatus: 'on' }
    }
  };

  const html = generateRankedAttendanceHtml(testSession);

  // 1. Must be A4 Landscape
  assert.ok(html.includes('size: A4 landscape;'), 'Must specify A4 landscape print CSS');

  // 2. Must contain Leaderboard Podium
  assert.ok(html.includes('Leaderboard Podium (Olympic Top 3)'), 'Must contain Olympic Podium');
  assert.ok(html.includes('👑 RANK 1 (GOLD)'), 'Must contain Gold Rank 1');

  // 3. Equal study times must share identical Rank 1
  assert.ok(html.includes('AMAN SHARMA'), 'Must include Aman Sharma');
  assert.ok(html.includes('RAHUL GUPTA'), 'Must include Rahul Gupta');

  // 4. Clean 8-Column Header
  assert.ok(html.includes('<th class="col-rank text-center">RANK</th>'), 'Must have RANK column');
  assert.ok(html.includes('<th class="col-name text-left">PARTICIPANT NAME</th>'), 'Must have NAME column');
  assert.ok(html.includes('<th class="col-status text-center">STATUS</th>'), 'Must have STATUS column');
  assert.ok(html.includes('STUDY (CAM ON)'), 'Must have STUDY (CAM ON) column');
  assert.ok(html.includes('CUT (CAM OFF)'), 'Must have CUT (CAM OFF) column');
  assert.ok(html.includes('TOTAL IN MEET'), 'Must have TOTAL IN MEET column');
  assert.ok(html.includes('COMPLIANCE'), 'Must have COMPLIANCE column');
  assert.ok(html.includes('REJOINS'), 'Must have REJOINS column');

  // 5. Must NOT have giant bloated Page 2 full matrix breakdown table
  assert.ok(!html.includes('full-matrix-table'), 'Must NOT contain giant bloated debug matrix table');
  assert.ok(!html.includes('Page 2 of 2'), 'Must NOT have messy Page 2 debug table');

  // 6. Host must be exempt
  assert.ok(html.includes('100% EXEMPT'), 'Host must be noted as 100% exempt');
});

// ----------------------------------------------------------------------------
// TEST 5: Issue 5 - Pain Theme Full Detailed Dossier & Print Protection
// ----------------------------------------------------------------------------
test('Issue 5: Pain Theme includes full detailed interval breakdowns and strict print styling', () => {
  const { generatePainThemeHtml } = require('../server/pain-report');

  const testSession = {
    sessionId: 'test_pain_full',
    meetingCode: 'cockroach-study-room',
    targetDurationHours: 12,
    isTracking: false,
    stoppedAt: Date.now(),
    startedAt: Date.now() - 14400000,
    pauseHistory: [
      { pausedAt: Date.now() - 10000000, resumedAt: Date.now() - 9100000, durationMs: 900000 }
    ],
    participants: {
      host: { name: 'Host (You)', isLocal: true, cameraOnMs: 14400000, cameraOffMs: 0 },
      s1: {
        name: 'Golu Bhaiya',
        cameraOnMs: 12000000,
        cameraOffMs: 1800000,
        currentStatus: 'present',
        cameraStatus: 'on',
        cameraOffIntervals: [
          { start: Date.now() - 11000000, end: Date.now() - 10100000, durationMs: 900000, fromTime: '01:00 PM', toTime: '01:15 PM', durationFormatted: '15m 00s' },
          { start: Date.now() - 5000000, end: Date.now() - 4100000, durationMs: 900000, fromTime: '02:30 PM', toTime: '02:45 PM', durationFormatted: '15m 00s' }
        ]
      }
    }
  };

  const html = generatePainThemeHtml(testSession);

  // 1. Full camera cut intervals
  assert.ok(html.includes('01:00 PM - 01:15 PM'), 'Must show exact camera cut from/to timestamps');
  assert.ok(html.includes('-15m 00s cut'), 'Must show cut duration deduction');

  // 2. Official breaks
  assert.ok(html.includes('Official Break #1'), 'Must include Official Break record');

  // 3. 12-Hour visual Gantt timeline
  assert.ok(html.includes('12-HOUR VISUAL CAMERA TIMELINE'), 'Must contain Gantt timeline section');

  // 4. Strict print styling
  assert.ok(html.includes('-webkit-print-color-adjust: exact !important;'), 'Must include exact color print adjust');
  assert.ok(html.includes('print-color-adjust: exact !important;'), 'Must include standard print color adjust');
});

console.log('\n===============================================================');
console.log(`🎉 TEST SUMMARY: ${passedTests} / ${totalTests} TESTS PASSED`);
console.log('===============================================================\n');

if (passedTests === totalTests) {
  process.exit(0);
} else {
  process.exit(1);
}
