const express = require('express');
const cors = require('cors');
const http = require('http');
const { WebSocketServer } = require('ws');
const fs = require('fs');
const path = require('path');
const { generatePainThemeHtml } = require('./pain-report');
const { generateRankedAttendanceHtml, computeDenseRanks } = require('./ranked-report');

const PORT = process.env.PORT || 4200;
const DATA_DIR = path.join(__dirname, 'data');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const CURRENT_SESSION_FILE = path.join(DATA_DIR, 'current-session.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function cleanParticipantName(raw, isLocal = false) {
  if (!raw) return isLocal ? 'Host (You)' : null;
  let s = String(raw).trim();

  // Strip Google Meet UI icon ligatures
  s = s.replace(/keep_outline|more_vert|mic_off|push_pin|volume_up|more_horiz/gi, '').trim();

  // Match Pin/Unpin actions
  const pinMatch = s.match(/(?:Pin|Unpin)\s+(.+?)\s+(?:to|from)\s+(?:your\s+)?(?:main\s+)?screen/i);
  if (pinMatch) s = pinMatch[1].trim();
  s = s.replace(/^(?:Pin|Unpin)\s+/i, '').trim();

  // Identify local participant
  const isYou = /\((?:You)\)/i.test(s) || isLocal || s.toLowerCase() === 'you';

  // Strip parenthetical badges
  s = s.replace(/\s*\((You|Host|Co-host|Presentation|External|Call)\)/gi, '').trim();

  if (!s || s.length === 0) {
    return isYou ? 'Host (You)' : null;
  }

  // Filter pure numbers or percentages
  if (/^\d+$/.test(s) || /^\d{1,2}:\d{2}/.test(s) || /^\d+%/.test(s)) return null;

  // Filter button actions
  const lower = s.toLowerCase();
  const UI_ACTIONS = [
    'turn off', 'turn on', 'visual effects', 'leave call', 'for everyone',
    'click to', 'more options', 'microphone', 'pin to screen', 'dont turn off'
  ];
  for (const act of UI_ACTIONS) {
    if (lower.includes(act)) return null;
  }
  if (lower === 'pin' || lower === 'unpin') return null;

  if (lower === 'host' || lower === 'you') {
    return isYou ? 'Host (You)' : 'Host';
  }

  return s;
}

// In-memory active session state
let currentSession = {
  sessionId: 'session_' + Date.now(),
  meetingCode: 'cockroach-study-room',
  meetingTitle: 'Cockroach Library 12-Hour Study Marathon',
  startedAt: null,
  stoppedAt: null,
  lastUpdated: Date.now(),
  isTracking: false,
  isPaused: false,
  totalPausedMs: 0,
  currentPauseStart: null,
  pauseHistory: [],
  targetDurationHours: 12,
  participants: {},
  notes: ''
};

function formatHmsStr(ms = 0) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function toEpochMs(ts) {
  if (ts === null || ts === undefined || ts === '') return null;
  if (typeof ts === 'number') return isNaN(ts) ? null : ts;
  const parsed = new Date(ts).getTime();
  return isNaN(parsed) ? null : parsed;
}

function calculateTotalInMeetMs(p, now = Date.now()) {
  if (!p) return 0;
  if (Array.isArray(p.presenceIntervals) && p.presenceIntervals.length > 0) {
    let sum = 0;
    p.presenceIntervals.forEach(int => {
      const s = toEpochMs(int.joinTime);
      if (s) {
        const e = toEpochMs(int.leaveTime) || (p.currentStatus === 'present' ? now : toEpochMs(p.lastSeen) || now);
        sum += Math.max(0, e - s);
      }
    });
    return sum;
  }
  const s = toEpochMs(p.joinTime) || toEpochMs(p.firstSeen);
  if (!s) return 0;
  const e = toEpochMs(p.leaveTime) || (p.currentStatus === 'present' ? now : toEpochMs(p.lastSeen) || now);
  return Math.max(0, e - s);
}

