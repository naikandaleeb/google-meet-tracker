// Cockroach Library - 12-Hour Study & Camera Dashboard Client (Dense Ranking & Frozen Pause Edition)
let state = {
  sessionId: null,
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
  participants: {}
};

let ws = null;
let currentSearch = '';
let currentFilter = 'all';

// DOM Elements
const wsStatusPill = document.getElementById('ws-status');
const meetingCodeDisplay = document.getElementById('display-meeting-code');
const sessionStudyClock = document.getElementById('session-study-clock');
const sessionProgressFill = document.getElementById('session-progress-fill');
const sessionProgressText = document.getElementById('session-progress-text');
const sessionTargetText = document.getElementById('session-target-text');
const cardStatusBadge = document.getElementById('card-status-badge');

const masterOffGroup = document.getElementById('master-off-group');
const masterRunningGroup = document.getElementById('master-running-group');
const btnMasterStart = document.getElementById('btn-master-start');
const btnMasterResetDash = document.getElementById('btn-master-reset-dash');
const btnMasterPause = document.getElementById('btn-master-pause');
const btnMasterStop = document.getElementById('btn-master-stop');
const btnMasterResetSm = document.getElementById('btn-master-reset-sm');
const masterToggleIcon = document.getElementById('master-toggle-icon');
const masterToggleLabel = document.getElementById('master-toggle-label');
const masterToggleSub = document.getElementById('master-toggle-sub');
const dashAttendanceBadge = document.getElementById('dash-attendance-badge');
const totalBreaksCount = document.getElementById('total-breaks-count');
const totalPausedDuration = document.getElementById('total-paused-duration');

const pausedBanner = document.getElementById('paused-banner');
const currentBreakTimer = document.getElementById('current-break-timer');
const btnResumeBanner = document.getElementById('btn-resume-banner');

const defaulterAlert = document.getElementById('defaulter-alert');
const defaulterCount = document.getElementById('defaulter-count');
const defaulterNames = document.getElementById('defaulter-names');
const btnFilterDefaulters = document.getElementById('btn-filter-defaulters');

const camActiveCount = document.getElementById('cam-active-count');
const camCompliancePercent = document.getElementById('cam-compliance-percent');
const camComplianceBar = document.getElementById('cam-compliance-bar');
const camActiveDot = document.getElementById('cam-active-dot');

const attendeesPresentCount = document.getElementById('attendees-present-count');
const attendeesTotalCount = document.getElementById('attendees-total-count');
const attendeesLeftCount = document.getElementById('attendees-left-count');
const sessionStartedLabel = document.getElementById('session-started-label');

const studentsTbody = document.getElementById('students-tbody');
const tabCountAttendees = document.getElementById('tab-count-attendees');
const studentSearchInput = document.getElementById('student-search-input');
const statusFilterSelect = document.getElementById('status-filter');

const btnExportPdf = document.getElementById('btn-export-pdf');
const btnExportCsv = document.getElementById('btn-export-csv');
const btnExportJson = document.getElementById('btn-export-json');
const btnResetSession = document.getElementById('btn-reset-session');

const studentModal = document.getElementById('student-modal');
const btnCloseModal = document.getElementById('btn-close-modal');

// Format Helpers
function formatHms(ms = 0) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatIstTime(ts) {
  if (!ts) return '--:--';
  const d = new Date(ts);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
}

function formatTimeOnly(ts) {
  if (!ts) return '--:--';
  const d = new Date(ts);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function escapeHtml(str = '') {
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[m]);
}

function toEpochMs(ts) {
  if (ts === null || ts === undefined || ts === '') return null;
  if (typeof ts === 'number') return isNaN(ts) ? null : ts;
  const parsed = new Date(ts).getTime();
  return isNaN(parsed) ? null : parsed;
}

// Pure & Robust Math for Active Study Time (No Jumps, No Back-Counting)
function calculateActiveStudyMs(sess, now = Date.now()) {
  if (!sess) return 0;
  const startedAt = toEpochMs(sess.startedAt);
  if (!startedAt) return 0;
  const stoppedAt = toEpochMs(sess.stoppedAt);
  if (stoppedAt) {
    const elapsed = Math.max(0, stoppedAt - startedAt);
    return Math.max(0, elapsed - (sess.totalPausedMs || 0));
  }
  if (sess.isPaused) {
    // PAUSED: Study clock stays completely FROZEN at the moment pause was clicked!
    const pauseStart = toEpochMs(sess.currentPauseStart) || now;
    const elapsedUpToPause = Math.max(0, pauseStart - startedAt);
    return Math.max(0, elapsedUpToPause - (sess.totalPausedMs || 0));
  }
  const elapsed = Math.max(0, now - startedAt);
  return Math.max(0, elapsed - (sess.totalPausedMs || 0));
}

function showToast(msg) {
  const toast = document.getElementById('toast-notify');
  if (!toast) return;
  toast.innerText = msg;
  toast.style.display = 'block';
  setTimeout(() => {
    toast.style.display = 'none';
  }, 3500);
}

// WebSocket Setup
function mergeSessionState(incoming) {
  if (!incoming) return;

  state.sessionId = incoming.sessionId || state.sessionId;
  state.meetingCode = incoming.meetingCode || state.meetingCode;
  state.meetingTitle = incoming.meetingTitle || state.meetingTitle;
  state.startedAt = incoming.startedAt !== undefined ? incoming.startedAt : state.startedAt;
  state.stoppedAt = incoming.stoppedAt !== undefined ? incoming.stoppedAt : state.stoppedAt;
  state.isTracking = typeof incoming.isTracking === 'boolean' ? incoming.isTracking : state.isTracking;
  state.isPaused = typeof incoming.isPaused === 'boolean' ? incoming.isPaused : state.isPaused;
  state.totalPausedMs = typeof incoming.totalPausedMs === 'number' ? incoming.totalPausedMs : state.totalPausedMs;
  state.currentPauseStart = incoming.currentPauseStart !== undefined ? incoming.currentPauseStart : state.currentPauseStart;
  state.pauseHistory = incoming.pauseHistory || state.pauseHistory;
  state.targetDurationHours = incoming.targetDurationHours || state.targetDurationHours;
  state.lastUpdated = incoming.lastUpdated || Date.now();

  // Merge participants MONOTONICALLY so timers NEVER jump backwards!
  if (incoming.participants) {
    if (!state.participants) state.participants = {};

    for (const [id, inc] of Object.entries(incoming.participants)) {
      const existing = state.participants[id];
      if (!existing) {
        state.participants[id] = { ...inc };
      } else {
        // Monotonic progression: Never let network latency cause timers to jerk backwards!
        const maxOn = Math.max(existing.cameraOnMs || 0, inc.cameraOnMs || 0);
        const maxOff = Math.max(existing.cameraOffMs || 0, inc.cameraOffMs || 0);
        const tot = maxOn + maxOff;
        const maxTotalMeet = Math.max(existing.totalInMeetMs || 0, inc.totalInMeetMs || 0, tot);
        const rejoinCnt = Math.max(existing.rejoinCount || 0, inc.rejoinCount || 0);

        const incomingStatus = inc.currentStatus || existing.currentStatus || 'present';
        const isPres = (incomingStatus === 'present');
        const isCamOn = isPres && (inc.cameraStatus === 'on' || (existing.cameraStatus === 'on' && inc.cameraStatus !== 'off'));

        state.participants[id] = {
          ...existing,
          ...inc,
          currentStatus: incomingStatus,
          cameraStatus: isCamOn ? 'on' : 'off',
          leaveTime: !isPres ? (inc.leaveTime || existing.leaveTime || Date.now()) : null,
          cameraOnMs: maxOn,
          cameraOffMs: maxOff,
          validStudyMs: maxOn,
          totalPresentMs: tot,
          totalDuration: tot,
          duration: maxOn,
          timeInCall: maxTotalMeet,
          totalInMeetMs: maxTotalMeet,
          rejoinCount: rejoinCnt,
          rejoinedAt: inc.rejoinedAt || existing.rejoinedAt || null,
          presenceIntervals: inc.presenceIntervals || existing.presenceIntervals || [],
          joinLeaveHistory: inc.joinLeaveHistory || existing.joinLeaveHistory || [],
          cameraOffCurrentStart: !isPres ? null : (inc.cameraOffCurrentStart !== undefined ? inc.cameraOffCurrentStart : existing.cameraOffCurrentStart),
          cameraOffIntervals: inc.cameraOffIntervals || existing.cameraOffIntervals || [],
          videoDetectionMode: isCamOn ? (inc.cameraStatus === 'on' ? (inc.videoDetectionMode || 'webcam') : (existing.videoDetectionMode || 'webcam')) : 'off'
        };
      }
    }

    for (const id of Object.keys(state.participants)) {
      if (!incoming.participants[id]) {
        delete state.participants[id];
      }
    }
  }
}

