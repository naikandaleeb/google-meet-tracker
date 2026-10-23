// Cockroach Library - 12-Hour Google Meet Attendance & Camera Tracker
// Content Script for Brave & Chrome (Manifest V3 - Shadow DOM & Ranked Report Edition)

(function() {
  'use strict';

  if (window.__COCKROACH_TRACKER_LOADED__ && typeof window.__cockroachMountHUD === 'function') {
    console.log('[Cockroach Tracker] Re-mounting HUD...');
    window.__cockroachMountHUD();
    return;
  }
  window.__COCKROACH_TRACKER_LOADED__ = true;

  console.log('%c🪳 COCKROACH TRACKER // RANKED ATTENDANCE ENGINE LOADED', 'background: #059669; color: #fff; font-size: 14px; padding: 4px 8px; font-weight: bold; border-radius: 4px;');

  // State
  let config = {
    serverUrl: '',
    dashboardPort: 4200,
    syncIntervalMs: 2000,
    targetHours: 12
  };

  function getServerBaseUrl() {
    if (config.serverUrl && typeof config.serverUrl === 'string' && config.serverUrl.trim()) {
      let u = config.serverUrl.trim().replace(/\/+$/, '');
      if (!u.startsWith('http://') && !u.startsWith('https://')) {
        u = (u.includes('localhost') || u.includes('127.0.0.1')) ? ('http://' + u) : ('https://' + u);
      }
      return u;
    }
    return `http://localhost:${config.dashboardPort || 4200}`;
  }

  let session = {
    sessionId: 'session_' + Date.now(),
    meetingCode: 'meet-room',
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

  let lastTickTime = Date.now();
  let syncTimer = null;
  let tickTimer = null;
  let shadowRoot = null;
  let isPanelOpen = true;

  // Strict Name Blacklist: Filters out Google Meet buttons, tooltips, and action icons
  const UI_BLACKLIST = [
    'pin', 'unpin', 'mute', 'unmute', 'camera', 'microphone', 'more options',
    'turn off', 'turn on', 'visual effects', 'presentation', 'audio', 'video',
    'chat', 'people', 'raise hand', 'lower hand', 'reactions', 'send reaction',
    'call details', 'meeting details', 'in-call messages', 'leave call',
    'end call', 'apply visual effects', 'turn off microphone', 'pin to screen',
    'dont turn off', 'remove from call', 'full screen', 'grid view',
    'speaker view', 'captions', 'turn on captions', 'settings', 'background',
    'device settings', 'troubleshooting', 'report',
    'share screen', 'stop sharing', 'your presentation', 'auto', 'hd', 'standard',
    'switch camera', 'minimize', 'maximize', 'expand', 'collapse', 'close',
    'show everyone', 'add people', 'host controls', 'activities', 'info',
    'turn on microphone', 'turn off camera', 'turn on camera'
  ];

  function sanitizeStudentName(raw, isLocal = false) {
    if (!raw || typeof raw !== 'string') return isLocal ? 'Host (You)' : null;
    let clean = raw.trim();

    clean = clean.replace(/keep_outline|more_vert|mic_off|push_pin|volume_up|more_horiz/gi, '').trim();

    const pinMatch = clean.match(/(?:Pin|Unpin)\s+(.+?)\s+(?:to|from)\s+(?:your\s+)?(?:main\s+)?screen/i);
    if (pinMatch) {
      clean = pinMatch[1].trim();
    } else {
      const simplePin = clean.match(/^(?:Pin|Unpin)\s+([A-Za-z0-9_\s]{2,30})$/i);
      if (simplePin) clean = simplePin[1].trim();
    }

    const isYou = /\((?:You)\)/i.test(clean) || isLocal || clean.toLowerCase() === 'you';
    clean = clean.replace(/\s*\((You|Host|Co-host|Presentation|External|Call)\)/gi, '').trim();

    if (!clean || clean.length === 0) {
      return isYou ? 'Host (You)' : null;
    }

    if (clean.length < 2 || clean.length > 40) return isYou ? 'Host (You)' : null;
    if (/^\d+$/.test(clean) || /^\d{1,2}:\d{2}/.test(clean) || /^\d+%/i.test(clean)) return null;

    const lower = clean.toLowerCase();

    for (const bad of UI_BLACKLIST) {
      if (lower === bad || lower.startsWith(bad + ' ') || lower.endsWith(' ' + bad)) {
        return null;
      }
    }

    if (lower.includes('for everyone') || lower.includes('click to') ||
        lower.includes('microphone') || lower.includes('turn off') ||
        lower.includes('turn on') || lower.includes('more options') ||
        lower.includes('visual effects')) {
      return null;
    }

    if (lower === 'host' || lower === 'you') {
      return isYou ? 'Host (You)' : 'Host';
    }

    return clean;
  }

  function extractMeetingCode() {
    const href = window.location.href;
    const match = href.match(/([a-z0-9]{3,})-([a-z0-9]{4,})-([a-z0-9]{3,})/i);
    if (match) {
      return `${match[1]}-${match[2]}-${match[3]}`.toLowerCase();
    }
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    for (const part of pathParts) {
      if (part.length >= 8 && !['landing', 'lookup', 'get_ready', 'terms'].includes(part.toLowerCase())) {
        return part.toLowerCase();
      }
    }
    return 'study-room';
  }

  function isUserInCall() {
    const inCallSelectors = [
      'button[aria-label*="leave call" i]',
      'button[aria-label*="leave" i]',
      'button[aria-label*="कॉल" i]',
      'button[data-tooltip*="leave" i]',
      'div[data-allocation-index]',
      'div[data-participant-id]',
      'div[data-meeting-code]',
      'button[aria-label*="raise hand" i]',
      'button[aria-label*="chat with everyone" i]',
      'button[aria-label*="Show everyone" i]',
      'button[aria-label*="People" i]'
    ];

    for (const sel of inCallSelectors) {
      if (document.querySelector(sel)) return true;
    }
    const videos = document.querySelectorAll('video');
    return videos.length > 1;
  }

  function formatHms(ms = 0) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function formatTimeOnly(ts) {
    if (!ts) return '--:--';
    return new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
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
      // PAUSED: Study clock stays completely FROZEN at the exact moment pause was pressed!
      const pauseStart = toEpochMs(sess.currentPauseStart) || now;
      const elapsedUpToPause = Math.max(0, pauseStart - startedAt);
      return Math.max(0, elapsedUpToPause - (sess.totalPausedMs || 0));
    }
    // RUNNING: Elapsed time minus all completed pauses
    const elapsed = Math.max(0, now - startedAt);
    return Math.max(0, elapsed - (sess.totalPausedMs || 0));
  }

  // ================= EMBEDDED SHADOW DOM CSS =================
  const SHADOW_CSS = `
    :host {
      all: initial;
      position: fixed;
      top: 65px;
      right: 20px;
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      user-select: none;
      pointer-events: none;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    .cm-wrapper {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
    }
    .cm-launcher-pill {
      pointer-events: auto;
      display: flex;
      align-items: center;
      gap: 8px;
      background: rgba(10, 10, 16, 0.95);
      border: 1px solid #10b981;
      border-radius: 20px;
      padding: 6px 14px;
      color: #fff;
      font-size: 11px;
      font-weight: 800;
      cursor: pointer;
      box-shadow: 0 4px 18px rgba(0, 0, 0, 0.6), 0 0 12px rgba(16, 185, 129, 0.35);
      transition: all 0.2s;
    }
    .cm-launcher-pill:hover {
      transform: scale(1.04);
      border-color: #00ff88;
      box-shadow: 0 4px 22px rgba(0, 255, 136, 0.35);
    }
    .cm-status-tag {
      font-size: 9px;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 800;
    }
    .cm-status-tag.active { background: rgba(0, 255, 136, 0.25); color: #00ff88; }
    .cm-status-tag.paused { background: rgba(255, 184, 0, 0.25); color: #ffb800; }
    .cm-status-tag.off { background: rgba(255, 255, 255, 0.1); color: #8b92b2; }

    .cm-hud-box {
      pointer-events: auto;
      width: 310px;
      background: rgba(10, 10, 16, 0.96);
      backdrop-filter: blur(16px);
      border: 1px solid rgba(16, 185, 129, 0.5);
      box-shadow: 0 12px 42px rgba(0, 0, 0, 0.8), 0 0 24px rgba(16, 185, 129, 0.25);
      border-radius: 14px;
      color: #f0f2fa;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .cm-hud-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 14px;
      background: rgba(24, 26, 38, 0.95);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      cursor: move;
    }
    .cm-hud-brand { display: flex; align-items: center; gap: 8px; }
    .cm-emblem { font-size: 18px; }
    .cm-hud-title-col { display: flex; flex-direction: column; }
    .cm-hud-title { font-size: 11px; font-weight: 800; letter-spacing: 0.8px; color: #fff; }
    .cm-hud-subtitle { font-size: 8px; font-weight: 800; letter-spacing: 0.5px; color: #8b92b2; }
    .cm-hud-controls { display: flex; align-items: center; gap: 8px; }
    .cm-dot { width: 8px; height: 8px; border-radius: 50%; }
    .cm-dot-green { background: #00ff88; box-shadow: 0 0 8px rgba(0, 255, 136, 0.6); }
    .cm-dot-amber { background: #ffb800; box-shadow: 0 0 8px rgba(255, 184, 0, 0.6); }
    .cm-btn-icon {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.15);
      color: #ccc;
      width: 20px;
      height: 20px;
      border-radius: 5px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: bold;
      cursor: pointer;
    }
    .cm-btn-icon:hover { background: #10b981; color: #fff; }
    .cm-hud-body { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 10px; }
    .cm-room-info {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: rgba(255, 255, 255, 0.04);
      padding: 4px 8px;
      border-radius: 6px;
      font-size: 10px;
      border: 1px solid rgba(255, 255, 255, 0.06);
    }
    .cm-room-tag { color: #7b819f; font-weight: 700; }
    .cm-room-code { font-family: monospace; font-weight: 700; color: #e0e4f5; }
    .cm-call-badge { font-size: 9px; font-weight: 800; padding: 1px 6px; border-radius: 4px; }
    .cm-call-badge.in-call { background: rgba(0, 255, 136, 0.2); color: #00ff88; border: 1px solid rgba(0, 255, 136, 0.4); }
    .cm-call-badge.lobby { background: rgba(255, 184, 0, 0.2); color: #ffb800; border: 1px solid rgba(255, 184, 0, 0.4); }
    
    .cm-timer-row { display: flex; align-items: baseline; justify-content: center; gap: 6px; padding: 2px 0; }
    .cm-clock-val {
      font-family: monospace;
      font-size: 26px;
      font-weight: 800;
      color: #ffffff;
      text-shadow: 0 0 12px rgba(16, 185, 129, 0.5);
      letter-spacing: 1px;
    }
    .cm-goal-label { font-size: 11px; color: #8b92b2; font-weight: 600; }

    .cm-control-stack { display: flex; flex-direction: column; gap: 6px; }
    .cm-btn-start {
      width: 100%;
      padding: 9px 12px;
      border-radius: 8px;
      border: 1px solid #00ff88;
      background: linear-gradient(135deg, rgba(0, 255, 136, 0.35), rgba(0, 176, 91, 0.25));
      color: #fff;
      font-weight: 800;
      font-size: 12px;
      cursor: pointer;
      box-shadow: 0 4px 16px rgba(0, 255, 136, 0.35);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }
    .cm-btn-start:hover { background: linear-gradient(135deg, rgba(0, 255, 136, 0.55), rgba(0, 176, 91, 0.45)); }
    
    .cm-btn-reset-hud {
      width: 100%;
      padding: 7px 10px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      background: rgba(255, 255, 255, 0.06);
      color: #cfd4eb;
      font-weight: 700;
      font-size: 10px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }
    .cm-btn-reset-hud:hover {
      background: rgba(255, 42, 75, 0.25);
      border-color: #ff2a4b;
      color: #fff;
    }

    .cm-btn-row { display: flex; gap: 6px; }
    .cm-btn-pause {
      flex: 1.2;
      padding: 8px 6px;
      border-radius: 8px;
      border: 1px solid rgba(255, 184, 0, 0.5);
      background: linear-gradient(135deg, rgba(255, 184, 0, 0.25), rgba(200, 140, 0, 0.2));
      color: #fff;
      font-weight: 700;
      font-size: 10px;
      cursor: pointer;
      white-space: nowrap;
      text-align: center;
    }
    .cm-btn-pause.cm-resuming {
      border-color: rgba(0, 255, 136, 0.6);
      background: linear-gradient(135deg, rgba(0, 255, 136, 0.3), rgba(0, 176, 91, 0.25));
    }
    .cm-btn-stop {
      flex: 1;
      padding: 8px 6px;
      border-radius: 8px;
      border: 1px solid rgba(255, 42, 75, 0.5);
      background: linear-gradient(135deg, rgba(255, 42, 75, 0.25), rgba(192, 40, 45, 0.2));
      color: #fff;
      font-weight: 700;
      font-size: 10px;
      cursor: pointer;
      white-space: nowrap;
      text-align: center;
    }
    .cm-btn-reset-icon {
      width: 32px;
      padding: 8px 0;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      background: rgba(255, 255, 255, 0.08);
      color: #fff;
      cursor: pointer;
      font-size: 12px;
      text-align: center;
    }
    .cm-btn-reset-icon:hover { background: rgba(255, 42, 75, 0.3); border-color: #ff2a4b; }

    .cm-stats-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6px;
      background: rgba(20, 22, 34, 0.7);
      padding: 8px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.05);
      text-align: center;
    }
    .cm-stat-item { display: flex; flex-direction: column; }
    .cm-stat-label { font-size: 9px; text-transform: uppercase; color: #7b819f; font-weight: 600; }
    .cm-stat-number { font-family: monospace; font-size: 13px; font-weight: 700; color: #fff; margin-top: 2px; }
    .cm-green { color: #00ff88; }
    .cm-purple { color: #10b981; }

    .cm-defaulters-panel {
      background: rgba(18, 15, 24, 0.85);
      border: 1px solid rgba(255, 42, 75, 0.3);
      border-radius: 8px;
      padding: 8px 10px;
    }
    .cm-defaulters-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 10px;
      font-weight: 800;
      color: #ff6b7d;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
    }
    .cm-badge {
      background: rgba(255, 42, 75, 0.3);
      border: 1px solid #ff2a4b;
      color: #fff;
      font-size: 9px;
      padding: 1px 5px;
      border-radius: 10px;
    }
    .cm-defaulters-list {
      max-height: 85px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .cm-def-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 10px;
      padding: 3px 6px;
      background: rgba(255, 42, 75, 0.1);
      border-left: 2px solid #ff2a4b;
      border-radius: 4px;
    }
    .cm-def-name { font-weight: 600; color: #f0f2fa; max-width: 140px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cm-def-time { font-family: monospace; color: #ff6b7d; font-weight: 700; }
    .cm-no-defaulters { font-size: 10px; color: #00ff88; text-align: center; padding: 4px 0; font-weight: 600; }
    
    .cm-hud-actions { display: flex; gap: 5px; }
    .cm-btn-action {
      flex: 1;
      padding: 6px 8px;
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.4);
      color: #e0e4f5;
      font-size: 10px;
      font-weight: 700;
      border-radius: 6px;
      cursor: pointer;
      text-align: center;
      white-space: nowrap;
    }
    .cm-btn-action:hover { background: rgba(16, 185, 129, 0.35); color: #fff; }
    .cm-btn-pdf {
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.35), rgba(5, 150, 105, 0.25));
      border-color: rgba(16, 185, 129, 0.5);
      color: #fff;
    }
    .cm-btn-pdf:hover {
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.55), rgba(5, 150, 105, 0.45));
      border-color: #00ff88;
    }
  `;

  // ================= INJECT HUD VIA SHADOW DOM =================
  function mountHUD() {
    if (!document.body) {
      setTimeout(mountHUD, 100);
      return;
    }

    let hostElement = document.getElementById('cockroach-hud-host');
    if (hostElement && shadowRoot) {
      renderControls();
      updateHudUI();
      return;
    }

    if (hostElement) hostElement.remove();

    hostElement = document.createElement('div');
    hostElement.id = 'cockroach-hud-host';
    shadowRoot = hostElement.attachShadow({ mode: 'open' });

    const styleEl = document.createElement('style');
    styleEl.textContent = SHADOW_CSS;
    shadowRoot.appendChild(styleEl);

    const wrapper = document.createElement('div');
    wrapper.className = 'cm-wrapper';

    wrapper.innerHTML = `
      <!-- Floating Always-Visible Launcher Pill -->
      <div class="cm-launcher-pill" id="cm-launcher-pill" title="Toggle Cockroach Tracker Panel">
        <span>🪳 Cockroach Tracker</span>
        <span class="cm-status-tag off" id="cm-pill-status">OFF</span>
      </div>

      <!-- Main Tracker HUD Window -->
      <div class="cm-hud-box" id="cm-hud-box">
        <!-- Header / Drag Handle -->
        <div class="cm-hud-head" id="cm-hud-drag-handle">
          <div class="cm-hud-brand">
            <span class="cm-emblem">🪳</span>
            <div class="cm-hud-title-col">
              <span class="cm-hud-title">COCKROACH TRACKER</span>
              <span class="cm-hud-subtitle" id="cm-hud-status-tag">ATTENDANCE OFF</span>
            </div>
          </div>
          <div class="cm-hud-controls">
            <span class="cm-dot cm-dot-green" id="cm-hud-sync-dot" title="Localhost:4200 Sync Status"></span>
            <button class="cm-btn-icon" id="cm-btn-minimize" title="Close Panel">✕</button>
          </div>
        </div>

        <!-- Body -->
        <div class="cm-hud-body" id="cm-hud-body">
          <!-- Room Info & Status -->
          <div class="cm-room-info" id="cm-room-info">
            <span class="cm-room-tag">ROOM:</span>
            <span class="cm-room-code" id="cm-room-code">${session.meetingCode}</span>
            <span class="cm-call-badge" id="cm-call-badge">READY</span>
          </div>

          <!-- 12H Marathon Timer -->
          <div class="cm-timer-row">
            <div class="cm-clock-val" id="cm-clock-val">00:00:00</div>
            <div class="cm-goal-label">/ 12h Goal</div>
          </div>

          <!-- Controls: Start / Pause / Off / Reset -->
          <div class="cm-control-stack" id="cm-control-stack"></div>

          <!-- Live Metrics Grid -->
          <div class="cm-stats-grid">
            <div class="cm-stat-item">
              <div class="cm-stat-label">Students</div>
              <div class="cm-stat-number" id="cm-attendees-val">0</div>
            </div>
            <div class="cm-stat-item">
              <div class="cm-stat-label">Cam Active</div>
              <div class="cm-stat-number cm-green" id="cm-cams-val">0 / 0</div>
            </div>
            <div class="cm-stat-item">
              <div class="cm-stat-label">Cam %</div>
              <div class="cm-stat-number cm-purple" id="cm-cam-percent-val">0%</div>
            </div>
          </div>

          <!-- Real-Time Camera Defaulter Watch -->
          <div class="cm-defaulters-panel" id="cm-defaulters-panel">
            <div class="cm-defaulters-head">
              <span>⚠️ CAM OFF WATCH</span>
              <span class="cm-badge" id="cm-defaulters-count">0</span>
            </div>
            <div class="cm-defaulters-list" id="cm-defaulters-list">
              <div class="cm-no-defaulters">Attendance is OFF. Press START ATTENDANCE to begin tracking! 🎯</div>
            </div>
          </div>

          <!-- Footer Actions -->
          <div class="cm-hud-actions">
            <button class="cm-btn-action cm-btn-pdf" id="cm-btn-pdf" title="Generate Ranked Attendance PDF Report">📄 Ranked PDF</button>
            <button class="cm-btn-action" id="cm-btn-export" title="Instant CSV Download">📥 CSV</button>
            <button class="cm-btn-action" id="cm-btn-open-dash" title="Open Localhost:4200 Dashboard">🌐 Port 4200</button>
          </div>
        </div>
      </div>
    `;

    shadowRoot.appendChild(wrapper);
    document.body.appendChild(hostElement);

    setupEventListeners();
    renderControls();
    updateHudUI();
    console.log('[Cockroach Tracker] ✅ Mounted inside Shadow DOM on document.body');
  }

  window.__cockroachMountHUD = mountHUD;

  // Open URL reliably bypassing Google Meet CSP / Brave Shields popup blocking
  function openUrlInTab(url) {
    try {
      chrome.runtime.sendMessage({ type: 'OPEN_TAB', url: url }, (res) => {
        if (chrome.runtime.lastError || !res?.success) {
          window.open(url, '_blank');
        }
      });
    } catch (e) {
      window.open(url, '_blank');
    }
  }

  function setupEventListeners() {
    if (!shadowRoot) return;

    const launcherPill = shadowRoot.getElementById('cm-launcher-pill');
    const hudBox = shadowRoot.getElementById('cm-hud-box');
    const btnMin = shadowRoot.getElementById('cm-btn-minimize');
    const btnPdf = shadowRoot.getElementById('cm-btn-pdf');
    const btnExport = shadowRoot.getElementById('cm-btn-export');
    const btnOpenDash = shadowRoot.getElementById('cm-btn-open-dash');

    launcherPill.addEventListener('click', () => {
      isPanelOpen = !isPanelOpen;
      hudBox.style.display = isPanelOpen ? 'flex' : 'none';
    });

    btnMin.addEventListener('click', () => {
      isPanelOpen = false;
      hudBox.style.display = 'none';
    });

    if (btnPdf) {
      btnPdf.addEventListener('click', () => {
        openUrlInTab(`${getServerBaseUrl()}/report?print=true`);
      });
    }

    if (btnExport) {
      btnExport.addEventListener('click', () => {
        openUrlInTab(`${getServerBaseUrl()}/api/session/export/csv`);
      });
    }

    if (btnOpenDash) {
      btnOpenDash.addEventListener('click', () => {
        openUrlInTab(getServerBaseUrl());
      });
    }

    // Draggable HUD window
    const dragHandle = shadowRoot.getElementById('cm-hud-drag-handle');
    const hostEl = document.getElementById('cockroach-hud-host');
    if (dragHandle && hostEl) {
      let isDragging = false;
      let startX, startY, initialLeft, initialTop;

      dragHandle.addEventListener('mousedown', (e) => {
        if (e.target.closest('button, .cm-btn-icon')) return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = hostEl.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;
        hostEl.style.right = 'auto';
        hostEl.style.left = `${initialLeft}px`;
        hostEl.style.top = `${initialTop}px`;
        e.preventDefault();
      });

      window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        hostEl.style.left = `${Math.max(10, Math.min(window.innerWidth - 320, initialLeft + dx))}px`;
        hostEl.style.top = `${Math.max(10, Math.min(window.innerHeight - 100, initialTop + dy))}px`;
      });

      window.addEventListener('mouseup', () => {
        isDragging = false;
      });
    }
  }

  function renderControls() {
    if (!shadowRoot) return;

    const stack = shadowRoot.getElementById('cm-control-stack');
    const statusTag = shadowRoot.getElementById('cm-hud-status-tag');
    const pillStatus = shadowRoot.getElementById('cm-pill-status');
    if (!stack) return;

    if (!session.isTracking) {
      const isFinalized = !!session.stoppedAt;
      if (statusTag) {
        statusTag.innerText = isFinalized ? 'FINALIZED (OFF) ⏹️' : 'ATTENDANCE OFF';
        statusTag.style.color = isFinalized ? '#ffb800' : '#8b92b2';
      }
      if (pillStatus) {
        pillStatus.innerText = isFinalized ? 'FINALIZED ⏹️' : 'OFF';
        pillStatus.className = isFinalized ? 'cm-status-tag paused' : 'cm-status-tag off';
      }

      stack.innerHTML = `
        <button class="cm-btn-start" id="cm-btn-start">
          <span>▶️ ${isFinalized ? 'RESUME / START ATTENDANCE' : 'START ATTENDANCE'}</span>
        </button>
        <button class="cm-btn-reset-hud" id="cm-btn-reset-hud" title="Archive & Reset All Timers to 00:00:00">
          <span>🔄 RESET TO 00:00:00</span>
        </button>
      `;

      shadowRoot.getElementById('cm-btn-start').addEventListener('click', handleStartButtonClick);
      shadowRoot.getElementById('cm-btn-reset-hud').addEventListener('click', handleResetButtonClick);
    } else {
      if (session.isPaused) {
        const now = Date.now();
        const breakDur = session.currentPauseStart ? Math.max(0, now - session.currentPauseStart) : 0;
        if (statusTag) {
          statusTag.innerText = `ATTENDANCE PAUSED ⏸️ (${formatHms(breakDur)})`;
          statusTag.style.color = '#ffb800';
        }
        if (pillStatus) {
          pillStatus.innerText = 'PAUSED ⏸️';
          pillStatus.className = 'cm-status-tag paused';
        }
      } else {
        if (statusTag) {
          statusTag.innerText = 'ATTENDANCE ACTIVE 🟢';
          statusTag.style.color = '#00ff88';
        }
        if (pillStatus) {
          pillStatus.innerText = 'ACTIVE 🟢';
          pillStatus.className = 'cm-status-tag active';
        }
      }

      stack.innerHTML = `
        <div class="cm-btn-row">
          <button class="cm-btn-pause ${session.isPaused ? 'cm-resuming' : ''}" id="cm-btn-pause">
            <span>${session.isPaused ? '▶️ RESUME BREAK' : '⏸️ PAUSE BREAK'}</span>
          </button>
          <button class="cm-btn-stop" id="cm-btn-stop" title="Stop & Finalize Attendance (Keep Results Visible)">
            <span>⏹️ OFF</span>
          </button>
          <button class="cm-btn-reset-icon" id="cm-btn-reset-running" title="Archive & Reset to 00:00:00">
            <span>🔄</span>
          </button>
        </div>
      `;

      shadowRoot.getElementById('cm-btn-pause').addEventListener('click', toggleSessionPause);
      shadowRoot.getElementById('cm-btn-stop').addEventListener('click', stopAttendance);
      shadowRoot.getElementById('cm-btn-reset-running').addEventListener('click', handleResetButtonClick);
    }
  }

  // ================= ATTENDANCE ACTIONS =================
  function handleStartButtonClick() {
    if (session.stoppedAt && session.startedAt) {
      const activeMs = calculateActiveStudyMs(session, Date.now());
      const choice = confirm(
        `A previous completed attendance session exists (${formatHms(activeMs)}).\n\n` +
        `• Click OK to RESET TO 00:00:00 and start a brand new study session.\n` +
        `• Click CANCEL to RESUME the existing session.`
      );
      if (choice) {
        resetSession(true);
        return;
      }
    }
    startAttendance();
  }

  function handleResetButtonClick() {
    if (confirm('Archive current session and RESET all attendance timers to 00:00:00 for a fresh 12-hour marathon?')) {
      resetSession(false);
    }
  }

  function startAttendance() {
    const now = Date.now();
    session.isTracking = true;
    session.isPaused = false;
    session.startedAt = now;
    session.stoppedAt = null;
    session.currentPauseStart = null;
    lastTickTime = now;

    // Synchronize all currently present participants to start tracking at this exact moment
    Object.values(session.participants || {}).forEach(p => {
      p.firstSeen = now;
      p.lastSeen = now;
      p.totalPresentMs = 0;
      p.cameraOnMs = 0;
      p.cameraOffMs = 0;
      p.validStudyMs = 0;
      p.consecutiveCamOffMs = 0;
      p.cameraOffIntervals = [];
      p.cameraIntervals = [{ start: now, end: null, state: p.cameraStatus }];
      if (p.cameraStatus === 'off') {
        p.cameraOffCurrentStart = now;
      } else {
        p.cameraOffCurrentStart = null;
      }
    });

    console.log('[Cockroach Tracker] ▶️ Attendance Started! Study timer running.');

    renderControls();
    saveSession();
    updateHudUI();

    chrome.runtime.sendMessage({
      type: 'SERVER_ACTION',
      serverUrl: getServerBaseUrl(),
      action: 'start'
    }, () => {
      const _err = chrome.runtime.lastError;
      syncSessionNow();
    });
  }

  function stopAttendance() {
    if (!confirm('Turn OFF Attendance Tracking? Timers will freeze and all attendance data will remain visible on the dashboard.')) {
      return;
    }
    const now = Date.now();
    session.isTracking = false;

    // If currently paused, close the pause
    if (session.isPaused && session.currentPauseStart) {
      const pauseDur = now - session.currentPauseStart;
      session.totalPausedMs = (session.totalPausedMs || 0) + pauseDur;
      session.isPaused = false;
      session.currentPauseStart = null;
    }

    session.stoppedAt = now;

    // Close any open camera OFF intervals for participants whose camera was off
    Object.values(session.participants || {}).forEach(p => {
      if (p.cameraIntervals && p.cameraIntervals.length > 0) {
        const last = p.cameraIntervals[p.cameraIntervals.length - 1];
        if (last && !last.end) last.end = now;
      }
      if (p.cameraOffCurrentStart) {
        const dur = now - p.cameraOffCurrentStart;
        if (dur >= 2000) {
          if (!p.cameraOffIntervals) p.cameraOffIntervals = [];
          p.cameraOffIntervals.push({
            start: p.cameraOffCurrentStart,
            end: now,
            durationMs: dur,
            fromTime: formatTimeOnly(p.cameraOffCurrentStart),
            toTime: formatTimeOnly(now),
            durationFormatted: formatHms(dur)
          });
        }
        p.cameraOffCurrentStart = null;
      }
      p.totalDuration = p.totalPresentMs || 0;
      p.duration = p.validStudyMs || 0;
      p.timeInCall = p.totalPresentMs || 0;
      p.durationSeconds = Math.floor((p.validStudyMs || 0) / 1000);
      p.durationMinutes = Math.floor((p.validStudyMs || 0) / 60000);
      p.studyDuration = p.validStudyMs || 0;
    });

    console.log('[Cockroach Tracker] ⏹️ Attendance Turned OFF (Finalized).');

    renderControls();
    saveSession();
    syncSessionNow();
    updateHudUI();

    // Inform server to stop and archive
    chrome.runtime.sendMessage({
      type: 'SERVER_ACTION',
      serverUrl: getServerBaseUrl(),
      action: 'stop',
      payload: { autoArchive: true }
    }, () => {
      const _err = chrome.runtime.lastError;
    });

    // Auto-generate & open the Ranked PDF Report in the exact consolidated format!
    setTimeout(() => {
      openUrlInTab(`${getServerBaseUrl()}/report?print=true`);
    }, 400);
  }

  function resetSession(autoStart = false) {
    const now = Date.now();
    const cleanSession = {
      sessionId: 'session_' + now,
      meetingCode: extractMeetingCode(),
      meetingTitle: 'Cockroach Library 12-Hour Study Marathon',
      startedAt: autoStart ? now : null,
      stoppedAt: null,
      lastUpdated: now,
      isTracking: autoStart,
      isPaused: false,
      totalPausedMs: 0,
      currentPauseStart: null,
      pauseHistory: [],
      targetDurationHours: config.targetHours || 12,
      participants: {}
    };

    // Reset all participants in current session to clean 0
    Object.values(session.participants || {}).forEach(p => {
      p.firstSeen = now;
      p.joinTime = now;
      p.leaveTime = null;
      p.lastSeen = now;
      p.rejoinCount = 0;
      p.rejoinedAt = null;
      p.presenceIntervals = [{ joinTime: now, leaveTime: null, durationMs: 0 }];
      p.joinLeaveHistory = [{ event: 'joined', time: now, formatted: formatTimeOnly(now) }];
      p.totalInMeetMs = 0;
      p.totalPresentMs = 0;
      p.cameraOnMs = 0;
      p.cameraOffMs = 0;
      p.validStudyMs = 0;
      p.totalDuration = 0;
      p.duration = 0;
      p.timeInCall = 0;
      p.durationSeconds = 0;
      p.durationMinutes = 0;
      p.studyDuration = 0;
      p.consecutiveCamOffMs = 0;
      p.cameraOffCurrentStart = (autoStart && p.cameraStatus === 'off') ? now : null;
      p.cameraOffIntervals = [];
      p.cameraIntervals = autoStart ? [{ start: now, end: null, state: p.cameraStatus }] : [];
      cleanSession.participants[p.id] = p;
    });

    session = cleanSession;
    lastTickTime = now;

    // Tell server to reset
    chrome.runtime.sendMessage({
      type: 'SERVER_ACTION',
      serverUrl: getServerBaseUrl(),
      action: 'reset',
      payload: { meetingCode: session.meetingCode }
    }, () => {
      const _ignored = chrome.runtime.lastError;
      if (autoStart) {
        chrome.runtime.sendMessage({
          type: 'SERVER_ACTION',
          serverUrl: getServerBaseUrl(),
          action: 'start'
        }, () => { const _err = chrome.runtime.lastError; });
      }
    });

    saveSession();
    renderControls();
    updateHudUI();
    console.log('[Cockroach Tracker] 🔄 Session reset to 00:00:00.');
  }

  // FIXED PAUSE / RESUME ENGINE (ZERO BACK-COUNTING, ZERO JUMPING)
  function toggleSessionPause() {
    if (!session.isTracking) return;
    const now = Date.now();

    if (session.isPaused) {
      // RESUMING FROM PAUSE
      session.isPaused = false;
      const pauseDuration = session.currentPauseStart ? Math.max(0, now - session.currentPauseStart) : 0;
      session.totalPausedMs = (session.totalPausedMs || 0) + pauseDuration;

      if (!session.pauseHistory) session.pauseHistory = [];
      session.pauseHistory.push({
        pausedAt: session.currentPauseStart || (now - pauseDuration),
        resumedAt: now,
        durationMs: pauseDuration
      });
      session.currentPauseStart = null;
      lastTickTime = now;

      // When resuming, restart cameraOffCurrentStart for participants whose camera is still off
      Object.values(session.participants || {}).forEach(p => {
        if (p.cameraStatus === 'off' && p.currentStatus === 'present') {
          p.cameraOffCurrentStart = now;
        } else {
          p.cameraOffCurrentStart = null;
        }
      });

      console.log('[Cockroach Tracker] ▶️ Resumed. Study timer active.');

      chrome.runtime.sendMessage({
        type: 'SERVER_ACTION',
        serverUrl: getServerBaseUrl(),
        action: 'resume'
      }, () => { const _err = chrome.runtime.lastError; });
    } else {
      // PAUSING TRACKING
      session.isPaused = true;
      session.currentPauseStart = now;

      // Freeze & close any ongoing camera OFF intervals so break time is NEVER deducted as camera off!
      Object.values(session.participants || {}).forEach(p => {
        if (p.cameraOffCurrentStart) {
          const offDur = Math.max(0, now - p.cameraOffCurrentStart);
          if (offDur >= 1000) {
            if (!p.cameraOffIntervals) p.cameraOffIntervals = [];
            p.cameraOffIntervals.push({
              start: p.cameraOffCurrentStart,
              end: now,
              durationMs: offDur,
              fromTime: formatTimeOnly(p.cameraOffCurrentStart),
              toTime: formatTimeOnly(now),
              durationFormatted: formatHms(offDur)
            });
          }
          p.cameraOffCurrentStart = null;
        }
      });

      console.log('[Cockroach Tracker] ⏸️ Paused. Study timer frozen.');

      chrome.runtime.sendMessage({
        type: 'SERVER_ACTION',
        serverUrl: getServerBaseUrl(),
        action: 'pause'
      }, () => { const _err = chrome.runtime.lastError; });
    }

    renderControls();
    saveSession();
    syncSessionNow();
    updateHudUI();
  }

  // ================= PARTICIPANT NAME EXTRACTION =================
  function extractTileParticipantName(tile) {
    if (!tile) return null;

    const attrName = tile.getAttribute('data-self-name') || tile.getAttribute('data-participant-name');
    if (attrName) {
      const s = sanitizeStudentName(attrName);
      if (s) return s;
    }

    const pinBtn = tile.querySelector('button[aria-label*="Pin " i], button[aria-label*="Unpin " i], button[data-tooltip*="Pin " i], button[data-tooltip*="Unpin " i]');
    if (pinBtn) {
      const pinText = pinBtn.getAttribute('aria-label') || pinBtn.getAttribute('data-tooltip') || pinBtn.innerText;
      const s = sanitizeStudentName(pinText);
      if (s) return s;
    }

    const avatarImgs = tile.querySelectorAll('img[alt]');
    for (const img of avatarImgs) {
      const alt = img.getAttribute('alt');
      if (alt && !alt.toLowerCase().includes('avatar') && !alt.toLowerCase().includes('icon')) {
        const s = sanitizeStudentName(alt);
        if (s) return s;
      }
    }

    const notranslateElements = tile.querySelectorAll('.notranslate, [data-self-name], span.zWGUib');
    for (const el of notranslateElements) {
      if (el.closest('button, [role="button"], [role="tooltip"], svg')) continue;
      const s = sanitizeStudentName(el.innerText || el.getAttribute('data-self-name'));
      if (s) return s;
    }

    const nameBadges = tile.querySelectorAll('div[class*="z373Mb"], div[class*="jT57Ub"], div[class*="XE8e1e"], div[class*="A37uZe"], div[class*="dwFTHd"]');
    for (const badge of nameBadges) {
      if (badge.closest('button, [role="button"], [role="tooltip"]')) continue;
      const s = sanitizeStudentName(badge.innerText);
      if (s) return s;
    }

    return null;
  }

  // ================= ULTRA-ACCURATE CAMERA STATUS EVALUATOR =================
  function isPresentationTile(tile) {
    if (!tile) return false;
    if (tile.getAttribute('data-is-presentation') === 'true') return true;
    if (tile.querySelector('[data-is-presentation="true"]')) return true;
    const pinBtn = tile.querySelector('button[aria-label*="presentation" i], button[data-tooltip*="presentation" i]');
    if (pinBtn) return true;
    const label = (tile.getAttribute('aria-label') || '').toLowerCase();
    if (label.includes('presentation') || label.includes('presenting')) return true;
    return false;
  }

  function isVideoActive(video) {
    if (!video) return false;

    // Check direct inline styles
    if (video.style.display === 'none' || video.style.visibility === 'hidden') return false;

    // Check layout dimensions
    if (video.offsetWidth === 0 && video.offsetHeight === 0) return false;

    // Check computed styles
    try {
      const comp = window.getComputedStyle(video);
      if (comp.display === 'none' || comp.visibility === 'hidden' || comp.opacity === '0') {
        return false;
      }
    } catch (_) {}

    // 1. WebRTC MediaStream check
    if (video.srcObject && typeof video.srcObject.getVideoTracks === 'function') {
      const tracks = video.srcObject.getVideoTracks();
      if (tracks && tracks.length > 0) {
        // Live enabled track -> Camera is ON
        const hasLive = tracks.some(t => t.enabled && t.readyState === 'live' && !t.muted);
        if (hasLive) return true;

        // If all video tracks are disabled or ended -> Camera is OFF
        const allOff = tracks.every(t => !t.enabled || t.readyState === 'ended');
        if (allOff) return false;
      }
    }

    // 2. Video frame dimensions (actual decoded pixels)
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      return true;
    }

    // 3. ReadyState or playback progression
    if (video.readyState >= 2 || (typeof video.currentTime === 'number' && video.currentTime > 0)) {
      return true;
    }

    // 4. Rendered layout dimensions with loaded metadata
    if (video.offsetWidth >= 40 && video.offsetHeight >= 40 && video.readyState >= 1) {
      return true;
    }

    return false;
  }

  // ================= SMART BLANK / OBS / BREAK POSTER VIDEO ANALYZER =================
  let offscreenCanvas = null;
  let offscreenCtx = null;

  function analyzeVideoFrame(video) {
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      return { isBlank: false, isApprovedPoster: false, mode: 'unready' };
    }

    // Throttle analysis per video element to once every 2500ms to guarantee zero performance overhead / no lag
    const now = Date.now();
    if (video._ckLastAnalysis && (now - video._ckLastAnalysis.time < 2500)) {
      return video._ckLastAnalysis.result;
    }

    try {
      if (!offscreenCanvas) {
        offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = 32;
        offscreenCanvas.height = 32;
        offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
      }

      offscreenCtx.drawImage(video, 0, 0, 32, 32);
      const imgData = offscreenCtx.getImageData(0, 0, 32, 32);
      const data = imgData.data;
      const total = 32 * 32;

      let blackCount = 0;
      let navyCount = 0;
      let creamCount = 0;
      let yellowCount = 0;
      let amberCount = 0;
      let obsBlueCount = 0;
      let sumR = 0, sumG = 0, sumB = 0;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        sumR += r; sumG += g; sumB += b;

        // 1. Black/Blank pixel
        if (r < 25 && g < 25 && b < 25) blackCount++;

        // 2. OBS Idle Blue screen (RGB approx 15-45, 25-60, 55-110)
        if (r >= 15 && r <= 45 && g >= 25 && g <= 60 && b >= 55 && b <= 110 && (b - r) >= 25) obsBlueCount++;

        // 3. Navy/Teal (Posters 1 & 3)
        if (r >= 10 && r <= 65 && g >= 25 && g <= 80 && b >= 40 && b <= 105) navyCount++;

        // 4. Cream ("BRB" text)
        if (r >= 190 && g >= 180 && b >= 145 && Math.abs(r - g) <= 35) creamCount++;

        // 5. Yellow/Gold ("STEPPING AWAY BRIEFLY", "15 MINUTE BREAK")
        if (r >= 170 && g >= 125 && b <= 95 && (r - b) >= 60) yellowCount++;

        // 6. Amber (Poster 2 room lighting)
        if (r >= 45 && r <= 135 && g >= 30 && g <= 105 && b <= 55 && r > g && g > b) amberCount++;
      }

      const avgBrightness = (sumR + sumG + sumB) / (3 * total);
      const blackRatio = blackCount / total;

      // Approved Break Poster Recognition (3 Official Posters)
      const isPoster1 = (navyCount > 150 && creamCount > 30 && yellowCount > 10);
      const isPoster2 = (yellowCount > 35 && amberCount > 25);
      const isPoster3 = (creamCount > 90 && yellowCount > 15);
      const isApprovedPoster = isPoster1 || isPoster2 || isPoster3;

      // Blank or Fake OBS Idle Screen
      const isBlank = !isApprovedPoster && (blackRatio >= 0.90 || avgBrightness < 14 || (obsBlueCount / total) >= 0.85);

      let mode = 'webcam';
      if (isApprovedPoster) mode = 'poster';
      else if (isBlank) mode = 'blank';

      const result = { isBlank, isApprovedPoster, mode };
      video._ckLastAnalysis = { time: now, result };
      return result;
    } catch (err) {
      // Graceful fallback: never crash or block camera detection if security prevents reading
      return { isBlank: false, isApprovedPoster: false, mode: 'fallback' };
    }
  }

  function evaluateTileCamera(tile) {
    if (!tile) return 'off';

    // 1. Presentation tiles are NOT webcams
    if (isPresentationTile(tile)) return 'off';

    // 2. Explicit camera OFF indicators in Google Meet DOM
    const camOffAttr = tile.querySelector(
      '[data-camera-off="true"], ' +
      '[data-is-muted="true"][aria-label*="camera" i], ' +
      '[aria-label*="camera is off" i], ' +
      '[aria-label*="camera off" i], ' +
      '[data-tooltip*="camera is off" i], ' +
      '[data-tooltip*="camera off" i]'
    );
    if (camOffAttr) return 'off';

    // 3. Video element check
    const video = tile.querySelector('video');
    if (!video) return 'off';

    // If video is actively streaming frames:
    if (isVideoActive(video)) {
      const analysis = analyzeVideoFrame(video);
      // Blank or fake OBS idle screen -> Camera is OFF (cut attendance!)
      if (analysis.isBlank) {
        return 'off';
      }
      // Approved break poster or normal live webcam -> Camera is ON!
      return 'on';
    }

    // 4. Center avatar overlay check when video is inactive
    const centerAvatar = tile.querySelector('div[data-avatar-container], div[class*="avatar"], img[class*="avatar"]');
    if (centerAvatar && centerAvatar.offsetWidth >= 60 && centerAvatar.offsetHeight >= 60) {
      return 'off';
    }

    return 'off';
  }

  function detectLocalCameraStatus() {
    // 1. Check bottom toolbar camera buttons
    const camButtons = Array.from(document.querySelectorAll(
      'button[aria-label*="camera" i], ' +
      'button[data-tooltip*="camera" i], ' +
      'button[aria-label*="video" i], ' +
      'button[data-tooltip*="video" i], ' +
      'button[aria-label*="कैमरा" i], ' +
      'button[data-tooltip*="कैमरा" i]'
    )).filter(btn => {
      const lbl = (btn.getAttribute('aria-label') || btn.getAttribute('data-tooltip') || '').toLowerCase();
      return !lbl.includes('effect') && !lbl.includes('setting') && !lbl.includes('switch') && !lbl.includes('background');
    });

    for (const btn of camButtons) {
      const isMuted = btn.getAttribute('data-is-muted');
      if (isMuted === 'true') return 'off';
      if (isMuted === 'false') return 'on';

      const label = (btn.getAttribute('aria-label') || '').toLowerCase();
      const tooltip = (btn.getAttribute('data-tooltip') || '').toLowerCase();

      // "Turn off camera" means camera is ON right now!
      if (label.includes('turn off camera') || tooltip.includes('turn off camera') ||
          label.includes('turn off video') || tooltip.includes('turn off video') ||
          label.includes('कैमरा बंद') || tooltip.includes('कैमरा बंद')) {
        return 'on';
      }
      // "Turn on camera" means camera is OFF right now!
      if (label.includes('turn on camera') || tooltip.includes('turn on camera') ||
          label.includes('turn on video') || tooltip.includes('turn on video') ||
          label.includes('कैमरा चालू') || tooltip.includes('कैमरा चालू')) {
        return 'off';
      }
    }

    // 2. Check local self video tile in DOM
    const selfTiles = document.querySelectorAll('div[data-self-name], div[data-participant-id*="self"], div[jscontroller][data-self-name]');
    for (const tile of selfTiles) {
      const v = tile.querySelector('video');
      if (v && isVideoActive(v)) return 'on';
    }

    return 'off';
  }

  function scanParticipantsInMeeting() {
    const detected = new Map();
    const now = Date.now();

    // 1. Local Host
    const localCamState = detectLocalCameraStatus();
    let localName = 'Host (You)';
    const selfNameEl = document.querySelector('[data-self-name]');
    if (selfNameEl) {
      localName = selfNameEl.getAttribute('data-self-name') || selfNameEl.innerText || localName;
    }
    const accountEl = document.querySelector('a[aria-label*="Google Account" i], a[aria-label*="Google खाता" i], button[aria-label*="Google Account" i]');
    if (accountEl) {
      const label = accountEl.getAttribute('aria-label') || '';
      const m = label.match(/Google (?:Account|खाata):\s*([^\n\r(]+)/i);
      if (m && m[1].trim()) {
        localName = m[1].trim();
      }
    }
    const cleanHostName = sanitizeStudentName(localName, true) || 'Host (You)';

    detected.set('local_host', {
      id: 'local_host',
      name: cleanHostName,
      isLocal: true,
      hasVisibleTile: true,
      cameraStatus: localCamState,
      rawCameraStatus: localCamState
    });

    // 2. DIRECT ACTIVE VIDEO MAPPING:
    // Analyzes live video frames: catches blank/OBS screens while recognizing the 3 official break posters!
    const activeVideoStudents = new Set();
    const videoDetectionModes = new Map();

    document.querySelectorAll('video').forEach(v => {
      if (!isVideoActive(v)) return;

      const analysis = analyzeVideoFrame(v);
      if (analysis.isBlank) {
        // Blank or fake OBS screen -> Camera is OFF (attendance cut)! Do not mark as active video!
        return;
      }

      // Find participant name by walking up to enclosing tile container
      let container = v.parentElement;
      let depth = 0;
      let foundName = null;
      while (container && depth < 8 && container !== document.body) {
        if (!isPresentationTile(container)) {
          const name = extractTileParticipantName(container);
          if (name) {
            foundName = name;
            break;
          }
        }
        container = container.parentElement;
        depth++;
      }

      if (foundName) {
        const isSelf = container?.hasAttribute('data-self-name') ||
                       foundName.toLowerCase() === 'you' ||
                       foundName.toLowerCase() === 'host (you)' ||
                       (cleanHostName && foundName.toLowerCase() === cleanHostName.toLowerCase());
        if (isSelf) {
          activeVideoStudents.add('local_host');
          videoDetectionModes.set('local_host', analysis.mode);
          if (detected.has('local_host')) {
            detected.get('local_host').cameraStatus = 'on';
            detected.get('local_host').rawCameraStatus = 'on';
            detected.get('local_host').videoDetectionMode = analysis.mode;
          }
        } else {
          const pKey = 'p_' + foundName.toLowerCase().replace(/[^a-z0-9]/g, '_');
          activeVideoStudents.add(pKey);
          videoDetectionModes.set(pKey, analysis.mode);
        }
      }
    });

    // 3. Video Tiles in DOM (Grid and Layout Containers)
    const tileSelectors = [
      'div[data-participant-id]',
      'div[data-requested-participant-id]',
      'div[data-allocation-index]',
      'div[data-self-name]',
      'div[jscontroller][data-participant-id]'
    ];

    const tileSet = new Set(document.querySelectorAll(tileSelectors.join(',')));

    // Include all video element containers
    document.querySelectorAll('video').forEach(v => {
      const parent = v.closest('div[data-participant-id], div[data-allocation-index], div[role="region"], div[data-requested-participant-id], div[jscontroller]') || v.parentElement?.parentElement;
      if (parent) tileSet.add(parent);
    });

    // Include all tiles identified by Pin/Unpin buttons
    document.querySelectorAll('button[aria-label*="Pin " i], button[aria-label*="Unpin " i], button[data-tooltip*="Pin " i], button[data-tooltip*="Unpin " i]').forEach(btn => {
      const parent = btn.closest('div[data-participant-id], div[data-allocation-index], div[role="region"], div[data-requested-participant-id], div[jscontroller]') || btn.parentElement?.parentElement?.parentElement;
      if (parent) tileSet.add(parent);
    });

    const tiles = Array.from(tileSet);

    tiles.forEach(tile => {
      if (isPresentationTile(tile)) return;

      const name = extractTileParticipantName(tile);
      if (!name) return;

      const participantKey = 'p_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_');

      // If tile belongs to local user, sync local_host
      if (tile.hasAttribute('data-self-name') ||
          (cleanHostName && name.toLowerCase() === cleanHostName.toLowerCase()) ||
          name.toLowerCase() === 'host (you)' ||
          name.toLowerCase() === 'you') {
        return;
      }

      if (participantKey === 'p_host__you_' || participantKey === 'p_you' || participantKey === 'local_host') return;

      // Determine camera status: activeVideoStudents has priority, otherwise evaluateTileCamera
      let cameraStatus = activeVideoStudents.has(participantKey) ? 'on' : evaluateTileCamera(tile);
      const detectionMode = videoDetectionModes.get(participantKey) || (cameraStatus === 'on' ? 'webcam' : 'off');

      if (detected.has(participantKey)) {
        const existing = detected.get(participantKey);
        existing.videoDetectionMode = detectionMode;
        // If either previously detected or newly detected as 'on', KEEP 'on'!
        if (cameraStatus === 'on') {
          existing.cameraStatus = 'on';
          existing.rawCameraStatus = 'on';
          existing.hasVisibleTile = true;
        }
      } else {
        detected.set(participantKey, {
          id: participantKey,
          name: name,
          isLocal: false,
          hasVisibleTile: true,
          cameraStatus: cameraStatus,
          rawCameraStatus: cameraStatus,
          videoDetectionMode: detectionMode
        });
      }
    });

    // 4. People Panel (Roster)
    const peopleListItems = document.querySelectorAll('div[role="listitem"]');
    peopleListItems.forEach(item => {
      const spans = item.querySelectorAll('span');
      let foundName = null;
      for (const s of spans) {
        if (s.closest('button, [role="button"], [role="tooltip"]')) continue;
        const c = sanitizeStudentName(s.innerText);
        if (c) {
          foundName = c;
          break;
        }
      }

      if (!foundName) return;
      const participantKey = 'p_' + foundName.toLowerCase().replace(/[^a-z0-9]/g, '_');

      if ((cleanHostName && foundName.toLowerCase() === cleanHostName.toLowerCase()) ||
          foundName.toLowerCase() === 'host (you)' ||
          foundName.toLowerCase() === 'you') return;
      if (participantKey === 'p_host__you_' || participantKey === 'p_you') return;

      // If already detected in grid tiles:
      if (detected.has(participantKey)) {
        // Participant is already verified in DOM grid! Keep their tile status.
        return;
      }

      // Participant is only in People panel (not on current grid page):
      // Inherit their last verified status if activeVideoStudents didn't find them
      let inheritedStatus = activeVideoStudents.has(participantKey) ? 'on' : 'off';
      if (!activeVideoStudents.has(participantKey) && session.participants && session.participants[participantKey]) {
        inheritedStatus = session.participants[participantKey].cameraStatus || 'off';
      }

      detected.set(participantKey, {
        id: participantKey,
        name: foundName,
        isLocal: false,
        hasVisibleTile: false,
        cameraStatus: inheritedStatus,
        rawCameraStatus: inheritedStatus
      });
    });

    return detected;
  }

  // ================= TOTAL TIME IN MEET CALCULATOR =================
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

  // ================= TICK ENGINE =================
  function onTimerTick() {
    const now = Date.now();
    const deltaMs = Math.max(0, now - lastTickTime);
    lastTickTime = now;

    const inCall = isUserInCall();
    const activeCode = extractMeetingCode();
    if (activeCode && activeCode !== session.meetingCode) {
      session.meetingCode = activeCode;
    }

    if (shadowRoot) {
      const callBadge = shadowRoot.getElementById('cm-call-badge');
      const roomCodeEl = shadowRoot.getElementById('cm-room-code');
      if (roomCodeEl) roomCodeEl.innerText = session.meetingCode;
      if (callBadge) {
        if (inCall) {
          callBadge.innerText = 'IN CALL';
          callBadge.className = 'cm-call-badge in-call';
        } else {
          callBadge.innerText = 'READY / LOBBY';
          callBadge.className = 'cm-call-badge lobby';
        }
      }
    }

    const activeDetected = scanParticipantsInMeeting();

    // ALWAYS MAINTAIN ALL DETECTED PARTICIPANTS IN session.participants
    // This guarantees that all students in the room are continuously synced to localhost:4200!
    activeDetected.forEach((scanned, key) => {
      let p = session.participants[key];
      const rawStatus = scanned.cameraStatus || scanned.rawCameraStatus || 'off';

      if (!p) {
        p = {
          id: key,
          name: scanned.name,
          isLocal: scanned.isLocal,
          currentStatus: 'present',
          cameraStatus: rawStatus,
          pendingStatus: null,
          pendingTicks: 0,
          firstSeen: now,
          joinTime: now,
          leaveTime: null,
          lastSeen: now,
          rejoinCount: 0,
          rejoinedAt: null,
          presenceIntervals: [
            { joinTime: now, leaveTime: null, durationMs: 0 }
          ],
          joinLeaveHistory: [
            { event: 'joined', time: now, formatted: formatTimeOnly(now) }
          ],
          totalInMeetMs: 0,
          totalPresentMs: 0,
          cameraOnMs: 0,
          cameraOffMs: 0,
          validStudyMs: 0,
          totalDuration: 0,
          duration: 0,
          timeInCall: 0,
          durationSeconds: 0,
          durationMinutes: 0,
          studyDuration: 0,
          consecutiveCamOffMs: 0,
          cameraOffCurrentStart: (session.isTracking && !session.isPaused && rawStatus === 'off') ? now : null,
          cameraOffIntervals: [],
          cameraIntervals: session.isTracking ? [
            { start: now, end: null, state: rawStatus }
          ] : []
        };
        session.participants[key] = p;
      } else {
        p.name = scanned.name || p.name;
        
        // CHECK FOR REJOIN: Did this participant previously leave the call?
        if (p.currentStatus === 'left') {
          const awayDur = p.leaveTime ? Math.max(0, now - p.leaveTime) : 0;
          p.currentStatus = 'present';
          p.leaveTime = null;
          p.rejoinedAt = now;
          p.rejoinCount = (p.rejoinCount || 0) + 1;

          if (!p.presenceIntervals) p.presenceIntervals = [];
          p.presenceIntervals.push({
            joinTime: now,
            leaveTime: null,
            durationMs: 0
          });

          if (!p.joinLeaveHistory) p.joinLeaveHistory = [];
          p.joinLeaveHistory.push({
            event: 'rejoined',
            time: now,
            formatted: formatTimeOnly(now),
            awayMs: awayDur,
            awayFormatted: formatHms(awayDur)
          });

          console.log(`[Cockroach Tracker] 🔄 [${p.name}] REJOINED Google Meet at ${formatTimeOnly(now)} (Rejoin #${p.rejoinCount}, away for ${formatHms(awayDur)})`);
        } else {
          p.currentStatus = 'present';
        }

        p.lastSeen = now;
        if (!p.joinTime) p.joinTime = p.firstSeen || now;
        if (!p.firstSeen) p.firstSeen = p.joinTime || now;

        // IMMEDIATE ZERO-DELAY CAMERA TRANSITION: Every second matters!
        if (rawStatus !== p.cameraStatus) {
          p.cameraStatus = rawStatus;
          p.pendingStatus = null;
          p.pendingTicks = 0;

          // Close last interval
          const lastInterval = p.cameraIntervals && p.cameraIntervals[p.cameraIntervals.length - 1];
          if (lastInterval && !lastInterval.end) {
            lastInterval.end = now;
          }
          if (!p.cameraIntervals) p.cameraIntervals = [];
          p.cameraIntervals.push({ start: now, end: null, state: rawStatus });

          // Transition: ON -> OFF
          if (rawStatus === 'off') {
            if (session.isTracking && !session.isPaused) {
              p.cameraOffCurrentStart = now;
            } else {
              p.cameraOffCurrentStart = null;
            }
            p.consecutiveCamOffMs = 0;
            console.log(`[Cockroach Tracker] 🔴 [${p.name}] Camera turned OFF at ${formatTimeOnly(now)}`);
          }
          // Transition: OFF -> ON
          else if (rawStatus === 'on') {
            if (session.isTracking && !session.isPaused && p.cameraOffCurrentStart) {
              const offDur = Math.max(0, now - p.cameraOffCurrentStart);
              if (offDur >= 1000) {
                if (!p.cameraOffIntervals) p.cameraOffIntervals = [];
                p.cameraOffIntervals.push({
                  start: p.cameraOffCurrentStart,
                  end: now,
                  durationMs: offDur,
                  fromTime: formatTimeOnly(p.cameraOffCurrentStart),
                  toTime: formatTimeOnly(now),
                  durationFormatted: formatHms(offDur)
                });
              }
            }
            p.cameraOffCurrentStart = null;
            p.consecutiveCamOffMs = 0;
            console.log(`[Cockroach Tracker] 🟢 [${p.name}] Camera turned ON at ${formatTimeOnly(now)}`);
          }
        }

        // ACCURATE TIME ACCUMULATION:
        // Accumulate only while tracking is active and not paused!
        if (session.isTracking && !session.isPaused) {
          if (p.cameraStatus === 'on') {
            p.cameraOnMs = (p.cameraOnMs || 0) + deltaMs;
            p.consecutiveCamOffMs = 0;
          } else {
            p.cameraOffMs = (p.cameraOffMs || 0) + deltaMs;
            p.consecutiveCamOffMs = (p.consecutiveCamOffMs || 0) + deltaMs;
            if (!p.cameraOffCurrentStart) {
              p.cameraOffCurrentStart = now;
            }
          }

          // Strict Mathematical Invariants & Property Aliases:
          p.validStudyMs = p.cameraOnMs;
          p.totalPresentMs = (p.cameraOnMs || 0) + (p.cameraOffMs || 0);
          p.totalDuration = p.totalPresentMs;
          p.duration = p.validStudyMs;
          p.timeInCall = p.totalPresentMs;
          p.durationSeconds = Math.floor(p.validStudyMs / 1000);
          p.durationMinutes = Math.floor(p.validStudyMs / 60000);
          p.studyDuration = p.validStudyMs;
        } else if (session.isTracking && session.isPaused) {
          // Attendance PAUSED: All counters stay completely FROZEN!
        } else if (session.stoppedAt) {
          // Attendance FINALIZED (OFF): Keep all accumulated times FROZEN & INTACT!
          p.consecutiveCamOffMs = 0;
          p.cameraOffCurrentStart = null;
        } else {
          // Attendance OFF / Idle before Start Attendance:
          if (!p.cameraOnMs && !p.cameraOffMs && !p.totalPresentMs) {
            p.totalPresentMs = 0;
            p.cameraOnMs = 0;
            p.cameraOffMs = 0;
            p.validStudyMs = 0;
            p.totalDuration = 0;
            p.duration = 0;
            p.timeInCall = 0;
          }
          p.consecutiveCamOffMs = 0;
          p.cameraOffCurrentStart = null;
        }
      }
    });

    // Mark left participants
    Object.values(session.participants).forEach(p => {
      if (!activeDetected.has(p.id)) {
        if (now - (p.lastSeen || now) > 25000) {
          if (p.currentStatus === 'present') {
            const leftAt = p.lastSeen || now;
            p.currentStatus = 'left';
            p.leaveTime = leftAt;

            // Close active presence interval
            if (p.presenceIntervals && p.presenceIntervals.length > 0) {
              const activePres = p.presenceIntervals[p.presenceIntervals.length - 1];
              if (activePres && !activePres.leaveTime) {
                activePres.leaveTime = leftAt;
                activePres.durationMs = Math.max(0, leftAt - activePres.joinTime);
                activePres.durationFormatted = formatHms(activePres.durationMs);
                activePres.leaveFormatted = formatTimeOnly(leftAt);
              }
            }

            if (!p.joinLeaveHistory) p.joinLeaveHistory = [];
            p.joinLeaveHistory.push({
              event: 'left',
              time: leftAt,
              formatted: formatIstTime(leftAt)
            });

            const lastInterval = p.cameraIntervals && p.cameraIntervals[p.cameraIntervals.length - 1];
            if (lastInterval && !lastInterval.end) {
              lastInterval.end = leftAt;
            }
            if (p.cameraOffCurrentStart) {
              const dur = Math.max(0, leftAt - p.cameraOffCurrentStart);
              if (dur >= 1000) {
                if (!p.cameraOffIntervals) p.cameraOffIntervals = [];
                p.cameraOffIntervals.push({
                  start: p.cameraOffCurrentStart,
                  end: leftAt,
                  durationMs: dur,
                  fromTime: formatTimeOnly(p.cameraOffCurrentStart),
                  toTime: formatTimeOnly(leftAt),
                  durationFormatted: formatHms(dur)
                });
              }
              p.cameraOffCurrentStart = null;
            }

            console.log(`[Cockroach Tracker] 🚪 [${p.name}] LEFT Google Meet at ${formatTimeOnly(leftAt)}`);
          }
        }
      }

      // Always update exact total time spent in meet
      p.totalInMeetMs = calculateTotalInMeetMs(p, now);
      p.timeInCall = p.totalInMeetMs;
    });

    session.lastUpdated = now;
    updateHudUI(activeDetected);
  }

  function saveSession() {
    const storageKey = `cockroach_meet_${session.meetingCode}`;
    chrome.storage.local.set({ [storageKey]: session });
  }

  function adoptServerSession(serverSess) {
    if (!serverSess) return;

    const controlChanged = session.sessionId !== serverSess.sessionId ||
                           session.isTracking !== serverSess.isTracking ||
                           session.isPaused !== serverSess.isPaused ||
                           session.startedAt !== serverSess.startedAt ||
                           session.stoppedAt !== serverSess.stoppedAt;

    session.sessionId = serverSess.sessionId || session.sessionId;
    session.meetingCode = serverSess.meetingCode || session.meetingCode;
    session.isTracking = !!serverSess.isTracking;
    session.isPaused = !!serverSess.isPaused;
    session.startedAt = serverSess.startedAt;
    session.stoppedAt = serverSess.stoppedAt;
    session.totalPausedMs = serverSess.totalPausedMs || 0;
    session.currentPauseStart = serverSess.currentPauseStart;
    session.pauseHistory = serverSess.pauseHistory || [];
    session.targetDurationHours = serverSess.targetDurationHours || 12;

    if (controlChanged) {
      console.log(`[Cockroach Tracker] Master tracking state synced from server: isTracking=${session.isTracking}, isPaused=${session.isPaused}`);
      renderControls();
      updateHudUI();
      saveSession();
    }
  }

  function handleServerEvent(event) {
    if (!event) return;
    console.log('[Cockroach Tracker] Server Event received:', event.type);
    if (event.session) {
      adoptServerSession(event.session);
    } else if (event.type === 'ACTION_START') {
      session.isTracking = true;
      session.isPaused = false;
      session.currentPauseStart = null;
      renderControls();
      updateHudUI();
    } else if (event.type === 'ACTION_STOP') {
      session.isTracking = false;
      session.isPaused = false;
      renderControls();
      updateHudUI();
    } else if (event.type === 'ACTION_PAUSE') {
      session.isPaused = true;
      session.currentPauseStart = event.timestamp || Date.now();
      renderControls();
      updateHudUI();
    } else if (event.type === 'ACTION_RESUME') {
      session.isPaused = false;
      session.currentPauseStart = null;
      renderControls();
      updateHudUI();
    }
  }

  function syncSessionNow() {
    chrome.runtime.sendMessage({
      type: 'SYNC_TO_SERVER',
      serverUrl: getServerBaseUrl(),
      session: session
    }, (response) => {
      const _ignored = chrome.runtime.lastError;
      if (!shadowRoot) return;
      const syncDot = shadowRoot.getElementById('cm-hud-sync-dot');
      if (syncDot) {
        if (response && response.success) {
          syncDot.className = 'cm-dot cm-dot-green';
          if (response.data && response.data.session) {
            adoptServerSession(response.data.session);
          }
        } else {
          syncDot.className = 'cm-dot cm-dot-amber';
        }
      }
    });
  }

  // ================= UPDATE HUD DISPLAY =================
  function updateHudUI(activeMap = null) {
    if (!shadowRoot) mountHUD();
    if (!shadowRoot) return;

    const now = Date.now();
    const activeStudyMs = calculateActiveStudyMs(session, now);
    const timeFormatted = formatHms(activeStudyMs);

    const clockVal = shadowRoot.getElementById('cm-clock-val');
    if (clockVal) clockVal.innerText = timeFormatted;

    // Status subtitle update during pause
    const statusTag = shadowRoot.getElementById('cm-hud-status-tag');
    if (statusTag && session.isTracking && session.isPaused && session.currentPauseStart) {
      const breakDur = Math.max(0, now - session.currentPauseStart);
      statusTag.innerText = `ATTENDANCE PAUSED ⏸️ (${formatHms(breakDur)})`;
    }

    const allParticipants = Object.values(session.participants || {});
    const presentList = allParticipants.filter(p => p.currentStatus === 'present');
    const activeCams = presentList.filter(p => p.cameraStatus === 'on');

    const attendeesVal = shadowRoot.getElementById('cm-attendees-val');
    const camsVal = shadowRoot.getElementById('cm-cams-val');
    const camPercentVal = shadowRoot.getElementById('cm-cam-percent-val');
    const percent = presentList.length > 0 ? ((activeCams.length / presentList.length) * 100).toFixed(0) : 0;

    if (attendeesVal) attendeesVal.innerText = `${presentList.length}`;
    if (camsVal) camsVal.innerText = `${activeCams.length} / ${presentList.length}`;
    if (camPercentVal) camPercentVal.innerText = `${percent}%`;

    // Defaulters List - STRICTLY tied to attendance status
    const defCountEl = shadowRoot.getElementById('cm-defaulters-count');
    const defListEl = shadowRoot.getElementById('cm-defaulters-list');

    if (!session.isTracking) {
      if (defCountEl) defCountEl.innerText = '0';
      if (defListEl) {
        defListEl.innerHTML = '<div class="cm-no-defaulters">Attendance is OFF. Press START ATTENDANCE to begin tracking! 🎯</div>';
      }
    } else if (session.isPaused) {
      if (defCountEl) defCountEl.innerText = '0';
      if (defListEl) {
        defListEl.innerHTML = '<div class="cm-no-defaulters">⏸️ Attendance Paused (Break Time)</div>';
      }
    } else {
      // EXEMPT HOST from Defaulters Watch!
      const defaulters = presentList.filter(p => !p.isLocal && p.id !== 'local_host' && !(p.name && p.name.toLowerCase().includes('host')) && p.cameraStatus === 'off');
      if (defCountEl) defCountEl.innerText = `${defaulters.length}`;
      if (defListEl) {
        if (defaulters.length === 0) {
          defListEl.innerHTML = '<div class="cm-no-defaulters">All present students have camera ON! 🎯</div>';
        } else {
          defListEl.innerHTML = defaulters.map(d => {
            let offMs = d.consecutiveCamOffMs || 0;
            if (d.cameraOffCurrentStart && offMs === 0) {
              offMs = Math.max(0, now - d.cameraOffCurrentStart);
            }
            return `
              <div class="cm-def-item">
                <span class="cm-def-name">${escapeHtml(d.name)}</span>
                <span class="cm-def-time">OFF: ${formatHms(offMs)}</span>
              </div>
            `;
          }).join('');
        }
      }
    }
  }

  // ================= INITIALIZE & SYNC WITH SERVER =================
  function init() {
    session.meetingCode = extractMeetingCode();

    chrome.storage.local.get(['settings'], (res) => {
      const _ignored = chrome.runtime.lastError;
      if (res && res.settings) config = { ...config, ...res.settings };
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.settings && changes.settings.newValue) {
        config = { ...config, ...changes.settings.newValue };
        console.log('[Cockroach Tracker] Live config updated from settings:', config);
      }
    });

    chrome.runtime.sendMessage({
      type: 'GET_SERVER_SESSION',
      serverUrl: getServerBaseUrl()
    }, (resp) => {
      const _ignored = chrome.runtime.lastError;
      if (resp && resp.success && resp.session) {
        const s = resp.session;
        if (s.isTracking || (s.meetingCode === session.meetingCode && (s.startedAt || Object.keys(s.participants || {}).length > 0))) {
          session = { ...session, ...s };
          console.log('[Cockroach Tracker] Synced initial state from server:', session.sessionId);
        }
      }
      mountHUD();
      renderControls();
      updateHudUI();
    });

    mountHUD();

    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(onTimerTick, 1000);

    if (syncTimer) clearInterval(syncTimer);
    syncTimer = setInterval(syncSessionNow, config.syncIntervalMs);

    const observer = new MutationObserver(() => {
      if (!document.getElementById('cockroach-hud-host')) {
        mountHUD();
      }
    });

    if (document.body) {
      observer.observe(document.body, { childList: true });
    }
  }

  // Robust onMessage Listener
  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.type === 'SERVER_WS_EVENT' && req.payload) {
      handleServerEvent(req.payload);
      sendResponse({ ok: true });
      return true;
    }
    if (req.type === 'PING_CHECK' || req.type === 'REINJECT') {
      mountHUD();
      onTimerTick();
      sendResponse({ ok: true, session });
      return true;
    }
    if (req.type === 'START_ATTENDANCE') {
      startAttendance();
      sendResponse({ ok: true, isTracking: true, session });
      return true;
    }
    if (req.type === 'STOP_ATTENDANCE') {
      stopAttendance();
      sendResponse({ ok: true, isTracking: false, session });
      return true;
    }
    if (req.type === 'TOGGLE_PAUSE') {
      toggleSessionPause();
      sendResponse({ ok: true, isPaused: session.isPaused, session });
      return true;
    }
    if (req.type === 'RESET_SESSION') {
      resetSession(false);
      sendResponse({ ok: true, session });
      return true;
    }
    if (req.type === 'GET_SESSION') {
      sendResponse(session);
      return true;
    }
    sendResponse({ ok: false, error: 'Unknown message type' });
    return true;
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