function finalizeParticipant(p, sess = {}, now = Date.now()) {
  if (!p) return;

  const joinTs = toEpochMs(p.joinTime) || toEpochMs(p.firstSeen) || toEpochMs(sess.startedAt) || now;
  const leaveTs = toEpochMs(p.leaveTime) || (p.currentStatus === 'left' ? toEpochMs(p.lastSeen) : null);
  const sessionStopTs = toEpochMs(sess.stoppedAt);
  
  // Effective end time: if participant left, use leaveTime; else if session stopped, use stoppedAt; else now
  const effectiveEndTime = leaveTs || sessionStopTs || now;
  const totalInCallMs = Math.max(0, effectiveEndTime - joinTs);

  p.joinTime = joinTs;
  p.firstSeen = joinTs;
  p.leaveTime = leaveTs;
  p.lastSeen = toEpochMs(p.lastSeen) || effectiveEndTime;

  // Open camera interval check
  let openIntervalOnMs = 0;
  let openIntervalOffMs = 0;
  if (Array.isArray(p.cameraIntervals) && p.cameraIntervals.length > 0) {
    const last = p.cameraIntervals[p.cameraIntervals.length - 1];
    if (last && !last.end) {
      const intStart = toEpochMs(last.start) || effectiveEndTime;
      const openDur = Math.max(0, effectiveEndTime - intStart);
      if (last.state === 'on') {
        openIntervalOnMs = openDur;
      } else {
        openIntervalOffMs = openDur;
      }
    }
  }

  // Open cameraOffCurrentStart check
  if (p.cameraOffCurrentStart && (!sess.isPaused || !sess.stoppedAt)) {
    const offStart = toEpochMs(p.cameraOffCurrentStart);
    if (offStart) {
      const liveCutMs = Math.max(0, effectiveEndTime - offStart);
      if (liveCutMs >= 1000) {
        if (!p.cameraOffIntervals) p.cameraOffIntervals = [];
        const exists = p.cameraOffIntervals.some(int => Math.abs(toEpochMs(int.start) - offStart) < 2000);
        if (!exists) {
          p.cameraOffIntervals.push({
            start: offStart,
            end: effectiveEndTime,
            durationMs: liveCutMs,
            fromTime: new Date(offStart).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
            toTime: new Date(effectiveEndTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
            durationFormatted: formatHmsStr(liveCutMs)
          });
        }
      }
    }
  }

  let camOn = p.cameraOnMs !== undefined ? p.cameraOnMs : (p.validStudyMs || 0);
  let camOff = p.cameraOffMs !== undefined ? p.cameraOffMs : 0;

  // Fallback only if both are 0 and open intervals exist
  if (camOn === 0 && camOff === 0) {
    if (openIntervalOnMs > 0 || openIntervalOffMs > 0) {
      camOn = openIntervalOnMs;
      camOff = openIntervalOffMs;
    }
  }

  const totMeet = (p.totalPresentMs && p.totalPresentMs >= camOn + camOff)
    ? p.totalPresentMs
    : (camOn + camOff);

  const validStudy = camOn; // Camera ON time = Valid Study Time
  const totalInMeetMs = calculateTotalInMeetMs(p, now);

  p.cameraOnMs = camOn;
  p.cameraOffMs = camOff;
  p.totalPresentMs = totMeet;
  p.validStudyMs = validStudy;
  p.totalInMeetMs = totalInMeetMs;

  // Standardization aliases across all systems
  p.totalDuration = totMeet;
  p.duration = validStudy;
  p.timeInCall = totalInMeetMs;
  p.durationSeconds = Math.floor(validStudy / 1000);
  p.durationMinutes = Math.floor(validStudy / 60000);
  p.studyDuration = validStudy;

  return p;
}

function cleanAllSessionParticipants(sess) {
  if (!sess || !sess.participants) return;
  const now = Date.now();
  const cleaned = {};
  for (const [k, p] of Object.entries(sess.participants)) {
    const isLocal = p.isLocal || k === 'local_host' || (p.name && p.name.toLowerCase().includes('host'));
    const validName = cleanParticipantName(p.name, isLocal);
    if (validName) {
      const stableKey = isLocal ? 'local_host' : ('p_' + validName.toLowerCase().replace(/[^a-z0-9]/g, '_'));
      
      const candidate = {
        ...p,
        id: stableKey,
        name: validName,
        isLocal: isLocal,
        isHost: isLocal,
        isExempt: isLocal
      };
      
      finalizeParticipant(candidate, sess, now);
      cleaned[stableKey] = candidate;
    }
  }
  sess.participants = cleaned;
}

// Load saved session if exists
try {
  if (fs.existsSync(CURRENT_SESSION_FILE)) {
    const raw = fs.readFileSync(CURRENT_SESSION_FILE, 'utf-8');
    if (raw) {
      currentSession = JSON.parse(raw);
      cleanAllSessionParticipants(currentSession);
    }
  }
} catch (err) {
  console.warn('[Server] Could not load saved current session, starting fresh:', err.message);
}

// Save active session to file debounce
let saveTimeout = null;
function persistCurrentSession() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      fs.writeFileSync(CURRENT_SESSION_FILE, JSON.stringify(currentSession, null, 2), 'utf-8');
    } catch (e) {
      console.error('[Server] Failed to persist session:', e.message);
    }
  }, 1000);
}