let renderRafId = null;
function scheduleRenderUI() {
  if (document.hidden) return;
  if (renderRafId) return;
  renderRafId = requestAnimationFrame(() => {
    renderRafId = null;
    renderUI();
  });
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    scheduleRenderUI();
  }
});

function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    wsStatusPill.className = 'live-pill online';
    wsStatusPill.querySelector('.status-label').innerText = 'LIVE SYNCED';
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'ACTION_RESET') {
        if (data.session) {
          state = data.session;
          scheduleRenderUI();
        }
      } else if (data.type === 'INIT' || data.type === 'SESSION_UPDATE' || data.type === 'ACTION_START' || data.type === 'ACTION_STOP') {
        if (data.session) {
          mergeSessionState(data.session);
          scheduleRenderUI();
        }
      } else if (data.type === 'ACTION_PAUSE') {
        if (data.session) {
          mergeSessionState(data.session);
        } else {
          state.isPaused = true;
          state.currentPauseStart = data.timestamp;
        }
        scheduleRenderUI();
      } else if (data.type === 'ACTION_RESUME') {
        if (data.session) {
          mergeSessionState(data.session);
        } else {
          state.isPaused = false;
          state.currentPauseStart = null;
        }
        scheduleRenderUI();
      } else if (data.type === 'PARTICIPANT_OVERRIDE') {
        if (data.session) {
          mergeSessionState(data.session);
        } else if (data.participantId && state.participants && state.participants[data.participantId]) {
          state.participants[data.participantId].manualCamOverride = data.manualCamOverride;
          if (data.manualCamOverride) {
            state.participants[data.participantId].cameraStatus = 'on';
            state.participants[data.participantId].rawCameraStatus = 'on';
            state.participants[data.participantId].cameraOffCurrentStart = null;
          }
        }
        scheduleRenderUI();
      }
    } catch (e) {
      console.error('WebSocket parse error:', e);
    }
  };

  ws.onclose = () => {
    wsStatusPill.className = 'live-pill';
    wsStatusPill.querySelector('.status-label').innerText = 'RECONNECTING...';
    setTimeout(initWebSocket, 3000);
  };

  ws.onerror = () => {
    ws.close();
  };
}

// Fetch initial state (skips polling when WebSocket is healthy to prevent lag)
async function fetchCurrentSession(force = false) {
  if (!force && ws && ws.readyState === WebSocket.OPEN) return;
  try {
    const res = await fetch('/api/session/current');
    if (res.ok) {
      const incoming = await res.json();
      if (state.sessionId && incoming.sessionId !== state.sessionId) {
        state = incoming;
      } else {
        mergeSessionState(incoming);
      }
      scheduleRenderUI();
    }
  } catch (e) {
    console.error('Fetch error:', e);
  }
}

// Master Action Dispatcher
async function sendAction(action, payload = {}) {
  try {
    const res = await fetch('/api/session/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload })
    });
    const result = await res.json();
    if (result.success) {
      if (action === 'start') {
        state.isTracking = true;
        state.isPaused = false;
        showToast('▶️ Attendance tracking STARTED! Live timers running.');
      } else if (action === 'stop') {
        state.isTracking = false;
        state.isPaused = false;
        showToast('⏹️ Attendance FINALIZED & FROZEN! Results remain visible.');
      } else if (action === 'pause') {
        state.isPaused = true;
        showToast('⏸️ Study session paused for break!');
      } else if (action === 'resume') {
        state.isPaused = false;
        showToast('▶️ Study session resumed! Timers active.');
      } else if (action === 'reset') {
        state = result.session;
        showToast('🔄 Session ARCHIVED & RESET to 00:00:00!');
      }
      if (result.session) state = result.session;
      renderUI();
    }
  } catch (err) {
    showToast('❌ Failed to execute action: ' + err.message);
  }
}

// Event Listeners for Controls
if (btnMasterStart) {
  btnMasterStart.addEventListener('click', () => {
    if (state.stoppedAt && state.startedAt) {
      const activeMs = calculateActiveStudyMs(state, Date.now());
      const startFresh = confirm(
        `A previous completed attendance session exists (${formatHms(activeMs)}).\n\n` +
        `• Click OK to RESET TO 00:00:00 and start a brand new study marathon.\n` +
        `• Click CANCEL to RESUME the existing session.`
      );
      if (startFresh) {
        sendAction('start', { resetFirst: true });
        return;
      }
    }
    sendAction('start');
  });
}

if (btnMasterStop) {
  btnMasterStop.addEventListener('click', () => {
    if (confirm('Turn OFF Attendance Tracking and freeze all student times? All attendance data will remain visible.')) {
      sendAction('stop');
    }
  });
}

if (btnMasterPause) {
  btnMasterPause.addEventListener('click', () => {
    if (state.isPaused) sendAction('resume');
    else sendAction('pause');
  });
}

if (btnResumeBanner) btnResumeBanner.addEventListener('click', () => sendAction('resume'));

function triggerResetPrompt() {
  if (confirm('Archive current session and RESET all attendance timers to 00:00:00 for a completely fresh 12-hour study marathon?')) {
    sendAction('reset');
  }
}

if (btnMasterResetDash) btnMasterResetDash.addEventListener('click', triggerResetPrompt);
if (btnMasterResetSm) btnMasterResetSm.addEventListener('click', triggerResetPrompt);
if (btnResetSession) btnResetSession.addEventListener('click', triggerResetPrompt);

// Target Presets
document.querySelectorAll('.btn-preset').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const hours = parseInt(btn.dataset.hours, 10);
    sendAction('update_target', { targetDurationHours: hours });
  });
});

// Tab Navigation
document.querySelectorAll('.tab-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.tab-pill').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    pill.classList.add('active');
    const tabId = pill.dataset.tab;
    const targetContent = document.getElementById(tabId);
    if (targetContent) targetContent.classList.add('active');

    if (tabId === 'tab-timeline') renderTimeline();
    if (tabId === 'tab-breaks') renderBreaks();
    if (tabId === 'tab-archives') fetchArchives();
  });
});

// Search & Filter
if (studentSearchInput) {
  studentSearchInput.addEventListener('input', (e) => {
    currentSearch = e.target.value.toLowerCase().trim();
    renderStudentsTable();
  });
}

if (statusFilterSelect) {
  statusFilterSelect.addEventListener('change', (e) => {
    currentFilter = e.target.value;
    renderStudentsTable();
  });
}

if (btnFilterDefaulters) {
  btnFilterDefaulters.addEventListener('click', () => {
    statusFilterSelect.value = 'defaulters';
    currentFilter = 'defaulters';
    renderStudentsTable();
  });
}

// Exports
if (btnExportPdf) {
  btnExportPdf.addEventListener('click', () => {
    window.open('/report?print=true', '_blank');
  });
}
const btnExportPain = document.getElementById('btn-export-pain');
if (btnExportPain) {
  btnExportPain.addEventListener('click', () => {
    window.open('/report?theme=pain&print=true', '_blank');
  });
}
if (btnExportCsv) {
  btnExportCsv.addEventListener('click', () => {
    window.location.href = '/api/session/export/csv';
  });
}
if (btnExportJson) {
  btnExportJson.addEventListener('click', () => {
    window.location.href = '/api/session/export/json';
  });
}

// Modal
if (btnCloseModal) {
  btnCloseModal.addEventListener('click', () => {
    studentModal.style.display = 'none';
  });
}
if (studentModal) {
  studentModal.addEventListener('click', (e) => {
    if (e.target === studentModal) studentModal.style.display = 'none';
  });
}

