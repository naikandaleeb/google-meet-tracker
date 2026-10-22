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
      if (data.type === 'INIT' || data.type === 'SESSION_UPDATE' || data.type === 'ACTION_RESET' || data.type === 'ACTION_START' || data.type === 'ACTION_STOP') {
        if (data.session) {
          state = data.session;
          renderUI();
        }
      } else if (data.type === 'ACTION_PAUSE') {
        state.isPaused = true;
        state.currentPauseStart = data.timestamp;
        renderUI();
      } else if (data.type === 'ACTION_RESUME') {
        state.isPaused = false;
        state.currentPauseStart = null;
        renderUI();
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

// Fetch initial state
async function fetchCurrentSession() {
  try {
    const res = await fetch('/api/session/current');
    if (res.ok) {
      state = await res.json();
      renderUI();
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
    dashAttendanceBadge.innerText = isFinalized ? 'FINALIZED (OFF) ⏹️' : 'READY / OFF ⏹️';
    dashAttendanceBadge.className = 'card-status-badge paused';
    cardStatusBadge.innerText = isFinalized ? 'FINALIZED ⏹️' : 'OFF ⏹️';
    cardStatusBadge.className = 'card-status-badge paused';

    if (btnMasterStart) {
      const toggleMain = btnMasterStart.querySelector('.toggle-main');
      if (toggleMain) toggleMain.innerText = isFinalized ? 'RESUME / START ATTENDANCE' : 'START ATTENDANCE';
    }

    if (masterOffGroup) masterOffGroup.style.display = 'flex';
    if (masterRunningGroup) masterRunningGroup.style.display = 'none';
    if (pausedBanner) pausedBanner.style.display = 'none';
  } else {
    if (masterOffGroup) masterOffGroup.style.display = 'none';
    if (masterRunningGroup) masterRunningGroup.style.display = 'flex';

    if (state.isPaused) {
      const curBreakMs = state.currentPauseStart ? Math.max(0, now - state.currentPauseStart) : 0;
      dashAttendanceBadge.innerText = `PAUSED ⏸️ (${formatHms(curBreakMs)})`;
      dashAttendanceBadge.className = 'card-status-badge paused';
      cardStatusBadge.innerText = 'PAUSED ⏸️';
      cardStatusBadge.className = 'card-status-badge paused';
      btnMasterPause.classList.add('resume-mode');
      masterToggleIcon.innerText = '▶️';
      masterToggleLabel.innerText = 'RESUME BREAK';
      masterToggleSub.innerText = 'Click to continue tracking';
      pausedBanner.style.display = 'block';

      if (currentBreakTimer) currentBreakTimer.innerText = `Break: ${formatHms(curBreakMs)}`;
    } else {
      dashAttendanceBadge.innerText = 'ACTIVE 🟢';
      dashAttendanceBadge.className = 'card-status-badge';
      cardStatusBadge.innerText = 'ACTIVE 🟢';
      cardStatusBadge.className = 'card-status-badge';
      btnMasterPause.classList.remove('resume-mode');
      masterToggleIcon.innerText = '⏸️';
      masterToggleLabel.innerText = 'PAUSE BREAK';
      masterToggleSub.innerText = 'Halt timers for break';
      pausedBanner.style.display = 'none';
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

  // Defaulters Alert
  const presentStudents = participants.filter(p => p.currentStatus === 'present');
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
    const joinTs = toEpochMs(p.joinTime) || toEpochMs(p.firstSeen) || toEpochMs(state.startedAt) || now;
    const leaveTs = toEpochMs(p.leaveTime) || (p.currentStatus === 'left' ? toEpochMs(p.lastSeen) : null);
    const effectiveEndTime = leaveTs || toEpochMs(state.stoppedAt) || now;
    const totalInCallMs = Math.max(0, effectiveEndTime - joinTs);

    let camOn = p.validStudyMs !== undefined ? p.validStudyMs : (p.cameraOnMs !== undefined ? p.cameraOnMs : (p.duration || 0));
    let camOff = p.cameraOffMs !== undefined ? p.cameraOffMs : 0;

    if (camOn === 0 && camOff === 0 && totalInCallMs > 0) {
      if (p.cameraStatus === 'on') camOn = totalInCallMs;
      else camOff = totalInCallMs;
    }

    const totMeet = (p.totalPresentMs && p.totalPresentMs >= camOn + camOff)
      ? p.totalPresentMs
      : Math.max(totalInCallMs, camOn + camOff);

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
  let currentRank = 1;
  for (let i = 0; i < filtered.length; i++) {
    if (i > 0) {
      const prevTime = filtered[i - 1].validStudyMs !== undefined ? filtered[i - 1].validStudyMs : (filtered[i - 1].cameraOnMs || 0);
      const currTime = filtered[i].validStudyMs !== undefined ? filtered[i].validStudyMs : (filtered[i].cameraOnMs || 0);
      const prevSec = Math.floor(prevTime / 1000);
      const currSec = Math.floor(currTime / 1000);
      if (currSec < prevSec) {
        currentRank++;
      }
    }
    filtered[i].rank = currentRank;
  }

  if (filtered.length === 0) {
    studentsTbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="9">
          <div class="empty-state">
            <div class="empty-glyph">🪳</div>
            <div class="empty-title">${participants.length === 0 ? 'No participants detected yet' : 'No students match current filter'}</div>
            <div class="empty-desc">${participants.length === 0 ? 'Join Google Meet with the Cockroach Tracker extension loaded to start tracking.' : 'Try clearing your search or status filter'}</div>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  studentsTbody.innerHTML = filtered.map(p => {
    const camOn = p.validStudyMs !== undefined ? p.validStudyMs : (p.cameraOnMs || 0);
    const totMeet = Math.max(p.totalPresentMs || 0, camOn);
    const camOff = p.cameraOffMs || Math.max(0, totMeet - camOn);
    const compliance = totMeet > 0 ? Math.min(100, (camOn / totMeet) * 100) : 0;
    const isCamOn = p.cameraStatus === 'on';
    const isPresent = p.currentStatus === 'present';

    // Rank Badges: All students sharing Rank 1 get the Crown!
    let rankBadge = `<span class="td-rank">#${p.rank}</span>`;
    if (p.rank === 1 && camOn > 0) {
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

    return `
      <tr class="${p.rank === 1 && camOn > 0 ? 'tr-rank-1' : ''}">
        <td class="td-rank-col">${rankBadge}</td>
        <td>
          <div class="student-name-cell">
            <div class="student-avatar">${initials}</div>
            <div>
              <span class="student-name-text">${escapeHtml(p.name)}</span>
              ${p.isLocal ? '<span class="student-local-tag">HOST</span>' : ''}
              ${p.rank === 1 && camOn > 0 ? '<span class="badge-champ">CHAMPION</span>' : ''}
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
        <td><span class="time-mono text-white">${formatHms(totMeet)}</span></td>
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
          <span class="badge ${isPresent ? (isCamOn ? 'badge-cam-on' : 'badge-cam-off') : 'badge-left'}">
            ${isPresent ? (isCamOn ? '📹 ON' : '📷 OFF') : '⚪ Left'}
          </span>
        </td>
        <td>
          <button class="btn-details" onclick="openStudentModal('${escapeHtml(p.id)}')">Breakdown</button>
        </td>
      </tr>
    `;
  }).join('');
}

// Student Details Modal (Showing Exact Camera OFF Times)
window.openStudentModal = function(id) {
  const p = state.participants?.[id];
  if (!p) return;

  const camOn = p.cameraOnMs || 0;
  const totMeet = Math.max(p.totalPresentMs || 0, camOn);
  const camOff = p.cameraOffMs || Math.max(0, totMeet - camOn);
  const compliance = totMeet > 0 ? ((camOn / totMeet) * 100).toFixed(1) + '%' : '0.0%';

  document.getElementById('modal-name').innerText = p.name;
  document.getElementById('modal-id').innerText = `ID: ${p.id} • Rank: #${p.rank || '-'} • First Joined: ${formatIstTime(p.firstSeen)}`;
  document.getElementById('modal-total-time').innerText = formatHms(totMeet);
  document.getElementById('modal-cam-on').innerText = formatHms(camOn);
  document.getElementById('modal-cam-off').innerText = `-${formatHms(camOff)}`;
  document.getElementById('modal-compliance').innerText = compliance;

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

  logContainer.innerHTML = html;
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
          <div class="archive-main-row">
            <div class="archive-meta">
              <span class="archive-code font-mono">ROOM: ${escapeHtml(a.meetingCode || 'room')}</span>
              <span class="card-status-badge paused">ARCHIVED</span>
              <span class="archive-date">${a.archivedAt ? new Date(a.archivedAt).toLocaleString('en-IN') : (a.startedAt ? new Date(a.startedAt).toLocaleDateString('en-IN') : '')}</span>
            </div>

            <div class="archive-actions">
              <button class="btn-archive-action btn-archive-view" onclick="viewArchiveSession('${escapeHtml(a.sessionId)}')">
                👁️ View Details
              </button>
              <button class="btn-archive-action btn-archive-pdf" onclick="window.open('/api/session/${escapeHtml(a.sessionId)}/report?print=true', '_blank')">
                📄 Ranked PDF
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
  } catch (err) {
    container.innerHTML = `<div class="text-crimson">Error loading archives: ${err.message}</div>`;
  }
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
          const totMeet = p.totalPresentMs || camOn;
          const camOff = p.cameraOffMs || Math.max(0, totMeet - camOn);
          const comp = totMeet > 0 ? ((camOn / totMeet) * 100).toFixed(1) + '%' : '0.0%';

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
  if (attendeesPresentCount) attendeesPresentCount.innerText = presentStudents.length;
  if (attendeesTotalCount) attendeesTotalCount.innerText = participants.length;
  if (attendeesLeftCount) attendeesLeftCount.innerText = leftStudents.length;

  const activeCameras = presentStudents.filter(p => p.cameraStatus === 'on');
  const camPercent = presentStudents.length > 0 ? (activeCameras.length / presentStudents.length) * 100 : 0;

  if (camActiveCount) camActiveCount.innerText = `${activeCameras.length} / ${presentStudents.length}`;
  if (camCompliancePercent) camCompliancePercent.innerText = `${camPercent.toFixed(1)}%`;
  if (camComplianceBar) camComplianceBar.style.width = `${camPercent.toFixed(1)}%`;
  if (camActiveDot) camActiveDot.innerText = camPercent >= 80 ? '🟢' : (camPercent >= 50 ? '🟡' : '🔴');
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
          }
        });
        if (hasPresent) {
          renderStudentsTable();
          updateMetricsCards();
        }
      }
    } else {
      // When tracking is OFF / Idle, update metrics cards to show currently present participants
      updateMetricsCards();
    }
  }, 1000);
});