function archiveCurrentSession() {
  try {
    let archives = [];
    if (fs.existsSync(SESSIONS_FILE)) {
      archives = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8') || '[]');
    }
    // Only archive if there was actual session data
    if (currentSession.startedAt || Object.keys(currentSession.participants || {}).length > 0) {
      archives.unshift({ ...currentSession, archivedAt: Date.now() });
      if (archives.length > 50) archives = archives.slice(0, 50);
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify(archives, null, 2), 'utf-8');
      console.log('[Server] Successfully archived completed session:', currentSession.sessionId);
    }
  } catch (e) {
    console.error('[Server] Failed to archive session:', e.message);
  }
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(msg) {
  const payload = JSON.stringify(msg);
  wss.clients.forEach(client => {
    if (client.readyState === 1) { // OPEN
      client.send(payload);
    }
  });
}

wss.on('connection', (client) => {
  cleanAllSessionParticipants(currentSession);
  client.send(JSON.stringify({
    type: 'INIT',
    timestamp: Date.now(),
    session: currentSession
  }));
});

// REST Endpoints
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    app: 'Cockroach Library Meet Tracker',
    port: PORT,
    timestamp: Date.now(),
    isTracking: currentSession.isTracking,
    isPaused: currentSession.isPaused,
    participantCount: Object.keys(currentSession.participants || {}).length
  });
});

app.get('/api/session/current', (req, res) => {
  cleanAllSessionParticipants(currentSession);
  res.json(currentSession);
});