// ================= RENDER UI =================
function renderUI() {
  const participants = Object.values(state.participants || {});
  const now = Date.now();

  meetingCodeDisplay.innerText = state.meetingCode || 'cockroach-study-room';

  // Compute Active Study Time using pure math (Never back-counts!)
  const activeStudyMs = calculateActiveStudyMs(state, now);
  sessionStudyClock.innerText = formatHms(activeStudyMs);

  const targetMs = (state.targetDurationHours || 12) * 3600 * 1000;
  const progressPercent = Math.min(100, (activeStudyMs / targetMs) * 100);
  sessionProgressFill.style.width = `${progressPercent.toFixed(1)}%`;
  sessionProgressText.innerText = `${progressPercent.toFixed(1)}% of ${state.targetDurationHours || 12}h goal`;
  sessionTargetText.innerText = `Target: ${state.targetDurationHours || 12}h 00m`;

  // Control Buttons & Badges
  if (!state.isTracking) {
    const isFinalized = !!state.stoppedAt;
    const badgeText = isFinalized ? 'FINALIZED (OFF) ⏹️' : 'READY / OFF ⏹️';
    if (dashAttendanceBadge.innerText !== badgeText) {
      dashAttendanceBadge.innerText = badgeText;
      dashAttendanceBadge.className = 'card-status-badge paused';
    }
    const cardText = isFinalized ? 'FINALIZED ⏹️' : 'OFF ⏹️';
    if (cardStatusBadge.innerText !== cardText) {
      cardStatusBadge.innerText = cardText;
      cardStatusBadge.className = 'card-status-badge paused';
    }

    if (btnMasterStart) {
      const toggleMain = btnMasterStart.querySelector('.toggle-main');
      const targetMain = isFinalized ? 'RESUME / START ATTENDANCE' : 'START ATTENDANCE';
      if (toggleMain && toggleMain.innerText !== targetMain) {
        toggleMain.innerText = targetMain;
      }
    }

    if (masterOffGroup && masterOffGroup.style.display !== 'flex') masterOffGroup.style.display = 'flex';
    if (masterRunningGroup && masterRunningGroup.style.display !== 'none') masterRunningGroup.style.display = 'none';
    if (pausedBanner && pausedBanner.style.display !== 'none') pausedBanner.style.display = 'none';
  } else {
    if (masterOffGroup && masterOffGroup.style.display !== 'none') masterOffGroup.style.display = 'none';
    if (masterRunningGroup && masterRunningGroup.style.display !== 'flex') masterRunningGroup.style.display = 'flex';

    if (state.isPaused) {
      const curBreakMs = state.currentPauseStart ? Math.max(0, now - state.currentPauseStart) : 0;
      const pauseBadgeText = `PAUSED ⏸️ (${formatHms(curBreakMs)})`;
      if (dashAttendanceBadge.innerText !== pauseBadgeText) {
        dashAttendanceBadge.innerText = pauseBadgeText;
        dashAttendanceBadge.className = 'card-status-badge paused';
      }
      if (cardStatusBadge.innerText !== 'PAUSED ⏸️') {
        cardStatusBadge.innerText = 'PAUSED ⏸️';
        cardStatusBadge.className = 'card-status-badge paused';
      }
      btnMasterPause.classList.add('resume-mode');
      if (masterToggleIcon.innerText !== '▶️') masterToggleIcon.innerText = '▶️';
      if (masterToggleLabel.innerText !== 'RESUME BREAK') masterToggleLabel.innerText = 'RESUME BREAK';
      if (masterToggleSub.innerText !== 'Click to continue tracking') masterToggleSub.innerText = 'Click to continue tracking';
      if (pausedBanner.style.display !== 'block') pausedBanner.style.display = 'block';

      if (currentBreakTimer) {
        const breakText = `Break: ${formatHms(curBreakMs)}`;
        if (currentBreakTimer.innerText !== breakText) currentBreakTimer.innerText = breakText;
      }
    } else {
      if (dashAttendanceBadge.innerText !== 'ACTIVE 🟢') {
        dashAttendanceBadge.innerText = 'ACTIVE 🟢';
        dashAttendanceBadge.className = 'card-status-badge';
      }
      if (cardStatusBadge.innerText !== 'ACTIVE 🟢') {
        cardStatusBadge.innerText = 'ACTIVE 🟢';
        cardStatusBadge.className = 'card-status-badge';
      }
      btnMasterPause.classList.remove('resume-mode');
      if (masterToggleIcon.innerText !== '⏸️') masterToggleIcon.innerText = '⏸️';
      if (masterToggleLabel.innerText !== 'PAUSE BREAK') masterToggleLabel.innerText = 'PAUSE BREAK';
      if (masterToggleSub.innerText !== 'Halt timers for break') masterToggleSub.innerText = 'Halt timers for break';
      if (pausedBanner.style.display !== 'none') pausedBanner.style.display = 'none';
    }
  }

  // Breaks summary
  const breakHistory = state.pauseHistory || [];
  totalBreaksCount.innerText = breakHistory.length;
  totalPausedDuration.innerText = formatHms(state.totalPausedMs || 0);

  // Attendance Metrics & Camera Compliance
  updateMetricsCards();
  if (state.startedAt) {
    sessionStartedLabel.innerText = `Started: ${formatIstTime(state.startedAt)}`;
  } else {
    sessionStartedLabel.innerText = 'Ready to start';
  }

  // Defaulters Alert: EXEMPT HOST completely!
  const presentStudents = participants.filter(p => p.currentStatus === 'present' && !p.isLocal && p.id !== 'local_host' && !(p.name && p.name.toLowerCase().includes('host')));
  const defaulters = presentStudents.filter(p => {
    const totMeet = p.totalPresentMs || 0;
    const camOn = p.cameraOnMs || 0;
    const comp = totMeet > 0 ? (camOn / totMeet) * 100 : 0;
    const isCamOffNow = p.cameraStatus === 'off';
    const camOffConsecutive = p.consecutiveCamOffMs || 0;
    return isCamOffNow && (camOffConsecutive >= 5 * 60 * 1000 || (totMeet > 15 * 60 * 1000 && comp < 70));
  });

  if (defaulters.length > 0) {
    defaulterAlert.style.display = 'flex';
    defaulterCount.innerText = `${defaulters.length} Student${defaulters.length > 1 ? 's' : ''}`;
    defaulterNames.innerText = defaulters.map(d => `${d.name} (${formatHms(d.consecutiveCamOffMs || 0)})`).join(', ');
  } else {
    defaulterAlert.style.display = 'none';
  }

  tabCountAttendees.innerText = participants.length;
  renderStudentsTable();
}