// Sync endpoint received from Chrome Extension
app.post('/api/session/sync', (req, res) => {
  const data = req.body;
  if (!data) return res.status(400).json({ error: 'No data provided' });

  // If server was recently reset, inform the extension to adopt the clean zeroed session!
  if (data.sessionId && data.sessionId !== currentSession.sessionId) {
    if (currentSession.lastResetAt && (Date.now() - currentSession.lastResetAt < 600000)) {
      return res.json({ success: true, serverReset: true, session: currentSession });
    }
    if (currentSession.startedAt === null && !currentSession.isTracking && Object.keys(currentSession.participants || {}).length === 0) {
      currentSession.sessionId = data.sessionId;
    }
  }

  if (data.meetingCode) currentSession.meetingCode = data.meetingCode;
  if (data.meetingTitle) currentSession.meetingTitle = data.meetingTitle;
  if (data.targetDurationHours) currentSession.targetDurationHours = data.targetDurationHours;

  // Master tracking and pause state can ONLY be modified if explicit action flag is passed
  // (Prevents background extension telemetry heartbeats from fighting or overriding server controls)
  if (data.isExplicitAction) {
    if (typeof data.isTracking === 'boolean') currentSession.isTracking = data.isTracking;
    if (typeof data.isPaused === 'boolean') currentSession.isPaused = data.isPaused;
    if (data.startedAt && !currentSession.startedAt) currentSession.startedAt = data.startedAt;
    if (data.stoppedAt !== undefined) currentSession.stoppedAt = data.stoppedAt;
    if (typeof data.totalPausedMs === 'number') currentSession.totalPausedMs = data.totalPausedMs;
    if (data.pauseHistory) currentSession.pauseHistory = data.pauseHistory;
    if (data.currentPauseStart !== undefined) currentSession.currentPauseStart = data.currentPauseStart;
  }

  currentSession.lastUpdated = Date.now();

  // Merge participants with clean name enforcement and valid study time calculation
  if (data.participants && typeof data.participants === 'object') {
    if (!currentSession.participants) currentSession.participants = {};
    for (const [key, p] of Object.entries(data.participants)) {
      const isLocal = p.isLocal || key === 'local_host';
      const validName = cleanParticipantName(p.name, isLocal);
      if (validName) {
        const stableKey = isLocal ? 'local_host' : ('p_' + validName.toLowerCase().replace(/[^a-z0-9]/g, '_'));
        const existing = currentSession.participants[stableKey] || {};
        
        const camOn = p.cameraOnMs !== undefined ? p.cameraOnMs : (existing.cameraOnMs || 0);
        const camOff = p.cameraOffMs !== undefined ? p.cameraOffMs : (existing.cameraOffMs || 0);
        const totMeet = (p.totalPresentMs && p.totalPresentMs >= camOn + camOff) ? p.totalPresentMs : (camOn + camOff);

        // Merge cameraOffIntervals safely
        const combinedOffIntervals = [...(existing.cameraOffIntervals || [])];
        if (p.cameraOffIntervals && Array.isArray(p.cameraOffIntervals)) {
          p.cameraOffIntervals.forEach(newInt => {
            if (!combinedOffIntervals.some(ex => Math.abs((ex.start || 0) - (newInt.start || 0)) < 2000)) {
              combinedOffIntervals.push(newInt);
            }
          });
        }

        // Merge presenceIntervals safely
        const combinedPresenceIntervals = [...(existing.presenceIntervals || [])];
        if (p.presenceIntervals && Array.isArray(p.presenceIntervals)) {
          p.presenceIntervals.forEach(newInt => {
            const newJoin = toEpochMs(newInt.joinTime) || 0;
            if (!combinedPresenceIntervals.some(ex => Math.abs((toEpochMs(ex.joinTime) || 0) - newJoin) < 2000)) {
              combinedPresenceIntervals.push(newInt);
            }
          });
        }

        // Merge joinLeaveHistory safely
        const combinedJoinLeaveHistory = [...(existing.joinLeaveHistory || [])];
        if (p.joinLeaveHistory && Array.isArray(p.joinLeaveHistory)) {
          p.joinLeaveHistory.forEach(newEv => {
            const newTime = toEpochMs(newEv.time) || 0;
            if (!combinedJoinLeaveHistory.some(ex => ex.event === newEv.event && Math.abs((toEpochMs(ex.time) || 0) - newTime) < 2000)) {
              combinedJoinLeaveHistory.push(newEv);
            }
          });
        }

        const rejoinCount = Math.max(p.rejoinCount || 0, existing.rejoinCount || 0);
        const rejoinedAt = p.rejoinedAt || existing.rejoinedAt || null;

        const mergedParticipantObj = {
          ...existing,
          ...p,
          id: stableKey,
          name: validName,
          isLocal: isLocal,
          presenceIntervals: combinedPresenceIntervals.length > 0 ? combinedPresenceIntervals : (p.presenceIntervals || existing.presenceIntervals || []),
          currentStatus: p.currentStatus || existing.currentStatus || 'present',
          lastSeen: p.lastSeen || Date.now()
        };

        const totalInMeetMs = calculateTotalInMeetMs(mergedParticipantObj, Date.now());

        currentSession.participants[stableKey] = {
          ...mergedParticipantObj,
          totalPresentMs: totMeet,
          cameraOnMs: camOn,
          cameraOffMs: camOff,
          validStudyMs: camOn, // Strictly: Camera ON time = Valid Study Time
          totalInMeetMs: totalInMeetMs,
          timeInCall: totalInMeetMs,
          rejoinCount: rejoinCount,
          rejoinedAt: rejoinedAt,
          presenceIntervals: combinedPresenceIntervals.length > 0 ? combinedPresenceIntervals : (p.presenceIntervals || existing.presenceIntervals || []),
          joinLeaveHistory: combinedJoinLeaveHistory.length > 0 ? combinedJoinLeaveHistory : (p.joinLeaveHistory || existing.joinLeaveHistory || []),
          cameraOffIntervals: combinedOffIntervals,
          cameraIntervals: p.cameraIntervals || existing.cameraIntervals || [],
          videoDetectionMode: p.videoDetectionMode || existing.videoDetectionMode || 'off',
          lastSeen: p.lastSeen || Date.now()
        };
      }
    }
  }

  persistCurrentSession();

  broadcast({
    type: 'SESSION_UPDATE',
    session: currentSession
  });

  res.json({ success: true, timestamp: Date.now(), session: currentSession });
});