// ================= RENDER STUDENTS TABLE (DENSE RANKING & EQUAL DURATION SHARED RANKS) =================
function renderStudentsTable() {
  const now = Date.now();
  const participants = Object.values(state.participants || {}).filter(p => {
    return p.name && !p.name.toLowerCase().includes('keep_outline');
  });

  // Calculate dynamic active time for all participants
  participants.forEach(p => {
    const camOn = p.validStudyMs !== undefined ? p.validStudyMs : (p.cameraOnMs !== undefined ? p.cameraOnMs : (p.duration || 0));
    const camOff = p.cameraOffMs !== undefined ? p.cameraOffMs : 0;
    const totMeet = (p.totalPresentMs && p.totalPresentMs >= camOn + camOff)
      ? p.totalPresentMs
      : (camOn + camOff);

    p.validStudyMs = camOn;
    p.cameraOnMs = camOn;
    p.cameraOffMs = camOff;
    p.totalPresentMs = totMeet;
    p.totalDuration = totMeet;
    p.duration = camOn;
    p.timeInCall = totMeet;
  });

  let filtered = participants.filter(p => {
    if (currentSearch && !p.name.toLowerCase().includes(currentSearch)) {
      return false;
    }
    if (currentFilter === 'cam-on') return p.cameraStatus === 'on';
    if (currentFilter === 'cam-off') return p.cameraStatus === 'off';
    if (currentFilter === 'present') return p.currentStatus === 'present';
    if (currentFilter === 'defaulters') {
      if (p.isLocal || p.id === 'local_host' || (p.name && p.name.toLowerCase().includes('host'))) return false;
      const tot = p.totalPresentMs || 0;
      const on = p.cameraOnMs || 0;
      const comp = tot > 0 ? (on / tot) * 100 : 100;
      return comp < 85 || (p.consecutiveCamOffMs || 0) >= 300000;
    }
    return true;
  });

  // SORT BY VALID STUDY TIME (CAM ON) DESCENDING
  filtered.sort((a, b) => {
    const timeA = a.validStudyMs !== undefined ? a.validStudyMs : (a.cameraOnMs !== undefined ? a.cameraOnMs : (a.duration || 0));
    const timeB = b.validStudyMs !== undefined ? b.validStudyMs : (b.cameraOnMs !== undefined ? b.cameraOnMs : (b.duration || 0));
    const diff = timeB - timeA;
    if (diff !== 0) return diff;
    return (b.totalPresentMs || b.totalDuration || 0) - (a.totalPresentMs || a.totalDuration || 0);
  });

  // ASSIGN DENSE RANK: Equal study durations share the exact same rank!
  // HOST IS 100% EXEMPT FROM COMPETING IN STUDENT RANKS!
  let currentRank = 1;
  const nonHostStudents = filtered.filter(p => !p.isLocal && p.id !== 'local_host' && !(p.name && p.name.toLowerCase().includes('host')));
  
  for (let i = 0; i < nonHostStudents.length; i++) {
    if (i > 0) {
      const prevTime = nonHostStudents[i - 1].validStudyMs !== undefined ? nonHostStudents[i - 1].validStudyMs : (nonHostStudents[i - 1].cameraOnMs || 0);
      const currTime = nonHostStudents[i].validStudyMs !== undefined ? nonHostStudents[i].validStudyMs : (nonHostStudents[i].cameraOnMs || 0);
      const prevSec = Math.floor(prevTime / 1000);
      const currSec = Math.floor(currTime / 1000);
      if (currSec < prevSec) {
        currentRank++;
      }
    }
    nonHostStudents[i].rank = currentRank;
  }

  filtered.forEach(p => {
    const isHost = p.isLocal || p.id === 'local_host' || (p.name && p.name.toLowerCase().includes('host'));
    if (isHost) p.rank = 'HOST';
  });

  if (filtered.length === 0) {
    const existingEmpty = studentsTbody.querySelector('.empty-row');
    const titleText = participants.length === 0 ? 'No participants detected yet' : 'No students match current filter';
    const descText = participants.length === 0 ? 'Join Google Meet with the Cockroach Tracker extension loaded to start tracking.' : 'Try clearing your search or status filter';

    if (existingEmpty) {
      const titleEl = existingEmpty.querySelector('.empty-title');
      const descEl = existingEmpty.querySelector('.empty-desc');
      if (titleEl && titleEl.textContent !== titleText) titleEl.textContent = titleText;
      if (descEl && descEl.textContent !== descText) descEl.textContent = descText;
      return;
    }

    studentsTbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="9">
          <div class="empty-state">
            <div class="empty-glyph">🪳</div>
            <div class="empty-title">${titleText}</div>
            <div class="empty-desc">${descText}</div>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  const newIds = filtered.map(p => p.id);
  // Check if every student in filtered list already has a row in the DOM:
  const allExist = newIds.length > 0 && newIds.every(id => document.getElementById(`student-row-${id}`));

  if (allExist) {
    // 1. Re-order rows if sort order changed (appendChild moves existing node in O(1) time without rebuilding)
    const currentDomIds = Array.from(studentsTbody.children).map(tr => tr.getAttribute('data-student-id'));
    const isExactOrder = currentDomIds.length === newIds.length && currentDomIds.every((id, idx) => id === newIds[idx]);
    if (!isExactOrder) {
      filtered.forEach(p => {
        const tr = document.getElementById(`student-row-${p.id}`);
        if (tr) studentsTbody.appendChild(tr);
      });
    }

    // 2. Fast in-place updates to text nodes (zero layout thrashing)
    filtered.forEach(p => {
      const tr = document.getElementById(`student-row-${p.id}`);
      if (!tr) return;

      const isHost = p.isLocal || p.id === 'local_host' || (p.name && p.name.toLowerCase().includes('host'));
      const camOn = p.validStudyMs !== undefined ? p.validStudyMs : (p.cameraOnMs || 0);
      const camOff = p.cameraOffMs || 0;
      const totMeet = camOn + camOff;
      const totalInMeet = p.totalInMeetMs || totMeet;
      const compliance = totMeet > 0 ? Math.min(100, (camOn / totMeet) * 100) : (camOn > 0 ? 100 : 0);
      const isCamOn = p.cameraStatus === 'on';
      const isPresent = p.currentStatus === 'present';

      // Update Rank Badge
      const rankCol = tr.querySelector('.td-rank-col');
      if (rankCol) {
        let rankBadge = `<span class="td-rank">#${p.rank}</span>`;
        if (isHost) {
          rankBadge = `<span class="badge-exempt-host" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid #10b981; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 800;">EXEMPT [HOST]</span>`;
        } else if (p.rank === 1 && camOn > 0) {
          rankBadge = `<span class="rank-crown" title="RANK 1 - Shared Top Valid Study Time!">👑 #1</span>`;
        } else if (p.rank === 2 && camOn > 0) {
          rankBadge = `<span class="rank-medal silver">🥈 #2</span>`;
        } else if (p.rank === 3 && camOn > 0) {
          rankBadge = `<span class="rank-medal bronze">🥉 #3</span>`;
        }
        if (rankCol.innerHTML !== rankBadge) rankCol.innerHTML = rankBadge;
      }

      // Update valid time
      const timeCell = tr.querySelector('.valid-time-cell .time-mono');
      const timeHms = formatHms(camOn);
      if (timeCell && timeCell.innerText !== timeHms) timeCell.innerText = timeHms;

      // Update deducted time
      const cutCell = tr.querySelector('.deducted-time-cell .time-mono');
      const cutHms = `-${formatHms(camOff)}`;
      if (cutCell && cutCell.innerText !== cutHms) cutCell.innerText = cutHms;

      // Update total meet time
      const totCell = tr.querySelector('.td-tot-time .time-mono');
      const totHms = formatHms(totalInMeet);
      if (totCell && totCell.innerText !== totHms) totCell.innerText = totHms;

      // Update compliance meter
      let barColor = 'var(--accent-emerald)';
      if (compliance < 70) barColor = 'var(--accent-crimson)';
      else if (compliance < 85) barColor = 'var(--accent-amber)';

      const compVal = tr.querySelector('.compliance-bar-val');
      if (compVal) {
        const w = `${compliance.toFixed(0)}%`;
        if (compVal.style.width !== w) {
          compVal.style.width = w;
          compVal.style.background = barColor;
        }
      }
      const compText = tr.querySelector('.compliance-val-text');
      if (compText) {
        const cText = `${compliance.toFixed(1)}%`;
        if (compText.innerText !== cText) {
          compText.innerText = cText;
          compText.style.color = barColor;
        }
      }

      // Update status badge
      const statusBadge = tr.querySelector('.td-status-badge');
      if (statusBadge) {
        statusBadge.className = `badge td-status-badge ${isPresent ? (isCamOn ? 'badge-cam-on' : 'badge-cam-off') : 'badge-left'}`;
        let statusStr = '';
        if (isPresent) {
          if (p.videoDetectionMode === 'poster') {
            statusStr = '☕ Break Poster';
          } else {
            statusStr = isCamOn ? '📹 ON' : '📷 OFF';
          }
        } else {
          const leftStr = p.leaveTime ? formatTimeOnly(p.leaveTime) : (p.lastSeen ? formatTimeOnly(p.lastSeen) : '');
          statusStr = leftStr ? `⚪ Left (${leftStr})` : '⚪ Left';
        }
        if (statusBadge.innerText !== statusStr) statusBadge.innerText = statusStr;
      }

      // Update ongoing cut if cam is off
      if (p.cameraStatus === 'off' && p.cameraOffCurrentStart) {
        const liveOffEl = tr.querySelector('.ongoing-off');
        const liveCutMs = Math.max(0, now - p.cameraOffCurrentStart);
        const from = formatTimeOnly(p.cameraOffCurrentStart);
        if (liveOffEl) {
          liveOffEl.innerText = `🔴 LIVE OFF: ${from} - Now (${formatHms(liveCutMs)} cut)`;
        }
      }

      // Update manual camera override button
      const overrideBtn = tr.querySelector('.btn-cam-override');
      if (overrideBtn) {
        const isOverridden = p.manualCamOverride === true;
        const btnText = isOverridden ? '↺ Auto' : '📷 Force ON';
        if (overrideBtn.innerText !== btnText) {
          overrideBtn.innerText = btnText;
          overrideBtn.className = `btn-cam-override ${isOverridden ? 'active' : ''}`;
          overrideBtn.title = isOverridden ? 'Revert to automatic camera detection' : 'Host Override: Force Camera ON';
        }
      }
    });
    return;
  }

  studentsTbody.innerHTML = filtered.map(p => {
    const isHost = p.isLocal || p.id === 'local_host' || (p.name && p.name.toLowerCase().includes('host'));
    const camOn = p.validStudyMs !== undefined ? p.validStudyMs : (p.cameraOnMs || 0);
    const camOff = p.cameraOffMs || 0;
    const totMeet = (p.totalPresentMs && p.totalPresentMs >= camOn + camOff) ? p.totalPresentMs : (camOn + camOff);
    const totalInMeet = p.totalInMeetMs || totMeet;
    const compliance = totMeet > 0 ? Math.min(100, (camOn / totMeet) * 100) : (camOn > 0 ? 100 : 0);
    const isCamOn = p.cameraStatus === 'on';
    const isPresent = p.currentStatus === 'present';

    // Rank Badges: All students sharing Rank 1 get the Crown! Host is marked EXEMPT!
    let rankBadge = `<span class="td-rank">#${p.rank}</span>`;
    if (isHost) {
      rankBadge = `<span class="badge-exempt-host" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid #10b981; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 800;">EXEMPT [HOST]</span>`;
    } else if (p.rank === 1 && camOn > 0) {
      rankBadge = `<span class="rank-crown" title="RANK 1 - Shared Top Valid Study Time!">👑 #1</span>`;
    } else if (p.rank === 2 && camOn > 0) {
      rankBadge = `<span class="rank-medal silver">🥈 #2</span>`;
    } else if (p.rank === 3 && camOn > 0) {
      rankBadge = `<span class="rank-medal bronze">🥉 #3</span>`;
    }

    // Camera Off Breakdown Snippets
    const offIntervals = p.cameraOffIntervals || [];
    let snippets = [];

    // If camera is currently OFF right now, show LIVE ongoing OFF badge
    if (p.cameraStatus === 'off' && p.cameraOffCurrentStart) {
      const liveCutMs = Math.max(0, now - p.cameraOffCurrentStart);
      const from = formatTimeOnly(p.cameraOffCurrentStart);
      snippets.push(`<div class="off-snippet ongoing-off" style="color: #ff4d6d; font-weight: 700; border-left: 2px solid #ff4d6d;" title="Camera is OFF right now!">🔴 LIVE OFF: ${from} - Now (${formatHms(liveCutMs)} cut)</div>`);
    }

    if (offIntervals.length > 0) {
      const recent = offIntervals.slice(-2);
      recent.forEach(int => {
        const from = int.fromTime || (int.start ? formatTimeOnly(int.start) : '');
        const to = int.toTime || (int.end ? formatTimeOnly(int.end) : 'Now');
        const dur = int.durationFormatted || formatHms(int.durationMs || 0);
        snippets.push(`<div class="off-snippet" title="Camera OFF period - deducted from attendance">⚠️ ${from} - ${to} (${dur} cut)</div>`);
      });
      if (offIntervals.length > 2) {
        snippets.push(`<div class="text-dim text-xs">+${offIntervals.length - 2} more camera cuts</div>`);
      }
    }

    let offBreakdownHtml = snippets.join('');
    if (!offBreakdownHtml) {
      if (camOff > 0) {
        offBreakdownHtml = `<span class="text-crimson font-mono" style="font-size: 11px;">Deducted: -${formatHms(camOff)}</span>`;
      } else {
        offBreakdownHtml = '<span class="text-emerald" style="font-size: 11px;">🟢 100% Cam ON</span>';
      }
    }

    let barColor = 'var(--accent-emerald)';
    if (compliance < 70) barColor = 'var(--accent-crimson)';
    else if (compliance < 85) barColor = 'var(--accent-amber)';

    const initials = (p.name || 'U').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
    const rejoinBadge = (p.rejoinCount && p.rejoinCount > 0)
      ? `<span class="badge-rejoin" style="background: rgba(167, 139, 250, 0.18); color: #c4b5fd; border: 1px solid rgba(167, 139, 250, 0.4); font-size: 10px; padding: 1px 6px; border-radius: 4px; font-weight: 700; margin-left: 6px;" title="Left and rejoined call ${p.rejoinCount} time(s)">🔄 ${p.rejoinCount} Rejoin${p.rejoinCount > 1 ? 's' : ''}</span>`
      : '';

    return `
      <tr id="student-row-${escapeHtml(p.id)}" data-student-id="${escapeHtml(p.id)}" class="${p.rank === 1 && camOn > 0 ? 'tr-rank-1' : ''}">
        <td class="td-rank-col">${rankBadge}</td>
        <td>
          <div class="student-name-cell">
            <div class="student-avatar">${initials}</div>
            <div>
              <span class="student-name-text">${escapeHtml(p.name)}</span>
              ${isHost ? '<span class="student-local-tag" style="background:#10b981; color:#fff;">HOST (EXEMPT)</span>' : ''}
              ${!isHost && p.rank === 1 && camOn > 0 ? '<span class="badge-champ">CHAMPION</span>' : ''}
              ${rejoinBadge}
              ${p.videoDetectionMode === 'poster' ? '<span class="badge" style="background: rgba(245, 158, 11, 0.18); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.4); font-size: 10px; padding: 1px 5px; border-radius: 4px; font-weight: 700; margin-left: 5px;" title="Official Break Poster detected (Camera counted ON)">☕ Break Poster</span>' : ''}
              ${p.videoDetectionMode === 'blank' ? '<span class="badge" style="background: rgba(239, 68, 68, 0.18); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.4); font-size: 10px; padding: 1px 5px; border-radius: 4px; font-weight: 700; margin-left: 5px;" title="Blank or OBS screen detected - attendance cut!">⚠️ Blank/OBS</span>' : ''}
            </div>
          </div>
        </td>
        <td>
          <div class="valid-time-cell">
            <span class="time-mono font-bold text-emerald" style="font-size: 14px;">${formatHms(camOn)}</span>
            <span class="text-dim text-xs">COUNTED STUDY</span>
          </div>
        </td>
        <td>
          <div class="deducted-time-cell">
            <span class="time-mono font-bold text-crimson">-${formatHms(camOff)}</span>
            <span class="text-dim text-xs">CUT FROM TIME</span>
          </div>
        </td>
        <td class="td-tot-time">
          <span class="time-mono text-white">${formatHms(totalInMeet)}</span>
          <div class="text-dim text-xs" style="font-size: 9px; opacity: 0.7;">TOTAL IN MEET</div>
        </td>
        <td>
          <div class="compliance-meter">
            <div class="compliance-bar-bg">
              <div class="compliance-bar-val" style="width: ${compliance.toFixed(0)}%; background: ${barColor};"></div>
            </div>
            <span class="compliance-val-text" style="color: ${barColor};">${compliance.toFixed(1)}%</span>
          </div>
        </td>
        <td><div class="intervals-col">${offBreakdownHtml}</div></td>
        <td>
          <span class="badge td-status-badge ${isPresent ? (isCamOn ? (p.videoDetectionMode === 'poster' ? 'badge-cam-on' : 'badge-cam-on') : 'badge-cam-off') : 'badge-left'}">
            ${isPresent ? (p.videoDetectionMode === 'poster' ? '☕ Poster ON' : (isCamOn ? '📹 ON' : '📷 OFF')) : `⚪ Left ${p.leaveTime ? `(${formatTimeOnly(p.leaveTime)})` : ''}`}
          </span>
        </td>
        <td>
          <div style="display: flex; gap: 6px; align-items: center;">
            <button class="btn-details" onclick="openStudentModal('${escapeHtml(p.id)}')">Breakdown</button>
            ${!isHost ? `
              <button class="btn-cam-override ${p.manualCamOverride ? 'active' : ''}" 
                      onclick="toggleParticipantCameraOverride('${escapeHtml(p.id)}')" 
                      title="${p.manualCamOverride ? 'Revert to automatic camera detection' : 'Host Override: Force Camera ON'}">
                ${p.manualCamOverride ? '↺ Auto' : '📷 Force ON'}
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Host Manual Camera Override Toggle
window.toggleParticipantCameraOverride = async function(id) {
  const p = state.participants?.[id];
  if (!p) return;
  const newOverride = !p.manualCamOverride;
  try {
    const res = await fetch('/api/participant/override', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participantId: id,
        manualCamOverride: newOverride
      })
    });
    const result = await res.json();
    if (result.success) {
      if (state.participants[id]) {
        state.participants[id].manualCamOverride = newOverride;
        if (newOverride) {
          state.participants[id].cameraStatus = 'on';
          state.participants[id].rawCameraStatus = 'on';
          state.participants[id].cameraOffCurrentStart = null;
        }
      }
      showToast(newOverride ? `📷 Manual Camera ON forced for ${p.name}` : `↺ Reverted ${p.name} to automatic camera detection`);
      scheduleRenderUI();
    }
  } catch (err) {
    showToast('Failed to update camera override: ' + err.message);
  }
};

// Student Details Modal (Showing Exact Camera OFF Times & Join/Left History)
window.openStudentModal = function(id) {
  const p = state.participants?.[id];
  if (!p) return;

  const camOn = p.cameraOnMs || 0;
  const camOff = p.cameraOffMs || 0;
  const totMeet = (p.totalPresentMs && p.totalPresentMs >= camOn + camOff) ? p.totalPresentMs : (camOn + camOff);
  const totalInMeet = p.totalInMeetMs || totMeet;
  const compliance = totMeet > 0 ? ((camOn / totMeet) * 100).toFixed(1) + '%' : (camOn > 0 ? '100.0%' : '0.0%');

  const nameEl = document.getElementById('modal-name');
  if (nameEl) nameEl.innerText = p.name;

  const idEl = document.getElementById('modal-id');
  if (idEl) {
    const isHost = p.isLocal || p.id === 'local_host' || (p.name && p.name.toLowerCase().includes('host'));
    idEl.innerText = `ID: ${p.id} • Rank: ${isHost ? 'EXEMPT [HOST]' : `#${p.rank || '-'}`} • First Joined: ${formatIstTime(p.firstSeen || p.joinTime)}`;
  }

  const meetEl = document.getElementById('modal-total-meet') || document.getElementById('modal-total-time');
  if (meetEl) meetEl.innerText = formatHms(totalInMeet);

  const camOnEl = document.getElementById('modal-cam-on');
  if (camOnEl) camOnEl.innerText = formatHms(camOn);

  const camOffEl = document.getElementById('modal-cam-off');
  if (camOffEl) camOffEl.innerText = `-${formatHms(camOff)}`;

  const compEl = document.getElementById('modal-compliance');
  if (compEl) compEl.innerText = compliance;

  const rejoinCountEl = document.getElementById('modal-rejoins-count');
  if (rejoinCountEl) rejoinCountEl.innerText = String(p.rejoinCount || 0);

  // Render Meeting Join, Left & Rejoin Log
  const presenceLogContainer = document.getElementById('modal-presence-log');
  if (presenceLogContainer) {
    const history = p.joinLeaveHistory || [];
    const intervals = p.presenceIntervals || [];
    let pLogHtml = '';

    if (history.length > 0) {
      pLogHtml += '<div style="font-weight: 700; color: #60a5fa; margin-bottom: 6px;">🚪 Join, Left & Rejoin Events:</div>';
      history.forEach((ev, idx) => {
        const timeStr = formatIstTime(ev.time);
        if (ev.event === 'joined') {
          pLogHtml += `
            <div class="log-entry cam-on" style="background: rgba(16, 185, 129, 0.08); border-left: 3px solid #10b981; margin-bottom: 4px;">
              <span><strong>#${idx + 1}. First Joined Google Meet</strong></span>
              <span>🟢 Joined at ${timeStr}</span>
            </div>
          `;
        } else if (ev.event === 'left') {
          pLogHtml += `
            <div class="log-entry cam-off" style="background: rgba(239, 68, 68, 0.08); border-left: 3px solid #ef4444; margin-bottom: 4px;">
              <span><strong>#${idx + 1}. Left Google Meet</strong></span>
              <span>⚪ Left at ${timeStr}</span>
            </div>
          `;
        } else if (ev.event === 'rejoined') {
          const awayStr = ev.awayFormatted ? ` (away for ${ev.awayFormatted})` : '';
          pLogHtml += `
            <div class="log-entry" style="background: rgba(167, 139, 250, 0.1); border-left: 3px solid #a78bfa; margin-bottom: 4px; display: flex; justify-content: space-between; padding: 6px 10px; font-size: 12px;">
              <span style="color: #c4b5fd;"><strong>#${idx + 1}. 🔄 REJOINED Google Meet</strong></span>
              <span style="color: #c4b5fd;">Rejoined at ${timeStr}${awayStr}</span>
            </div>
          `;
        }
      });
    }

    if (intervals.length > 0) {
      pLogHtml += '<div style="font-weight: 700; color: #a78bfa; margin: 10px 0 6px;">⏱️ Presence Sessions Inside Meet:</div>';
      intervals.forEach((int, idx) => {
        const startStr = formatIstTime(int.joinTime);
        const endStr = int.leaveTime ? formatIstTime(int.leaveTime) : (p.currentStatus === 'present' ? 'Currently Present' : formatIstTime(p.lastSeen));
        const dur = int.durationMs || (int.leaveTime ? Math.max(0, int.leaveTime - int.joinTime) : Math.max(0, Date.now() - int.joinTime));
        pLogHtml += `
          <div class="log-entry" style="background: rgba(255, 255, 255, 0.03); border-left: 3px solid #60a5fa; margin-bottom: 4px; display: flex; justify-content: space-between; padding: 6px 10px; font-size: 12px;">
            <span>Session #${idx + 1}</span>
            <span>${startStr} → ${endStr} <strong>(${formatHms(dur)})</strong></span>
          </div>
        `;
      });
    }

    if (!pLogHtml) {
      const firstStr = p.firstSeen ? formatIstTime(p.firstSeen) : 'N/A';
      const lastStr = p.lastSeen ? formatIstTime(p.lastSeen) : 'N/A';
      pLogHtml = `
        <div class="log-entry" style="padding: 8px 12px; font-size: 12px; color: var(--text-dim);">
          Joined at ${firstStr} • Status: ${p.currentStatus === 'present' ? '🟢 Present' : `⚪ Left (${lastStr})`} • Total In Meet: ${formatHms(totalInMeet)}
        </div>
      `;
    }

    presenceLogContainer.innerHTML = pLogHtml;
  }

  const logContainer = document.getElementById('modal-transitions-log');
  const offIntervals = p.cameraOffIntervals || [];
  const intervals = p.cameraIntervals || [];

  let html = '';
  if (offIntervals.length > 0) {
    html += '<div style="font-weight: 700; color: var(--accent-crimson); margin-bottom: 6px;">❌ Camera OFF Intervals (Yahan se yahan tak camera OFF tha - cut from study time):</div>';
    offIntervals.forEach((int, i) => {
      const from = int.fromTime || (int.start ? new Date(int.start).toLocaleTimeString('en-IN') : '');
      const to = int.toTime || (int.end ? new Date(int.end).toLocaleTimeString('en-IN') : 'Now');
      const dur = int.durationFormatted || formatHms(int.durationMs || 0);
      html += `
        <div class="log-entry cam-off">
          <span>#${i+1}. Camera OFF</span>
          <span>${from} → ${to} <strong>(-${dur} cut)</strong></span>
        </div>
      `;
    });
  }

  if (intervals.length > 0) {
    html += '<div style="font-weight: 700; color: var(--accent-purple); margin: 12px 0 6px;">📋 Full Camera Transition History:</div>';
    intervals.forEach(int => {
      const dur = int.end ? (int.end - int.start) : (Date.now() - int.start);
      html += `
        <div class="log-entry ${int.state === 'on' ? 'cam-on' : 'cam-off'}">
          <span>Cam ${int.state.toUpperCase()}</span>
          <span>${formatIstTime(int.start)} → ${int.end ? formatIstTime(int.end) : 'Present'} (${formatHms(dur)})</span>
        </div>
      `;
    });
  }

  if (!html) {
    html = '<div style="color: var(--text-dim); text-align: center; padding: 12px;">No camera state transitions recorded yet.</div>';
  }

  if (logContainer) logContainer.innerHTML = html;
  studentModal.style.display = 'flex';
};

// ================= RENDER TIMELINE (GANTT) =================
function renderTimeline() {
  const container = document.getElementById('timeline-rows') || document.getElementById('gantt-chart-container');
  if (!container) return;

  const participants = Object.values(state.participants || {});
  if (participants.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-glyph">📊</div><div class="empty-title">No timeline data available</div></div>';
    return;
  }

  const targetHours = state.targetDurationHours || 12;
  const sessionTotalWindowMs = targetHours * 3600 * 1000;
  const sessionStart = state.startedAt || Date.now();
  const now = Date.now();

  let html = '';
  participants.forEach(p => {
    const intervals = p.cameraIntervals || [];
    let segments = '';
    intervals.forEach(int => {
      const s = Math.max(0, int.start - sessionStart);
      const e = Math.min(sessionTotalWindowMs, (int.end || now) - sessionStart);
      if (e > s) {
        const l = ((s / sessionTotalWindowMs) * 100).toFixed(2);
        const w = (((e - s) / sessionTotalWindowMs) * 100).toFixed(2);
        segments += `<div class="gantt-segment ${int.state === 'on' ? 'seg-on' : 'seg-off'}" style="left:${l}%; width:${w}%;" title="${p.name}: Cam ${int.state.toUpperCase()} (${formatHms(e - s)})"></div>`;
      }
    });

    html += `
      <div class="gantt-row">
        <div class="gantt-label">${escapeHtml(p.name)}</div>
        <div class="gantt-track">${segments}</div>
      </div>
    `;
  });

  container.innerHTML = html;
}

// ================= RENDER BREAKS =================
function renderBreaks() {
  const tbody = document.getElementById('breaks-tbody');
  if (!tbody) return;

  const breaks = state.pauseHistory || [];
  const tabBadge = document.getElementById('tab-count-breaks');
  if (tabBadge) tabBadge.innerText = breaks.length;

  if (breaks.length === 0) {
    tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="5">
          <div class="empty-state">
            <div class="empty-glyph">⏸️</div>
            <div class="empty-title">No breaks recorded yet</div>
            <div class="empty-desc">Use the Pause Break button when taking lunch or tea breaks.</div>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = breaks.map((b, i) => `
    <tr>
      <td class="font-mono text-dim">#${i + 1}</td>
      <td class="font-mono text-white">${formatIstTime(b.pausedAt)}</td>
      <td class="font-mono text-white">${b.resumedAt ? formatIstTime(b.resumedAt) : '<span class="text-amber">In Progress</span>'}</td>
      <td class="font-mono text-amber font-bold">${formatHms(b.durationMs)}</td>
      <td><span class="badge badge-cam-on">Verified Halt</span></td>
    </tr>
  `).join('');
}

// ================= FETCH & MANAGE PAST ARCHIVES =================
async function fetchArchives() {
  const container = document.getElementById('archives-list') || document.getElementById('archives-list-container');
  if (!container) return;

  try {
    const res = await fetch('/api/sessions');
    if (!res.ok) throw new Error('Failed to fetch archives');
    const archives = await res.json();

    const selectAllCheckbox = document.getElementById('archive-select-all');
    if (selectAllCheckbox) selectAllCheckbox.checked = false;
    updateArchiveSelectedState();

    if (archives.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-glyph">📁</div>
          <div class="empty-title">No archived sessions yet</div>
          <div class="empty-desc">When you turn OFF or Reset attendance, previous sessions are saved here automatically.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = archives.map(a => {
      const pCount = Object.keys(a.participants || {}).length;
      const start = a.startedAt ? formatIstTime(a.startedAt) : 'N/A';
      const stop = a.stoppedAt ? formatIstTime(a.stoppedAt) : 'N/A';
      let dur = 0;
      if (a.startedAt && a.stoppedAt) {
        dur = Math.max(0, (a.stoppedAt - a.startedAt) - (a.totalPausedMs || 0));
      } else if (a.startedAt && a.lastUpdated) {
        dur = Math.max(0, (a.lastUpdated - a.startedAt) - (a.totalPausedMs || 0));
      }

      return `
        <div class="archive-card" id="archive-card-${escapeHtml(a.sessionId)}">
          <div class="archive-main-row" style="display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <input type="checkbox" class="archive-checkbox" data-id="${escapeHtml(a.sessionId)}" onchange="updateArchiveSelectedState()" style="cursor: pointer; width: 18px; height: 18px; accent-color: var(--accent-emerald);">
              <div class="archive-meta">
                <span class="archive-code font-mono">ROOM: ${escapeHtml(a.meetingCode || 'room')}</span>
                <span class="card-status-badge paused">ARCHIVED</span>
                <span class="archive-date">${a.archivedAt ? new Date(a.archivedAt).toLocaleString('en-IN') : (a.startedAt ? new Date(a.startedAt).toLocaleDateString('en-IN') : '')}</span>
              </div>
            </div>

            <div class="archive-actions" style="display: flex; gap: 6px; flex-wrap: wrap;">
              <button class="btn-archive-action btn-archive-view" onclick="viewArchiveSession('${escapeHtml(a.sessionId)}')">
                👁️ View Details
              </button>
              <button class="btn-archive-action btn-archive-pdf" onclick="window.open('/api/session/${escapeHtml(a.sessionId)}/report?print=true', '_blank')">
                📄 Ranked PDF
              </button>
              <button class="btn-archive-action" onclick="window.open('/api/session/${escapeHtml(a.sessionId)}/report?theme=pain&print=true', '_blank')" style="background: rgba(124, 92, 255, 0.15); color: #c4b5fd; border: 1px solid rgba(124, 92, 255, 0.35);" title="Full Detailed Pain Theme Dossier">
                🩸 Pain Dossier
              </button>
              <button class="btn-archive-action" onclick="window.location.href='/api/session/${escapeHtml(a.sessionId)}/export/csv'">
                📥 CSV
              </button>
              <button class="btn-archive-action btn-archive-delete" onclick="deleteArchiveSession('${escapeHtml(a.sessionId)}')">
                🗑️ Delete
              </button>
            </div>
          </div>

          <div class="archive-body">
            <div>Duration: <strong>${formatHms(dur)}</strong></div>
            <div>Tracked: <strong>${pCount} students</strong></div>
            <div>Breaks: <strong>${(a.pauseHistory || []).length} (${formatHms(a.totalPausedMs || 0)})</strong></div>
            <div>Span: <strong>${start} → ${stop}</strong></div>
          </div>
        </div>
      `;
    }).join('');

    updateArchiveSelectedState();
  } catch (err) {
    container.innerHTML = `<div class="text-crimson">Error loading archives: ${err.message}</div>`;
  }
}

// Multi-Selection State Management
window.updateArchiveSelectedState = function() {
  const checkboxes = document.querySelectorAll('.archive-checkbox');
  const checked = document.querySelectorAll('.archive-checkbox:checked');
  const countEl = document.getElementById('archive-selected-count');
  const deleteBtn = document.getElementById('btn-delete-selected-archives');
  const selectAll = document.getElementById('archive-select-all');

  if (countEl) countEl.innerText = `${checked.length}`;
  if (deleteBtn) {
    if (checked.length > 0) {
      deleteBtn.style.opacity = '1';
      deleteBtn.style.pointerEvents = 'auto';
      deleteBtn.style.cursor = 'pointer';
      deleteBtn.style.background = 'rgba(239, 68, 68, 0.25)';
    } else {
      deleteBtn.style.opacity = '0.5';
      deleteBtn.style.pointerEvents = 'none';
      deleteBtn.style.background = 'rgba(239, 68, 68, 0.15)';
    }
  }

  if (selectAll && checkboxes.length > 0) {
    selectAll.checked = (checked.length === checkboxes.length);
  }
};

// Wire up Select All and Batch Delete buttons
const selectAllArchiveCb = document.getElementById('archive-select-all');
if (selectAllArchiveCb) {
  selectAllArchiveCb.addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    document.querySelectorAll('.archive-checkbox').forEach(cb => {
      cb.checked = isChecked;
    });
    updateArchiveSelectedState();
  });
}

const btnDeleteSelectedArchives = document.getElementById('btn-delete-selected-archives');
if (btnDeleteSelectedArchives) {
  btnDeleteSelectedArchives.addEventListener('click', async () => {
    const checked = Array.from(document.querySelectorAll('.archive-checkbox:checked'));
    if (checked.length === 0) return;
    const sessionIds = checked.map(cb => cb.getAttribute('data-id')).filter(Boolean);

    if (!confirm(`Are you sure you want to permanently DELETE ${sessionIds.length} selected archived study session(s)?\n\nThis cannot be undone.`)) {
      return;
    }

    try {
      const res = await fetch('/api/sessions/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionIds })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Successfully deleted ${data.count || sessionIds.length} archived session(s)! 🗑️`);
        fetchArchives();
      } else {
        showToast('Error deleting sessions: ' + (data.error || 'Server error'));
      }
    } catch (err) {
      showToast('Failed to delete selected sessions: ' + err.message);
    }
  });
}

const btnDeleteAllArchives = document.getElementById('btn-delete-all-archives');
if (btnDeleteAllArchives) {
  btnDeleteAllArchives.addEventListener('click', async () => {
    if (!confirm('⚠️ DANGER: Are you sure you want to CLEAR ALL archived study sessions?\n\nThis will permanently delete the entire past marathon history!')) {
      return;
    }
    if (!confirm('Please confirm once more: Permanently erase ALL historical session records?')) {
      return;
    }

    try {
      const res = await fetch('/api/sessions/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteAll: true })
      });
      const data = await res.json();
      if (data.success) {
        showToast('All past archived sessions have been cleared! 🗑️');
        fetchArchives();
      } else {
        showToast('Error: ' + (data.error || 'Server error'));
      }
    } catch (err) {
      showToast('Failed to clear archives: ' + err.message);
    }
  });
}