// Control actions: Start, Stop (Off), Pause, Resume, Reset
app.post('/api/session/action', (req, res) => {
  const { action, payload } = req.body || {};
  const now = Date.now();

  if (action === 'start') {
    // If payload requests fresh start, archive previous and clean
    if (payload && payload.resetFirst) {
      archiveCurrentSession();
      currentSession.sessionId = 'session_' + now;
      currentSession.startedAt = now;
      currentSession.stoppedAt = null;
      currentSession.totalPausedMs = 0;
      currentSession.currentPauseStart = null;
      currentSession.pauseHistory = [];
      currentSession.participants = {};
    } else {
      if (!currentSession.startedAt) {
        currentSession.startedAt = now;
      }
      currentSession.stoppedAt = null;
    }

    currentSession.isTracking = true;
    currentSession.isPaused = false;
    currentSession.currentPauseStart = null;
    currentSession.lastResetAt = null;
    currentSession.lastUpdated = now;

    // Reset participant camera tracking counters so they start cleanly with attendance
    Object.values(currentSession.participants || {}).forEach(p => {
      p.consecutiveCamOffMs = 0;
      if (p.cameraStatus === 'off') {
        p.cameraOffCurrentStart = now;
      } else {
        p.cameraOffCurrentStart = null;
      }
    });

    persistCurrentSession();
    broadcast({ type: 'ACTION_START', timestamp: now, session: currentSession });
    console.log('[Server] Attendance STARTED at', new Date(now).toLocaleTimeString());
    return res.json({ success: true, isTracking: true, isPaused: false, session: currentSession });
  }

  if (action === 'stop') {
    currentSession.isTracking = false;
    currentSession.isPaused = false;
    currentSession.stoppedAt = now;
    currentSession.lastUpdated = now;

    // Calculate final study duration and close any open intervals
    Object.values(currentSession.participants || {}).forEach(p => {
      if (p.cameraIntervals && p.cameraIntervals.length > 0) {
        const last = p.cameraIntervals[p.cameraIntervals.length - 1];
        if (last && !last.end) last.end = now;
      }
      if (p.cameraOffCurrentStart) {
        const dur = now - p.cameraOffCurrentStart;
        if (dur >= 2000) {
          const fromTime = new Date(p.cameraOffCurrentStart).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
          const toTime = new Date(now).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
          const sec = Math.floor(dur / 1000);
          const durStr = `${Math.floor(sec / 60)}m ${sec % 60}s`;
          if (!p.cameraOffIntervals) p.cameraOffIntervals = [];
          p.cameraOffIntervals.push({
            start: p.cameraOffCurrentStart,
            end: now,
            durationMs: dur,
            fromTime,
            toTime,
            durationFormatted: durStr
          });
        }
        p.cameraOffCurrentStart = null;
      }
    });

    persistCurrentSession();
    archiveCurrentSession();
    broadcast({ type: 'ACTION_STOP', timestamp: now, session: currentSession });
    console.log('[Server] Attendance TURNED OFF (Finalized) at', new Date(now).toLocaleTimeString());
    return res.json({ success: true, isTracking: false, isPaused: false, session: currentSession });
  }

  if (action === 'pause') {
    if (currentSession.isTracking && !currentSession.isPaused) {
      currentSession.isPaused = true;
      currentSession.currentPauseStart = now;

      // Close open camera OFF intervals so break time is NOT counted as camera off
      Object.values(currentSession.participants || {}).forEach(p => {
        if (p.cameraOffCurrentStart) {
          const offDur = Math.max(0, now - p.cameraOffCurrentStart);
          if (offDur >= 1000) {
            if (!p.cameraOffIntervals) p.cameraOffIntervals = [];
            p.cameraOffIntervals.push({
              start: p.cameraOffCurrentStart,
              end: now,
              durationMs: offDur,
              fromTime: new Date(p.cameraOffCurrentStart).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
              toTime: new Date(now).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
              durationFormatted: formatHmsStr(offDur)
            });
          }
          p.cameraOffCurrentStart = null;
        }
      });

      persistCurrentSession();
      broadcast({ type: 'ACTION_PAUSE', timestamp: now, session: currentSession });
      console.log('[Server] Attendance PAUSED for break at', new Date(now).toLocaleTimeString());
    }
    return res.json({ success: true, isPaused: true, session: currentSession });
  }

  if (action === 'resume') {
    if (currentSession.isTracking && currentSession.isPaused) {
      currentSession.isPaused = false;
      const pauseDuration = currentSession.currentPauseStart ? (now - currentSession.currentPauseStart) : 0;
      currentSession.totalPausedMs = (currentSession.totalPausedMs || 0) + pauseDuration;
      if (!currentSession.pauseHistory) currentSession.pauseHistory = [];
      currentSession.pauseHistory.push({
        pausedAt: currentSession.currentPauseStart || (now - pauseDuration),
        resumedAt: now,
        durationMs: pauseDuration
      });
      currentSession.currentPauseStart = null;

      // Restart cameraOffCurrentStart for participants whose camera is still off
      Object.values(currentSession.participants || {}).forEach(p => {
        if (p.cameraStatus === 'off' && p.currentStatus === 'present') {
          p.cameraOffCurrentStart = now;
        } else {
          p.cameraOffCurrentStart = null;
        }
      });

      persistCurrentSession();
      broadcast({ type: 'ACTION_RESUME', timestamp: now, session: currentSession });
      console.log('[Server] Attendance RESUMED at', new Date(now).toLocaleTimeString());
    }
    return res.json({ success: true, isPaused: false, session: currentSession });
  }

  if (action === 'reset') {
    // Archive previous completed session
    archiveCurrentSession();

    // Start completely clean zeroed session
    currentSession = {
      sessionId: 'session_' + now,
      meetingCode: payload?.meetingCode || currentSession.meetingCode || 'cockroach-study-room',
      meetingTitle: 'Cockroach Library 12-Hour Study Marathon',
      startedAt: null,
      stoppedAt: null,
      lastUpdated: now,
      lastResetAt: now,
      isTracking: false,
      isPaused: false,
      totalPausedMs: 0,
      currentPauseStart: null,
      pauseHistory: [],
      targetDurationHours: 12,
      participants: {},
      notes: ''
    };
    persistCurrentSession();
    broadcast({ type: 'ACTION_RESET', timestamp: now, session: currentSession });
    console.log('[Server] Session RESET: Created fresh session at 00:00:00', currentSession.sessionId);
    return res.json({ success: true, isTracking: false, isPaused: false, session: currentSession });
  }

  if (action === 'update_target') {
    if (payload?.targetDurationHours) {
      currentSession.targetDurationHours = Number(payload.targetDurationHours);
      persistCurrentSession();
      broadcast({ type: 'SESSION_UPDATE', session: currentSession });
    }
    return res.json({ success: true });
  }

  res.status(400).json({ error: 'Unknown action' });
});

// List archived sessions
app.get('/api/sessions', (req, res) => {
  try {
    let archives = [];
    if (fs.existsSync(SESSIONS_FILE)) {
      archives = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8') || '[]');
    }
    res.json(archives);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Primary Report: By default serves the Ranked Attendance Report matching user's sample PDF
// Pass ?theme=pain to view the Akatsuki theme
app.get('/report', (req, res) => {
  cleanAllSessionParticipants(currentSession);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const theme = (req.query.theme || '').toLowerCase();
  if (theme === 'pain') {
    res.send(generatePainThemeHtml(currentSession));
  } else {
    res.send(generateRankedAttendanceHtml(currentSession));
  }
});

app.get('/api/session/export/pdf', (req, res) => {
  cleanAllSessionParticipants(currentSession);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const theme = (req.query.theme || '').toLowerCase();
  if (theme === 'pain') {
    res.send(generatePainThemeHtml(currentSession));
  } else {
    res.send(generateRankedAttendanceHtml(currentSession));
  }
});

// Helper: Build Dense-Ranked CSV content for any session (Current or Archived)
function buildCsvContent(sess) {
  cleanAllSessionParticipants(sess);
  const participants = Object.values(sess.participants || {}).filter(p => {
    return p.name && !p.name.toLowerCase().includes('keep_outline');
  });

  const formatDate = (ts) => ts ? new Date(ts).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A';

  // Compute dense ranks
  computeDenseRanks(participants);

  const rows = [];
  rows.push(['Cockroach Library 12-Hour Study Attendance & Camera Tracking Report']);
  rows.push(['Meeting Code', sess.meetingCode || 'N/A']);
  rows.push(['Status', sess.isTracking ? (sess.isPaused ? 'PAUSED' : 'TRACKING ACTIVE') : 'ATTENDANCE FINALIZED / OFF']);
  rows.push(['Started At', formatDate(sess.startedAt)]);
  rows.push(['Stopped At', formatDate(sess.stoppedAt)]);
  rows.push(['Total Pause / Break Time', formatHmsStr(sess.totalPausedMs)]);
  rows.push(['Total Participants Tracked', participants.length]);
  rows.push([]);
  rows.push([
    'Rank',
    'Participant Name',
    'Presence Status',
    'Current Camera',
    'Total Attendance / Valid Study Duration',
    'Deducted / Cut Time (Cam OFF)',
    'Total In Meet Duration',
    'Camera Compliance %',
    'Rejoin Count',
    'Join/Leave & Rejoin Timeline',
    'Camera OFF Intervals (Exact Breakdown)',
    'First Joined (IST)',
    'Last Seen (IST)'
  ]);

  participants.forEach(p => {
    const totMeet = p.totalPresentMs || 0;
    const camOn = p.cameraOnMs || 0;
    const camOff = p.cameraOffMs || 0;
    const totalInMeet = p.totalInMeetMs || totMeet;
    const camPercent = totMeet > 0 ? ((camOn / totMeet) * 100).toFixed(1) + '%' : '0.0%';

    const offList = (p.cameraOffIntervals || []).map(int => {
      const from = int.fromTime || (int.start ? new Date(int.start).toLocaleTimeString('en-IN') : '');
      const to = int.toTime || (int.end ? new Date(int.end).toLocaleTimeString('en-IN') : 'Present');
      const dur = int.durationFormatted || formatHmsStr(int.durationMs || 0);
      return `${from} - ${to} (${dur})`;
    }).join('; ');

    const joinLeaveLog = (p.joinLeaveHistory || []).map(ev => {
      const timeStr = ev.formatted || (ev.time ? new Date(ev.time).toLocaleTimeString('en-IN') : '');
      const awayStr = ev.awayFormatted ? ` (away ${ev.awayFormatted})` : '';
      return `${(ev.event || '').toUpperCase()} at ${timeStr}${awayStr}`;
    }).join('; ');

    const isHost = p.isLocal || p.id === 'local_host' || (p.name && p.name.toLowerCase().includes('host'));
    const rankLabel = isHost ? 'EXEMPT [HOST]' : (`#${p.rank}${p.rank === 1 ? ' [👑 RANK 1]' : ''}`);

    rows.push([
      rankLabel,
      `"${(p.name || 'Unknown').replace(/"/g, '""')}"`,
      p.currentStatus || 'present',
      (p.cameraStatus || 'off').toUpperCase(),
      formatHmsStr(camOn),
      `-${formatHmsStr(camOff)}`,
      formatHmsStr(totalInMeet),
      camPercent,
      p.rejoinCount || 0,
      `"${joinLeaveLog.replace(/"/g, '""')}"`,
      `"${offList.replace(/"/g, '""')}"`,
      formatDate(p.firstSeen),
      formatDate(p.lastSeen)
    ]);
  });

  return '\uFEFF' + rows.map(r => r.join(',')).join('\r\n');
}

// Helper to look up an archived session
function findArchivedSession(id) {
  if (currentSession && currentSession.sessionId === id) {
    return currentSession;
  }
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const archives = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8') || '[]');
      return archives.find(s => s.sessionId === id) || null;
    }
  } catch (err) {
    console.error('[Server] Error reading archives:', err.message);
  }
  return null;
}

// Delete an archived session
app.delete('/api/session/:id', (req, res) => {
  try {
    const id = req.params.id;
    let archives = [];
    if (fs.existsSync(SESSIONS_FILE)) {
      archives = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8') || '[]');
    }
    const beforeCount = archives.length;
    archives = archives.filter(s => s.sessionId !== id);
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(archives, null, 2), 'utf-8');
    console.log(`[Server] 🗑️ Deleted archived session ${id}. Before: ${beforeCount}, After: ${archives.length}`);
    res.json({ success: true, deletedId: id, remaining: archives.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// View a specific archived session
app.get('/api/session/:id', (req, res) => {
  const sess = findArchivedSession(req.params.id);
  if (!sess) return res.status(404).json({ error: 'Session not found' });
  cleanAllSessionParticipants(sess);
  res.json(sess);
});

// Generate Ranked Attendance Report for a specific archived session
app.get('/api/session/:id/report', (req, res) => {
  const sess = findArchivedSession(req.params.id);
  if (!sess) return res.status(404).send('Archived session not found');
  cleanAllSessionParticipants(sess);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const theme = (req.query.theme || '').toLowerCase();
  if (theme === 'pain') {
    res.send(generatePainThemeHtml(sess));
  } else {
    res.send(generateRankedAttendanceHtml(sess));
  }
});

// Export CSV for a specific archived session
app.get('/api/session/:id/export/csv', (req, res) => {
  const sess = findArchivedSession(req.params.id);
  if (!sess) return res.status(404).send('Archived session not found');
  cleanAllSessionParticipants(sess);

  const csvContent = buildCsvContent(sess);
  const filename = `cockroach_attendance_${sess.meetingCode || 'room'}_${sess.sessionId}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csvContent);
});

// Restore / Load an archived session as active session
app.post('/api/session/:id/restore', (req, res) => {
  const sess = findArchivedSession(req.params.id);
  if (!sess) return res.status(404).json({ error: 'Archived session not found' });

  currentSession = JSON.parse(JSON.stringify(sess));
  cleanAllSessionParticipants(currentSession);
  persistCurrentSession();
  broadcast({ type: 'SESSION_UPDATE', session: currentSession });
  console.log(`[Server] Restored archived session ${req.params.id} to active dashboard view`);
  res.json({ success: true, session: currentSession });
});

// CSV Export for active session
app.get('/api/session/export/csv', (req, res) => {
  const csvContent = buildCsvContent(currentSession);
  const filename = `cockroach_attendance_${currentSession.meetingCode || 'room'}_${Date.now()}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csvContent);
});

// JSON Export
app.get('/api/session/export/json', (req, res) => {
  cleanAllSessionParticipants(currentSession);
  const filename = `cockroach_attendance_${currentSession.meetingCode}_${Date.now()}.json`;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify(currentSession, null, 2));
});

// WebSocket connection
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({
    type: 'INIT',
    session: currentSession
  }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
      }
    } catch (e) {
      // ignore
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n===============================================================`);
  console.log(`🪳 COCKROACH LIBRARY MEET TRACKER SERVER`);
  console.log(`⚡ Dedicated Port: http://localhost:${PORT}`);
  console.log(`📊 Study Dashboard: http://localhost:${PORT}`);
  console.log(`📄 Ranked Attendance Report: http://localhost:${PORT}/report?print=true`);
  console.log(`📡 WebSocket Feed: ws://localhost:${PORT}/ws`);
  console.log(`🛡️ Separate from any existing study tracker port`);
  console.log(`===============================================================\n`);
});