// Global handlers for archive card actions
window.deleteArchiveSession = async function(sessionId) {
  if (!confirm(`Are you sure you want to DELETE archived session [${sessionId}]?\n\nThis will permanently remove it from Past Sessions.`)) {
    return;
  }
  try {
    const res = await fetch(`/api/session/${sessionId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('Archived session successfully deleted! 🗑️');
      fetchArchives();
    } else {
      showToast('Error deleting session: ' + (data.error || 'Unknown error'));
    }
  } catch (e) {
    showToast('Failed to delete session: ' + e.message);
  }
};

window.viewArchiveSession = async function(sessionId) {
  try {
    const res = await fetch(`/api/session/${sessionId}`);
    if (!res.ok) throw new Error('Session not found');
    const a = await res.json();

    const modal = document.getElementById('archive-modal');
    const modalCode = document.getElementById('archive-modal-code');
    const modalId = document.getElementById('archive-modal-id');
    const modalDuration = document.getElementById('archive-modal-duration');
    const modalParticipants = document.getElementById('archive-modal-participants');
    const modalBreaks = document.getElementById('archive-modal-breaks');
    const modalTiming = document.getElementById('archive-modal-timing');
    const modalTbody = document.getElementById('archive-modal-tbody');
    const btnPdf = document.getElementById('archive-modal-btn-pdf');
    const btnCsv = document.getElementById('archive-modal-btn-csv');
    const btnRestore = document.getElementById('archive-modal-btn-restore');

    let dur = 0;
    if (a.startedAt && a.stoppedAt) {
      dur = Math.max(0, (a.stoppedAt - a.startedAt) - (a.totalPausedMs || 0));
    } else if (a.startedAt && a.lastUpdated) {
      dur = Math.max(0, (a.lastUpdated - a.startedAt) - (a.totalPausedMs || 0));
    }

    const participants = Object.values(a.participants || {}).filter(p => p.name && !p.name.toLowerCase().includes('keep_outline'));

    // Compute dense ranks
    participants.sort((x, y) => {
      const timeX = x.validStudyMs !== undefined ? x.validStudyMs : (x.cameraOnMs || 0);
      const timeY = y.validStudyMs !== undefined ? y.validStudyMs : (y.cameraOnMs || 0);
      return timeY - timeX;
    });

    let currentRank = 1;
    for (let i = 0; i < participants.length; i++) {
      if (i > 0) {
        const prevTime = participants[i - 1].validStudyMs !== undefined ? participants[i - 1].validStudyMs : (participants[i - 1].cameraOnMs || 0);
        const currTime = participants[i].validStudyMs !== undefined ? participants[i].validStudyMs : (participants[i].cameraOnMs || 0);
        if (Math.floor(currTime / 1000) < Math.floor(prevTime / 1000)) {
          currentRank++;
        }
      }
      participants[i].rank = currentRank;
    }

    if (modalCode) modalCode.innerText = `Room: ${a.meetingCode || 'Study Room'}`;
    if (modalId) modalId.innerText = `Session ID: ${a.sessionId}`;
    if (modalDuration) modalDuration.innerText = formatHms(dur);
    if (modalParticipants) modalParticipants.innerText = `${participants.length} Students`;
    if (modalBreaks) modalBreaks.innerText = `${(a.pauseHistory || []).length} (${formatHms(a.totalPausedMs || 0)})`;
    if (modalTiming) modalTiming.innerText = `${a.startedAt ? formatIstTime(a.startedAt) : '--'} → ${a.stoppedAt ? formatIstTime(a.stoppedAt) : '--'}`;

    if (btnPdf) btnPdf.onclick = () => window.open(`/api/session/${a.sessionId}/report?print=true`, '_blank');
    const btnPain = document.getElementById('archive-modal-btn-pain');
    if (btnPain) btnPain.onclick = () => window.open(`/api/session/${a.sessionId}/report?theme=pain&print=true`, '_blank');
    if (btnCsv) btnCsv.onclick = () => window.location.href = `/api/session/${a.sessionId}/export/csv`;
    if (btnRestore) {
      btnRestore.onclick = () => restoreArchiveSession(a.sessionId);
    }

    if (modalTbody) {
      if (participants.length === 0) {
        modalTbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-dim); padding: 20px;">No participant records found in this archived session.</td></tr>';
      } else {
        modalTbody.innerHTML = participants.map(p => {
          const camOn = p.cameraOnMs || 0;
          const camOff = p.cameraOffMs || 0;
          const totMeet = (p.totalPresentMs && p.totalPresentMs >= camOn + camOff) ? p.totalPresentMs : (camOn + camOff);
          const comp = totMeet > 0 ? ((camOn / totMeet) * 100).toFixed(1) + '%' : (camOn > 0 ? '100.0%' : '0.0%');

          const offIntervals = (p.cameraOffIntervals || []).map(int => {
            const from = int.fromTime || (int.start ? formatIstTime(int.start) : '');
            const to = int.toTime || (int.end ? formatIstTime(int.end) : '');
            const d = int.durationFormatted || formatHms(int.durationMs || 0);
            return `<div class="cam-off-badge">⚠️ ${from} - ${to} (${d})</div>`;
          }).join('');

          let rankBadge = `<span class="rank-num">#${p.rank}</span>`;
          if (p.rank === 1) rankBadge = `<span class="rank-num rank-gold">👑 #1</span>`;
          else if (p.rank === 2) rankBadge = `<span class="rank-num rank-silver">🥈 #2</span>`;
          else if (p.rank === 3) rankBadge = `<span class="rank-num rank-bronze">🥉 #3</span>`;

          return `
            <tr>
              <td class="td-rank">${rankBadge}</td>
              <td class="font-bold text-white">${escapeHtml(p.name)}</td>
              <td class="font-mono" style="color: var(--accent-emerald); font-weight: 700;">${formatHms(camOn)}</td>
              <td class="font-mono" style="color: var(--accent-crimson); font-weight: 700;">-${formatHms(camOff)}</td>
              <td class="font-mono text-dim">${formatHms(totMeet)}</td>
              <td><span class="badge ${parseFloat(comp) >= 80 ? 'badge-cam-on' : 'badge-cam-off'}">${comp}</span></td>
              <td style="font-size: 11px;">${offIntervals || '<span class="text-dim">None (Camera 100% ON)</span>'}</td>
            </tr>
          `;
        }).join('');
      }
    }

    if (modal) modal.style.display = 'flex';
  } catch (err) {
    showToast('Failed to load archive details: ' + err.message);
  }
};

window.restoreArchiveSession = async function(sessionId) {
  if (!confirm(`Restore archived session [${sessionId}] onto the active dashboard?\n\nThis will display all this session's participants and stats on the main matrix.`)) {
    return;
  }
  try {
    const res = await fetch(`/api/session/${sessionId}/restore`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      const modal = document.getElementById('archive-modal');
      if (modal) modal.style.display = 'none';

      // Switch to Student Matrix tab
      const tabBtn = document.querySelector('.tab-pill[data-tab="tab-attendees"]');
      if (tabBtn) tabBtn.click();

      showToast('Archived session successfully loaded onto active dashboard! ✅');
      fetchCurrentSession();
    }
  } catch (err) {
    showToast('Failed to restore session: ' + err.message);
  }
};

// Archive modal close handlers
const btnCloseArchiveModal = document.getElementById('btn-close-archive-modal');
const archiveModal = document.getElementById('archive-modal');
if (btnCloseArchiveModal && archiveModal) {
  btnCloseArchiveModal.addEventListener('click', () => {
    archiveModal.style.display = 'none';
  });
  archiveModal.addEventListener('click', (e) => {
    if (e.target === archiveModal) archiveModal.style.display = 'none';
  });
}

function updateMetricsCards() {
  const participants = Object.values(state.participants || {});
  const presentStudents = participants.filter(p => p.currentStatus === 'present');
  const leftStudents = participants.filter(p => p.currentStatus !== 'present');
  if (attendeesPresentCount && attendeesPresentCount.innerText !== String(presentStudents.length)) {
    attendeesPresentCount.innerText = presentStudents.length;
  }
  if (attendeesTotalCount && attendeesTotalCount.innerText !== String(participants.length)) {
    attendeesTotalCount.innerText = participants.length;
  }
  if (attendeesLeftCount && attendeesLeftCount.innerText !== String(leftStudents.length)) {
    attendeesLeftCount.innerText = leftStudents.length;
  }

  const activeCameras = presentStudents.filter(p => p.cameraStatus === 'on');
  const camPercent = presentStudents.length > 0 ? (activeCameras.length / presentStudents.length) * 100 : 0;

  const camCountStr = `${activeCameras.length} / ${presentStudents.length}`;
  if (camActiveCount && camActiveCount.innerText !== camCountStr) {
    camActiveCount.innerText = camCountStr;
  }
  const compStr = `${camPercent.toFixed(1)}%`;
  if (camCompliancePercent && camCompliancePercent.innerText !== compStr) {
    camCompliancePercent.innerText = compStr;
  }
  if (camComplianceBar && camComplianceBar.style.width !== compStr) {
    camComplianceBar.style.width = compStr;
  }
  const dot = camPercent >= 80 ? '🟢' : (camPercent >= 50 ? '🟡' : '🔴');
  if (camActiveDot && camActiveDot.innerText !== dot) {
    camActiveDot.innerText = dot;
  }
}

// ================= INIT =================
window.addEventListener('DOMContentLoaded', () => {
  fetchCurrentSession();
  initWebSocket();

  // Fallback polling every 2.5s guarantees real-time sync in Brave Shields / restricted networks
  setInterval(fetchCurrentSession, 2500);

  // Tick every second to keep the clock & table updating smoothly in real-time
  setInterval(() => {
    const now = Date.now();
    if (state.isTracking && state.startedAt) {
      const activeStudyMs = calculateActiveStudyMs(state, now);
      sessionStudyClock.innerText = formatHms(activeStudyMs);

      const targetMs = (state.targetDurationHours || 12) * 3600 * 1000;
      const progressPercent = Math.min(100, (activeStudyMs / targetMs) * 100);
      sessionProgressFill.style.width = `${progressPercent.toFixed(1)}%`;
      sessionProgressText.innerText = `${progressPercent.toFixed(1)}% of ${state.targetDurationHours || 12}h goal`;

      if (state.isPaused && state.currentPauseStart) {
        const curBreakMs = Math.max(0, now - state.currentPauseStart);
        if (currentBreakTimer) currentBreakTimer.innerText = `Break: ${formatHms(curBreakMs)}`;
        if (dashAttendanceBadge) dashAttendanceBadge.innerText = `PAUSED ⏸️ (${formatHms(curBreakMs)})`;
      } else if (!state.isPaused) {
        // Smoothly tick each active participant's camera timer in real-time
        let hasPresent = false;
        Object.values(state.participants || {}).forEach(p => {
          if (p.currentStatus === 'present') {
            hasPresent = true;
            if (p.cameraStatus === 'on') {
              p.cameraOnMs = (p.cameraOnMs || 0) + 1000;
              p.validStudyMs = p.cameraOnMs;
              p.consecutiveCamOffMs = 0;
            } else {
              p.cameraOffMs = (p.cameraOffMs || 0) + 1000;
              p.consecutiveCamOffMs = (p.consecutiveCamOffMs || 0) + 1000;
            }
            p.totalPresentMs = (p.cameraOnMs || 0) + (p.cameraOffMs || 0);
            p.totalInMeetMs = (p.totalInMeetMs || p.totalPresentMs || 0) + 1000;
          }
        });
        if (hasPresent) {
          scheduleRenderUI();
        }
      }
    } else {
      // When tracking is OFF / Idle, update metrics cards only if participants exist
      if (state.participants && Object.keys(state.participants).length > 0) {
        updateMetricsCards();
      }
    }
  }, 1000);
});
