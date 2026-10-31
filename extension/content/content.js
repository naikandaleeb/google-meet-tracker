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

  let lastUserControlActionTime = 0;
  const knownHostNames = new Set(['host (you)', 'you', 'host', 'host (andaleeb gull)', 'andaleeb gull']);
  const deletedParticipants = new Set();

  function isHostIdentifier(nameOrId) {
    if (!nameOrId) return false;
    const s = String(nameOrId).trim().toLowerCase();
    if (s === 'local_host' || s === 'p_andaleeb_gull' || s === 'p_you' || s === 'p_host__you_') return true;
    for (const h of knownHostNames) {
      if (s === h || s.includes(h) || h.includes(s)) return true;
    }
    return false;
  }

  function sanitizeStudentName(raw, isLocal = false) {
    if (!raw || typeof raw !== 'string') return isLocal ? 'Host (You)' : null;
    let s = String(raw).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    if (!s) return isLocal ? 'Host (You)' : null;

    // 1. Strip Google Meet Material Icon ligatures
    s = s.replace(/\b(?:keep_outline|more_vert|mic_off|push_pin|volume_up|more_horiz|videocam_off|screen_share|closed_caption|hand_raise|call_end)\b/gi, '').trim();

    // 2. Strip Companion & Audio Pairing prefixes/suffixes to extract actual student name (e.g. "Paired with Riya" -> "Riya")
    s = s.replace(/^(?:paired\s+with|audio\s+paired\s+with|audio\s+paired|peering\s+with|peered\s+with|पेयर\s+किया\s+गया)\s+/gi, '').trim();
    s = s.replace(/\s*[\(,]\s*(?:paired\s+with|audio\s+paired\s+with|audio\s+paired|companion\s+mode|companion)[^\)\]]*[\)\]]?/gi, '').trim();
    s = s.replace(/\s+(?:paired\s+with|companion\s+mode).*$/gi, '').trim();
    if (/^(?:paired\s+with|audio\s+paired\s+with|companion\s+mode|peering)$/i.test(s)) {
      return null;
    }

    // 3. Reject Panel Open/Close & Sidebar actions (NEVER a student name)
    if (/^(?:open|close|toggle|show|hide)\s+(?:the\s+)?(?:people|chat|activities|info|panel|sidebar|participants?|roster|controls?|details?|call)\b/i.test(s) ||
        /^(?:open|close)\s+(?:the\s+)?panel\b/i.test(s) ||
        /^(?:people|chat|activities|info|host\s+controls?)\s+panel\b/i.test(s)) {
      return null;
    }

    // 4. Reject Chat & Message strings (NEVER a student name)
    if (/^(?:send\s+a\s+)?(?:message|in-call\s+messages?|chat)\b/i.test(s) ||
        /^(?:message|messages|chat)\b/i.test(s)) {
      return null;
    }

    // 5. Extract clean name from Pin/Unpin action strings (English & Hindi)
    const pinMatchEn = s.match(/(?:Pin|Unpin)\s+(.+?)\s+(?:to|from)\s+(?:your\s+)?(?:main\s+)?screen/i);
    if (pinMatchEn) s = pinMatchEn[1].trim();
    const pinMatchHi = s.match(/(.+?)\s+को\s+(?:अपनी\s+)?(?:मुख्य\s+)?स्क्रीन\s+पर\s+(?:पिन|अनपिन)\s+करें/i);
    if (pinMatchHi) s = pinMatchHi[1].trim();
    s = s.replace(/^(?:Pin|Unpin)\s+/i, '').trim();

    // 6. Strip Video/Feed descriptions commonly found in Google Meet tile aria-labels
    s = s.replace(/^(?:video\s+feed\s+from|video\s+feed\s+of|video\s+from|video\s+of|video\s+for|feed\s+from)\s+/gi, '').trim();
    s = s.replace(/\s*(?:'s\s+video\s+feed|'s\s+video|'s\s+feed|video\s+feed|video)\s*$/gi, '').trim();
    s = s.replace(/'s\s*$/i, '').trim();

    // 7. Strip status suffixes (common in tile aria-labels and People panel)
    s = s.replace(/,\s*(?:speaking|microphone\s+is\s+muted|microphone\s+muted|mic\s+off|mic\s+on|muted|unmuted|video\s+off|video\s+on|camera\s+off|camera\s+on|meeting\s+host|meeting\s+co-host|host|co-host|you)\s*$/gi, '').trim();
    s = s.replace(/\s*\((?:speaking|muted|unmuted|mic\s+off|mic\s+on|video\s+off|video\s+on|camera\s+off|camera\s+on)\)\s*$/gi, '').trim();

    // 8. Check if local user
    const isYou = /\((?:You)\)/i.test(s) || isLocal || s.toLowerCase() === 'you' || s.toLowerCase() === 'host (you)';

    // 9. Strip multi-device qualifiers and duplicate numbers:
    s = s.replace(/\s*[\(\[]\s*(?:\d+|you|host|meeting\s+host|meeting\s+co-host|co-host|presentation|external|call|phone|mobile|laptop|desktop|tablet|guest|audio|mic|webcam|cam|secondary|device\s*\d*)\s*[\)\]]/gi, '').trim();
    s = s.replace(/\s*-\s*\d+$/i, '').trim();
    s = s.replace(/\s*#\s*\d+$/i, '').trim();
    s = s.replace(/\s+\d+$/i, '').trim();

    // 10. Strip presentation suffixes
    s = s.replace(/\s+is\s+presenting$/i, '').trim();
    s = s.replace(/^presentation\s*(?:from|of|by)?\s*[:\-]?\s*/i, '').trim();
    s = s.replace(/'s\s+presentation$/i, '').trim();

    // 11. Strip unclosed opening parentheses/brackets at the end
    s = s.replace(/\s*[\(\[\{][^\)\]\}]*$/g, '').trim();

    // 12. Strip trailing ellipsis / dots (Google Meet truncation: e.g. "Mohammad Rizwan…" or "Mohammad Rizwan...")
    s = s.replace(/[\u2026\.]+\s*$/, '').trim();

    // 13. Strip leading/trailing punctuation and symbols
    s = s.replace(/^[\s\-_,\.:;•|\(\)\[\]]+|[\s\-_,\.:;•|\(\)\[\]]+$/g, '').trim();

    if (!s || s.length === 0) return isYou ? 'Host (You)' : null;

    // Filter pure numbers, timestamps, percentages
    if (/^\d+$/.test(s) || /^\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?$/i.test(s) || /^\d+%/i.test(s)) return null;

    // Length check: Must have at least 2 chars, max 45 chars
    if (s.length < 2 || s.length > 45) return isYou ? 'Host (You)' : null;

    // Must contain at least one letter
    if (!/\p{L}/u.test(s)) return null;

    const lower = s.toLowerCase();

    const BLACKLIST = [
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
      'turn on microphone', 'turn off camera', 'turn on camera', 'reconnecting',
      'waiting', 'audio only', 'companion mode', 'whiteboard', 'jamboard',
      'lock meeting', 'mute all', 'copy joining info', 'stop presenting',
      'problem with microphone', 'camera is off', 'camera is on',
      'microphone is off', 'microphone is on', 'microphone is muted',
      'microphone unmuted', 'speaking', 'silent', 'contributor', 'someone is presenting',
      'others will see your video', 'no one else is here', 'joining info',
      'return to call', 'ask to join', 'jump to call', 'camera failed', 'poor connection',
      'message', 'messages', 'open the people panel', 'open the panel', 'open panel',
      'close panel', 'paired with',
      'spam com', 'spam', 'admin', 'moderator', 'report spam', 'report abuse'
    ];

    for (const bad of BLACKLIST) {
      if (lower === bad || lower.startsWith(bad + ' ') || lower.endsWith(' ' + bad)) {
        return null;
      }
    }

    if (lower.includes('for everyone') || lower.includes('click to') ||
        lower.includes('microphone') || lower.includes('turn off') ||
        lower.includes('turn on') || lower.includes('more options') ||
        lower.includes('visual effects') ||
        lower.includes('open the') || lower.includes('close the') ||
        lower.includes('send a message') || lower.includes('in-call message')) {
      return null;
    }

    if (lower === 'host' || lower === 'you' || lower === 'host (you)') {
      return isYou ? 'Host (You)' : 'Host';
    }

    // 14. Format to clean Title Case
    const isAllUpper = (s === s.toUpperCase());
    const isAllLower = (s === s.toLowerCase());
    if (isAllUpper || isAllLower) {
      s = s.split(' ').map(w => w ? (w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()) : '').join(' ').trim();
    }

    return s;
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
      const safePaused = Math.min(sess.totalPausedMs || 0, elapsed);
      return Math.max(0, elapsed - safePaused);
    }
    if (sess.isPaused) {
      // PAUSED: Study clock stays completely FROZEN at the exact moment pause was pressed!
      const pauseStart = toEpochMs(sess.currentPauseStart) || now;
      const elapsedUpToPause = Math.max(0, pauseStart - startedAt);
      const safePaused = Math.min(sess.totalPausedMs || 0, elapsedUpToPause);
      return Math.max(0, elapsedUpToPause - safePaused);
    }
    // RUNNING: Elapsed time minus all completed pauses
    const elapsed = Math.max(0, now - startedAt);
    const safePaused = Math.min(sess.totalPausedMs || 0, elapsed);
    return Math.max(0, elapsed - safePaused);
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
    .cm-def-name { font-weight: 600; color: #f0f2fa; max-width: 130px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cm-def-time { font-family: monospace; color: #ff6b7d; font-weight: 700; margin-left: auto; }
    .cm-def-del {
      background: rgba(239, 68, 68, 0.2);
      border: 1px solid rgba(239, 68, 68, 0.5);
      color: #f87171;
      border-radius: 4px;
      padding: 1px 5px;
      font-size: 10px;
      cursor: pointer;
      margin-left: 6px;
      transition: all 0.2s;
    }
    .cm-def-del:hover {
      background: rgba(239, 68, 68, 0.5);
      color: #fff;
    }
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
    .cm-btn-override {
      background: rgba(59, 130, 246, 0.2);
      border: 1px solid #3b82f6;
      color: #93c5fd;
      border-radius: 4px;
      font-size: 9.5px;
      font-weight: 800;
      padding: 2px 6px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .cm-btn-override:hover {
      background: rgba(59, 130, 246, 0.4);
      color: #fff;
    }
    .cm-btn-override.active {
      background: rgba(16, 185, 129, 0.25);
      border-color: #10b981;
      color: #34d399;
    }
    .cm-btn-override.active:hover {
      background: rgba(239, 68, 68, 0.25);
      border-color: #ef4444;
      color: #fca5a5;
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
    startAttendance();
  }

  function handleResetButtonClick() {
    if (confirm('Archive current session and RESET all attendance timers to 00:00:00 for a fresh 12-hour marathon?')) {
      resetSession(false);
    }
  }

  function startAttendance() {
    const now = Date.now();
    lastUserControlActionTime = now;
    session.isTracking = true;
    session.isPaused = false;
    const isFresh = !session.startedAt;
    if (isFresh) {
      session.startedAt = now;
      session.totalPausedMs = 0;
      session.pauseHistory = [];
    }
    session.stoppedAt = null;
    session.currentPauseStart = null;
    lastTickTime = now;

    // Synchronize participants: Only reset hours to 0 on a completely FRESH start, NEVER on a resume!
    if (isFresh) {
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
    }

    console.log('[Cockroach Tracker] ▶️ Attendance Started/Resumed! Study timer running.');

    renderControls();
    saveSession();
    updateHudUI();

    chrome.runtime.sendMessage({
      type: 'SERVER_ACTION',
      serverUrl: getServerBaseUrl(),
      action: 'start'
    }, (resp) => {
      const _err = chrome.runtime.lastError;
      if (resp && resp.data && resp.data.session) {
        adoptServerSession(resp.data.session, true);
      }
    });
  }

  function stopAttendance() {
    const now = Date.now();
    lastUserControlActionTime = now;
    session.isTracking = false;
    session.isPaused = false;
    session.stoppedAt = now;
    session.currentPauseStart = null;

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
        const dur = Math.max(0, now - p.cameraOffCurrentStart);
        if (dur >= 1000) {
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
      const totalOff = (p.cameraOffIntervals || []).reduce((sum, int) => sum + (int.durationMs || 0), 0);
      p.cameraOffMs = Math.max(p.cameraOffMs || 0, totalOff);
      p.validStudyMs = p.cameraOnMs || 0;
      p.totalPresentMs = (p.cameraOnMs || 0) + (p.cameraOffMs || 0);
      p.totalDuration = p.totalPresentMs;
      p.duration = p.validStudyMs;
      p.timeInCall = p.totalPresentMs;
      p.durationSeconds = Math.floor((p.validStudyMs || 0) / 1000);
      p.durationMinutes = Math.floor((p.validStudyMs || 0) / 60000);
      p.studyDuration = p.validStudyMs;
    });

    console.log('[Cockroach Tracker] ⏹️ Attendance Turned OFF (Finalized).');

    renderControls();
    saveSession();
    updateHudUI();

    // Inform server immediately to stop & archive
    chrome.runtime.sendMessage({
      type: 'SERVER_ACTION',
      serverUrl: getServerBaseUrl(),
      action: 'stop',
      payload: { autoArchive: true, isExplicitAction: true }
    }, (resp) => {
      const _err = chrome.runtime.lastError;
      if (resp && resp.data && resp.data.session) {
        adoptServerSession(resp.data.session, true);
      }
    });
  }

  function resetSession(autoStart = false) {
    const now = Date.now();
    lastUserControlActionTime = now;
    deletedParticipants.clear();

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
      participants: {} // STRICTLY EMPTY! All previous participants are cleared!
    };

    session = cleanSession;
    lastTickTime = now;

    renderControls();
    updateHudUI();
    saveSession();

    // Tell server to archive and reset
    chrome.runtime.sendMessage({
      type: 'SERVER_ACTION',
      serverUrl: getServerBaseUrl(),
      action: 'reset',
      payload: { meetingCode: session.meetingCode, isExplicitAction: true }
    }, (resp) => {
      const _ignored = chrome.runtime.lastError;
      if (resp && resp.data && resp.data.session) {
        session.sessionId = resp.data.session.sessionId;
        session.participants = {};
        saveSession();
        updateHudUI();
      }
      if (autoStart) {
        chrome.runtime.sendMessage({
          type: 'SERVER_ACTION',
          serverUrl: getServerBaseUrl(),
          action: 'start'
        }, () => { const _err = chrome.runtime.lastError; });
      }
    });

    console.log('[Cockroach Tracker] 🔄 Session reset to 00:00:00. All participants and timers cleared.');
  }

  // FIXED PAUSE / RESUME ENGINE (ZERO BACK-COUNTING, ZERO JUMPING)
  function toggleSessionPause() {
    const now = Date.now();
    lastUserControlActionTime = now;

    if (session.isPaused || !session.isTracking) {
      // RESUMING
      session.isTracking = true;
      session.stoppedAt = null;
      if (session.isPaused) {
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
      }
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

      renderControls();
      saveSession();
      updateHudUI();

      chrome.runtime.sendMessage({
        type: 'SERVER_ACTION',
        serverUrl: getServerBaseUrl(),
        action: 'resume'
      }, (resp) => {
        const _err = chrome.runtime.lastError;
        if (resp && resp.data && resp.data.session) {
          adoptServerSession(resp.data.session, true);
        }
      });
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

      renderControls();
      saveSession();
      updateHudUI();

      chrome.runtime.sendMessage({
        type: 'SERVER_ACTION',
        serverUrl: getServerBaseUrl(),
        action: 'pause'
      }, (resp) => {
        const _err = chrome.runtime.lastError;
        if (resp && resp.data && resp.data.session) {
          adoptServerSession(resp.data.session, true);
        }
      });
    }
  }

  // ================= PARTICIPANT NAME EXTRACTION =================
  function extractTileParticipantName(tile) {
    if (!tile) return null;

    // Priority 1: Direct Google Meet data attributes
    const attrName = tile.getAttribute('data-self-name') || tile.getAttribute('data-participant-name');
    if (attrName) {
      const s = sanitizeStudentName(attrName);
      if (s) return s;
    }

    // Priority 2: Google Meet canonical participant name badge elements (zWGUib, notranslate, layout classes)
    const canonicalNameEl = tile.querySelector('span.zWGUib, div.zWGUib, span[class*="zWGUib"], div[class*="zWGUib"], div[class*="jT57Ub"], div[class*="XE8e1e"], div[class*="z373Mb"], div[class*="A37uZe"], div[class*="dwFTHd"]');
    if (canonicalNameEl && !canonicalNameEl.closest('button, [role="button"], [role="tooltip"], svg')) {
      const s = sanitizeStudentName(canonicalNameEl.innerText);
      if (s) return s;
    }

    const notranslateEl = tile.querySelector('.notranslate');
    if (notranslateEl && !notranslateEl.closest('button, [role="button"], [role="tooltip"], svg')) {
      const s = sanitizeStudentName(notranslateEl.innerText);
      if (s) return s;
    }

    // Priority 3: Google Meet Pin / Unpin button label or tooltip (Very clean participant name source)
    const pinBtn = tile.querySelector('button[aria-label*="Pin " i], button[aria-label*="Unpin " i], button[data-tooltip*="Pin " i], button[data-tooltip*="Unpin " i]');
    if (pinBtn) {
      const pinText = pinBtn.getAttribute('aria-label') || pinBtn.getAttribute('data-tooltip') || pinBtn.innerText;
      const s = sanitizeStudentName(pinText);
      if (s) return s;
    }

    // Priority 4: Avatar profile image alt text (when not generic)
    const avatarImgs = tile.querySelectorAll('img[alt]');
    for (const img of avatarImgs) {
      const alt = img.getAttribute('alt');
      if (alt && !alt.toLowerCase().includes('avatar') && !alt.toLowerCase().includes('icon') && !alt.toLowerCase().includes('profile')) {
        const s = sanitizeStudentName(alt);
        if (s) return s;
      }
    }

    // Priority 5: Tile root aria-label (e.g. "Rahul Sharma's video feed", "Rahul Sharma, speaking")
    const tileAria = tile.getAttribute('aria-label');
    if (tileAria) {
      const s = sanitizeStudentName(tileAria);
      if (s) return s;
    }

    // Priority 6: Text node fallback (STRICTLY EXCLUDING avatar initials, buttons, tooltips)
    const textNodes = tile.querySelectorAll('span, div');
    for (const node of textNodes) {
      if (node.closest('button, [role="button"], [role="tooltip"], svg, style, script, [data-avatar-container], [class*="avatar" i], [role="img"]')) continue;
      if (node.children.length === 0 && node.innerText) {
        const txt = node.innerText.trim();
        // Skip short 1 or 2 letter avatar initials
        if (txt.length >= 3 && txt.length <= 45) {
          const s = sanitizeStudentName(txt);
          if (s) return s;
        }
      }
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

  function isElementVisible(el) {
    if (!el) return false;
    if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
    if (el.style.display === 'none' || el.style.visibility === 'hidden' || el.style.opacity === '0') return false;
    try {
      const comp = window.getComputedStyle(el);
      if (comp.display === 'none' || comp.visibility === 'hidden' || comp.opacity === '0') return false;
    } catch (_) {}
    return true;
  }

  // Detects if Google Meet is showing an avatar (profile picture or initial circle) in the tile
  // If an avatar is visible in the tile and NO active video is streaming, camera is 100% OFF!
  function isTileShowingAvatar(tile) {
    if (!tile) return false;

    // If tile contains an active video streaming, it is definitively NOT showing an avatar!
    const video = tile.querySelector('video');
    if (video && isVideoActive(video)) {
      return false;
    }

    // 1. Google Account Profile Image
    const profileImgs = tile.querySelectorAll('img[src*="googleusercontent.com"], img[src*="gstatic.com"], img[class*="avatar" i], img[data-image-avatar]');
    for (const img of profileImgs) {
      if (isElementVisible(img) && img.offsetWidth >= 22 && img.offsetHeight >= 22) {
        return true;
      }
    }

    // 2. Center Initial Circle or Avatar Container
    const avatarContainers = tile.querySelectorAll('div[data-avatar-container], div[class*="avatar" i], div[aria-label*="avatar" i], span[class*="avatar" i]');
    for (const el of avatarContainers) {
      if (isElementVisible(el) && el.offsetWidth >= 22 && el.offsetHeight >= 22) {
        const lbl = (el.getAttribute('aria-label') || '').toLowerCase();
        if (!lbl.includes('mic') && !lbl.includes('audio') && !lbl.includes('mute') && !lbl.includes('pin')) {
          return true;
        }
      }
    }

    return false;
  }

  // Explicit camera off icons or attributes in Google Meet
  function isCameraOffIndicated(tile) {
    if (!tile) return false;
    const offEl = tile.querySelector(
      '[data-camera-off="true"], ' +
      '[data-is-muted="true"][aria-label*="camera" i], ' +
      '[data-is-muted="true"][data-tooltip*="camera" i], ' +
      '[aria-label*="camera is off" i], ' +
      '[aria-label*="camera off" i], ' +
      '[aria-label*="video is off" i], ' +
      '[aria-label*="video off" i], ' +
      '[data-tooltip*="camera is off" i], ' +
      '[data-tooltip*="camera off" i], ' +
      'i[class*="videocam_off" i], ' +
      'span[class*="videocam_off" i]'
    );
    if (offEl && isElementVisible(offEl)) return true;
    return false;
  }

  function isVideoActive(video) {
    if (!video) return false;

    // Check visibility & physical layout dimensions
    if (!isElementVisible(video)) return false;
    if (video.offsetWidth < 28 || video.offsetHeight < 28) return false;

    // 1. WebRTC MediaStream track verification
    if (video.srcObject && typeof video.srcObject.getVideoTracks === 'function') {
      const tracks = video.srcObject.getVideoTracks();
      if (tracks && tracks.length > 0) {
        // If all tracks are explicitly disabled or ended -> camera is OFF
        const allInactive = tracks.every(t => !t.enabled || t.readyState === 'ended');
        if (allInactive) return false;

        // Must have at least one active, enabled live track
        const hasLive = tracks.some(t => t.enabled && t.readyState === 'live');
        if (!hasLive) return false;
      }
    }

    // 2. Playback state
    if (video.paused && video.readyState < 3) return false;

    // 3. Frame resolution
    if (!video.videoWidth || !video.videoHeight || video.videoWidth < 20 || video.videoHeight < 20) {
      return false;
    }

    // 4. Ready state
    if (video.readyState < 2) return false;

    return true;
  }

  // ================= SMART CAMERA & FULL BLACK SCREEN EVALUATION =================
  let offscreenCanvas = null;
  let offscreenCtx = null;

  // Ultra-fast canvas frame analyzer:
  // Detects if a video element is a FULL BLACK SCREEN (physically covered camera, black tape, closed hardware shutter, black OBS)
  // Real webcams in dark rooms have light/monitor glow on face or surroundings (maxBrightness >= 25).
  // A physically covered camera is completely pitch black (avgBrightness < 10 AND maxBrightness < 25).
  function isFullBlackScreen(video) {
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      return false;
    }

    const now = Date.now();
    if (video._ckLastBlackCheck && (now - video._ckLastBlackCheck.time < 1000)) {
      return video._ckLastBlackCheck.isBlack;
    }

    try {
      if (!offscreenCanvas) {
        offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = 16;
        offscreenCanvas.height = 16;
        offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
      }

      offscreenCtx.drawImage(video, 0, 0, 16, 16);
      const imgData = offscreenCtx.getImageData(0, 0, 16, 16);
      const data = imgData.data;
      const total = 16 * 16;

      let sumBrightness = 0;
      let maxBrightness = 0;

      for (let i = 0; i < data.length; i += 4) {
        const br = (data[i] + data[i + 1] + data[i + 2]) / 3;
        sumBrightness += br;
        if (br > maxBrightness) maxBrightness = br;
      }

      const avgBrightness = sumBrightness / total;
      // FULL BLACK SCREEN: Entire frame has almost zero light (avg < 10 AND max < 25)
      const isBlack = (avgBrightness < 10 && maxBrightness < 25);

      video._ckLastBlackCheck = { time: now, isBlack };
      return isBlack;
    } catch (_) {
      return false;
    }
  }

  function evaluateTileCamera(tile) {
    if (!tile) return 'off';

    // 1. Presentation tiles are NOT webcams
    if (isPresentationTile(tile)) return 'off';

    // 2. Video element check
    const video = tile.querySelector('video');
    if (video && isVideoActive(video)) {
      // If video is streaming a full black screen (tape/shutter/covered lens/black OBS) -> camera is OFF!
      if (isFullBlackScreen(video)) {
        return 'off';
      }
      return 'on';
    }

    // 3. Explicit camera OFF indicators in Google Meet DOM
    if (isCameraOffIndicated(tile)) return 'off';

    return 'off';
  }

  function detectLocalCameraStatus() {
    // 1. Check local video element in DOM (self-view is mirrored by default in Meet)
    const videos = Array.from(document.querySelectorAll('video'));
    for (const v of videos) {
      let isLocalVideo = false;
      if (v.closest('div[data-self-name], div[data-participant-id*="self"], div[aria-label*="(You)" i], div[aria-label*="(आप)" i]')) {
        isLocalVideo = true;
      } else {
        const trans = (v.style && v.style.transform) ? v.style.transform : '';
        try {
          const comp = window.getComputedStyle(v).transform;
          if (trans.includes('-1') || comp.includes('-1')) isLocalVideo = true;
        } catch (_) {}
      }
      if (isLocalVideo && isVideoActive(v)) {
        if (isFullBlackScreen(v)) return 'off';
        return 'on';
      }
    }

    // 2. Check bottom toolbar camera buttons
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
      // Check Material icon ligatures
      const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
      if (text.includes('videocam_off')) return 'off';
      if (text.includes('videocam')) return 'on';

      const isMuted = btn.getAttribute('data-is-muted');
      if (isMuted === 'true') return 'off';
      if (isMuted === 'false') return 'on';

      const label = (btn.getAttribute('aria-label') || '').toLowerCase();
      const tooltip = (btn.getAttribute('data-tooltip') || '').toLowerCase();

      // "Turn off camera" means camera is ON right now!
      if (label.includes('turn off camera') || tooltip.includes('turn off camera') ||
          label.includes('turn off video') || tooltip.includes('turn off video') ||
          label.includes('कैमरा बंद') || tooltip.includes('कैमरा बंद') ||
          label.includes('desactivar cámara') || label.includes('désactiver la caméra')) {
        return 'on';
      }
      // "Turn on camera" means camera is OFF right now!
      if (label.includes('turn on camera') || tooltip.includes('turn on camera') ||
          label.includes('turn on video') || tooltip.includes('turn on video') ||
          label.includes('कैमरा चालू') || tooltip.includes('कैमरा चालू') ||
          label.includes('activar cámara') || label.includes('activer la caméra')) {
        return 'off';
      }
    }

    return 'off';
  }

  function scanParticipantsInMeeting() {
    const detected = new Map();
    const now = Date.now();

    // Aliases to consolidate paired companion keys into real student keys
    const KEY_ALIASES = {
      'p_paired_with_riya': 'p_riya',
      'p_paired_with_souvik_debnath': 'p_souvik_debnath'
    };
    if (session.participants) {
      for (const [fromKey, toKey] of Object.entries(KEY_ALIASES)) {
        if (session.participants[fromKey]) {
          const fromP = session.participants[fromKey];
          if (!session.participants[toKey]) {
            session.participants[toKey] = { ...fromP, id: toKey, name: toKey === 'p_riya' ? 'Riya' : 'Souvik Debnath' };
          } else {
            const toP = session.participants[toKey];
            toP.cameraOnMs = Math.max(toP.cameraOnMs || 0, fromP.cameraOnMs || 0);
            toP.totalPresentMs = Math.max(toP.totalPresentMs || 0, fromP.totalPresentMs || 0);
            toP.validStudyMs = Math.max(toP.validStudyMs || 0, fromP.validStudyMs || 0);
          }
          delete session.participants[fromKey];
        }
      }
    }

    // Clean session from bad keys and host duplicates immediately
    const badKeys = ['p_message', 'p_open_the_people_panel', 'p_admin', 'p_spam_com', 'p_andaleeb_gull'];
    badKeys.forEach(bk => {
      if (session.participants && session.participants[bk]) {
        delete session.participants[bk];
      }
    });

    if (session.participants) {
      for (const [pid, pObj] of Object.entries(session.participants)) {
        if (pid !== 'local_host') {
          if (isHostIdentifier(pObj.name) || isHostIdentifier(pid) || !sanitizeStudentName(pObj.name)) {
            delete session.participants[pid];
          }
        }
      }
    }

    // 1. Local Host identification
    const localCamState = detectLocalCameraStatus();
    let localName = 'Host (You)';
    const selfNameEl = document.querySelector('[data-self-name]');
    if (selfNameEl) {
      const sn = selfNameEl.getAttribute('data-self-name') || selfNameEl.innerText;
      if (sn && sn.trim()) localName = sn.trim();
    }
    const accountEl = document.querySelector('a[aria-label*="Google Account" i], a[aria-label*="Google खाता" i], button[aria-label*="Google Account" i], button[aria-label*="Google खाता" i]');
    if (accountEl) {
      const label = accountEl.getAttribute('aria-label') || '';
      const m = label.match(/Google (?:Account|खाता):\s*([^\n\r(]+)/i);
      if (m && m[1].trim()) {
        localName = m[1].trim();
      }
    }
    // Also check for (You) in roster or DOM to find host real name
    const youEl = document.querySelector('div[role="listitem"][aria-label*="(You)" i], div[role="listitem"][aria-label*="(आप)" i], [data-participant-id][aria-label*="(You)" i]');
    if (youEl) {
      const ya = youEl.getAttribute('aria-label') || '';
      const yName = ya.split(',')[0].replace(/\s*\((?:You|आप)\)/i, '').trim();
      if (yName && yName.length >= 2) localName = yName;
    }

    const cleanHostName = sanitizeStudentName(localName, true) || 'Host (You)';
    if (cleanHostName && cleanHostName !== 'Host (You)') {
      knownHostNames.add(cleanHostName.toLowerCase());
    }

    detected.set('local_host', {
      id: 'local_host',
      name: cleanHostName === 'Host (You)' ? 'Host (You)' : `Host (${cleanHostName})`,
      isLocal: true,
      isHost: true,
      isExempt: true,
      hasVisibleTile: true,
      cameraStatus: localCamState,
      rawCameraStatus: localCamState
    });

    // 2. DIRECT ACTIVE VIDEO MAPPING:
    const activeVideoStudents = new Set();
    const videoDetectionModes = new Map();

    document.querySelectorAll('video').forEach(v => {
      if (!isVideoActive(v)) return;
      // If the video frame is a full black screen (physically covered camera / closed shutter / tape) -> NOT active camera!
      if (isFullBlackScreen(v)) return;

      // Find enclosing tile container using native closest() or parent search
      const tile = v.closest('div[data-participant-id], div[data-requested-participant-id], div[data-initial-participant-id], div[data-allocation-index], div[data-self-name], div[data-tile-id], div[role="region"], div[role="listitem"]') || v.parentElement;
      let foundName = extractTileParticipantName(tile);

      if (!foundName) {
        let p = v.parentElement;
        let depth = 0;
        while (p && depth < 12 && p !== document.body) {
          if (!isPresentationTile(p)) {
            const n = extractTileParticipantName(p);
            if (n) {
              foundName = n;
              break;
            }
          }
          p = p.parentElement;
          depth++;
        }
      }

      if (foundName) {
        const isSelf = tile?.hasAttribute('data-self-name') ||
                       isHostIdentifier(foundName) ||
                       (cleanHostName && foundName.toLowerCase() === cleanHostName.toLowerCase());
        if (isSelf) {
          activeVideoStudents.add('local_host');
          videoDetectionModes.set('local_host', 'webcam');
          if (detected.has('local_host')) {
            detected.get('local_host').cameraStatus = 'on';
            detected.get('local_host').rawCameraStatus = 'on';
            detected.get('local_host').videoDetectionMode = 'webcam';
          }
        } else {
          const pKey = 'p_' + foundName.toLowerCase().replace(/[^a-z0-9]/g, '_');
          activeVideoStudents.add(pKey);
          videoDetectionModes.set(pKey, 'webcam');
        }
      }
    });

    // 3. Video Tiles in DOM
    const tileSelectors = [
      'div[data-participant-id]',
      'div[data-requested-participant-id]',
      'div[data-initial-participant-id]',
      'div[data-allocation-index]',
      'div[data-self-name]',
      'div[data-tile-id]',
      'div[role="region"][aria-label]'
    ];

    const tileSet = new Set(document.querySelectorAll(tileSelectors.join(',')));

    document.querySelectorAll('video').forEach(v => {
      const parent = v.closest('div[data-participant-id], div[data-allocation-index], div[role="region"], div[data-requested-participant-id], div[data-self-name]');
      if (parent) tileSet.add(parent);
    });

    const tiles = Array.from(tileSet);

    tiles.forEach(tile => {
      if (isPresentationTile(tile)) return;

      const name = extractTileParticipantName(tile);
      if (!name) return;

      if (tile.hasAttribute('data-self-name') ||
          isHostIdentifier(name) ||
          (cleanHostName && name.toLowerCase() === cleanHostName.toLowerCase())) {
        return; // Host is handled via local_host
      }

      const participantKey = 'p_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_');
      if (isHostIdentifier(participantKey)) return;
      if (deletedParticipants.has(participantKey) || deletedParticipants.has(name.toLowerCase())) return;

      let tileCamOn = false;
      let detectionMode = 'off';

      if (activeVideoStudents.has(participantKey)) {
        const vid = tile.querySelector('video');
        if (vid && isFullBlackScreen(vid)) {
          tileCamOn = false;
          detectionMode = 'off';
        } else {
          tileCamOn = true;
          detectionMode = 'webcam';
        }
      } else {
        const evalStatus = evaluateTileCamera(tile);
        tileCamOn = (evalStatus === 'on');
        detectionMode = tileCamOn ? 'webcam' : 'off';
      }

      if (detected.has(participantKey)) {
        const existing = detected.get(participantKey);
        existing.hasVisibleTile = true;
        existing.deviceCount = (existing.deviceCount || 1) + 1;

        if (tileCamOn || existing.cameraStatus === 'on') {
          existing.cameraStatus = 'on';
          existing.rawCameraStatus = 'on';
          existing.videoDetectionMode = tileCamOn ? detectionMode : (existing.videoDetectionMode || 'webcam');
        }
      } else {
        detected.set(participantKey, {
          id: participantKey,
          name: name,
          isLocal: false,
          hasVisibleTile: true,
          deviceCount: 1,
          cameraStatus: tileCamOn ? 'on' : 'off',
          rawCameraStatus: tileCamOn ? 'on' : 'off',
          videoDetectionMode: detectionMode
        });
      }
    });

    // 4. People Panel (Roster) - Strictly scoped to People container, never Chat!
    const peopleContainers = document.querySelectorAll('div[aria-label*="People" i], div[aria-label*="लोग" i], aside, [data-tab-id="1"]');
    const peopleListItems = [];
    if (peopleContainers.length > 0) {
      peopleContainers.forEach(c => {
        if (!c.closest('[aria-label*="Chat" i], [aria-label*="संदेश" i], .in-call-chat, [aria-live="polite"]')) {
          c.querySelectorAll('div[role="listitem"]').forEach(item => peopleListItems.push(item));
        }
      });
    }
    if (peopleListItems.length === 0) {
      document.querySelectorAll('div[role="listitem"]').forEach(item => {
        if (item.closest('[aria-label*="Chat" i], [aria-label*="संदेश" i], .in-call-chat, [aria-live="polite"]')) return;
        if (item.querySelector('button[aria-label*="action" i], button[aria-label*="pin" i], button[aria-label*="mute" i], [data-participant-id]')) {
          peopleListItems.push(item);
        }
      });
    }

    peopleListItems.forEach(item => {
      let foundName = null;

      const itemAria = item.getAttribute('aria-label') || '';
      const isYou = itemAria.includes('(You)') || itemAria.includes('(आप)') ||
                    (item.innerText && (item.innerText.includes('(You)') || item.innerText.includes('(आप)')));

      if (isYou) {
        const firstPart = itemAria.split(',')[0].replace(/\s*\((?:You|आप)\)/i, '').trim();
        const hn = sanitizeStudentName(firstPart) || sanitizeStudentName(item.innerText.split('\n')[0]);
        if (hn && hn !== 'Host (You)') {
          knownHostNames.add(hn.toLowerCase());
          if (detected.has('local_host')) {
            detected.get('local_host').name = `Host (${hn})`;
          }
        }
        return; // Host is strictly exempt from student roster
      }

      // Check canonical name element in People roster item first
      const canonical = item.querySelector('span.zWGUib, div.zWGUib, span[class*="zWGUib"], div[class*="jT57Ub"], [data-participant-id] span, span.notranslate, div.notranslate');
      if (canonical && !canonical.closest('button, [role="button"], [role="tooltip"], svg')) {
        foundName = sanitizeStudentName(canonical.innerText);
      }

      // Check listitem aria-label (Format: "Rahul Sharma, Meeting host, Microphone muted")
      if (!foundName && itemAria) {
        const firstPart = itemAria.split(',')[0].trim();
        foundName = sanitizeStudentName(firstPart);
      }

      // Fallback: check spans outside of avatar initials and buttons
      if (!foundName) {
        const spans = item.querySelectorAll('span, div');
        for (const s of spans) {
          if (s.closest('button, [role="button"], [role="tooltip"], svg, [data-avatar-container], [class*="avatar" i], [role="img"]')) continue;
          if (s.children.length === 0 && s.innerText) {
            const txt = s.innerText.trim();
            if (txt.length >= 3 && txt.length <= 45) {
              const c = sanitizeStudentName(txt);
              if (c) {
                foundName = c;
                break;
              }
            }
          }
        }
      }

      if (!foundName) return;
      if (isHostIdentifier(foundName)) return;

      const participantKey = 'p_' + foundName.toLowerCase().replace(/[^a-z0-9]/g, '_');
      if (isHostIdentifier(participantKey)) return;
      if (deletedParticipants.has(participantKey) || deletedParticipants.has(foundName.toLowerCase())) return;

      // If already detected in grid tiles:
      if (detected.has(participantKey)) {
        return;
      }

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

  // ================= HOST MANUAL CAMERA OVERRIDE =================
  function toggleManualCameraOverride(participantId) {
    let p = session.participants[participantId];
    if (!p) return;
    const newOverride = !p.manualCamOverride;
    p.manualCamOverride = newOverride;
    if (newOverride) {
      p.cameraStatus = 'on';
      p.rawCameraStatus = 'on';
      p.cameraOffCurrentStart = null;
      p.consecutiveCamOffMs = 0;
    }
    chrome.runtime.sendMessage({
      type: 'SERVER_ACTION',
      serverUrl: getServerBaseUrl(),
      action: 'override',
      payload: { participantId, manualCamOverride: newOverride }
    }, () => { const _e = chrome.runtime.lastError; });

    saveSession();
    syncSessionNow();
    updateHudUI();
    console.log(`[Cockroach Tracker] Host manual camera override for [${p.name}]: ${newOverride ? 'FORCE ON' : 'AUTO'}`);
  }

  // ================= PARTICIPANT DELETION =================
  function deleteParticipant(participantId, participantName) {
    if (participantId) deletedParticipants.add(participantId.toLowerCase());
    if (participantName) deletedParticipants.add(participantName.toLowerCase());
    if (session.participants && session.participants[participantId]) {
      delete session.participants[participantId];
    }
    chrome.runtime.sendMessage({
      type: 'SERVER_ACTION',
      serverUrl: getServerBaseUrl(),
      action: 'delete_participant',
      payload: { participantId }
    }, () => { const _e = chrome.runtime.lastError; });

    saveSession();
    updateHudUI();
    console.log(`[Cockroach Tracker] 🗑️ Deleted participant [${participantName || participantId}] from attendance.`);
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
      const isNewParticipant = !p;

      if (isNewParticipant) {
        const isCamOn = (rawStatus === 'on');
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
          cameraOffCurrentStart: (session.isTracking && !session.isPaused && !isCamOn) ? now : null,
          cameraOffIntervals: [],
          cameraIntervals: session.isTracking ? [
            { start: now, end: null, state: rawStatus }
          ] : [],
          videoDetectionMode: scanned.videoDetectionMode || 'off'
        };
        session.participants[key] = p;
        console.log(`[Cockroach Tracker] 👤 Late Joiner Initiated: [${p.name}] at ${formatTimeOnly(now)} (Camera: ${rawStatus.toUpperCase()})`);
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
      }

      // TIME ACCUMULATION FOR ALL ACTIVE PARTICIPANTS (INCLUDING LATE JOINERS ON THEIR VERY FIRST TICK!):
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

      p.totalInMeetMs = calculateTotalInMeetMs(p, now);
      p.lastSeen = now;
    });

    // Mark left participants
    let hasParticipantLeft = false;
    Object.values(session.participants).forEach(p => {
      if (!activeDetected.has(p.id)) {
        if (now - (p.lastSeen || now) > 10000) {
          if (p.currentStatus === 'present') {
            const leftAt = p.lastSeen || now;
            p.currentStatus = 'left';
            p.cameraStatus = 'off';
            p.rawCameraStatus = 'off';
            p.leaveTime = leftAt;
            hasParticipantLeft = true;

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

            console.log(`[Cockroach Tracker] 🚪 [${p.name}] LEFT Google Meet at ${formatTimeOnly(leftAt)} (Attendance FROZEN)`);
          }
        }
      }

      // Always update exact total time spent in meet
      p.totalInMeetMs = calculateTotalInMeetMs(p, now);
      p.timeInCall = p.totalInMeetMs;
    });

    if (hasParticipantLeft) {
      saveSession();
      syncSessionNow();
    }

    session.lastUpdated = now;
    updateHudUI(activeDetected);
  }

  function saveSession() {
    const storageKey = `cockroach_meet_${session.meetingCode}`;
    chrome.storage.local.set({ [storageKey]: session });
  }

  function adoptServerSession(serverSess, isActionResponse = false) {
    if (!serverSess) return;

    if (isActionResponse) {
      lastUserControlActionTime = 0;
    }

    // IF SESSION ID CHANGED (e.g. Master Reset on server or session loaded):
    // FULLY REPLACE local participants so old participants from previous marathon are completely cleared!
    if (serverSess.sessionId && serverSess.sessionId !== session.sessionId) {
      console.log(`[Cockroach Tracker] 🔄 Adopting new session ID from server: ${serverSess.sessionId}`);
      session.sessionId = serverSess.sessionId;
      session.meetingCode = serverSess.meetingCode || session.meetingCode;
      session.startedAt = serverSess.startedAt;
      session.stoppedAt = serverSess.stoppedAt;
      session.isTracking = !!serverSess.isTracking;
      session.isPaused = !!serverSess.isPaused;
      session.totalPausedMs = serverSess.totalPausedMs || 0;
      session.currentPauseStart = serverSess.currentPauseStart;
      session.pauseHistory = serverSess.pauseHistory || [];
      session.targetDurationHours = serverSess.targetDurationHours || 12;

      if (serverSess.participants && Object.keys(serverSess.participants).length > 0) {
        session.participants = JSON.parse(JSON.stringify(serverSess.participants));
      } else if (serverSess.lastResetAt) {
        session.participants = {};
      }
      deletedParticipants.clear();
      renderControls();
      updateHudUI();
      saveSession();
      return;
    }

    if (serverSess.deletedParticipants && Array.isArray(serverSess.deletedParticipants)) {
      serverSess.deletedParticipants.forEach(dp => {
        deletedParticipants.add(dp.toLowerCase());
        if (session.participants && session.participants[dp]) {
          delete session.participants[dp];
        }
      });
      if (session.participants) {
        for (const [k, p] of Object.entries(session.participants)) {
          if (p.name && deletedParticipants.has(p.name.toLowerCase())) {
            delete session.participants[k];
          }
        }
      }
    }

    // Merge participants monotonically from server session so hours & attendance are never lost
    if (serverSess.participants && typeof serverSess.participants === 'object') {
      if (!session.participants) session.participants = {};
      for (const [id, sp] of Object.entries(serverSess.participants)) {
        if (deletedParticipants.has(id.toLowerCase()) || (sp.name && deletedParticipants.has(sp.name.toLowerCase()))) continue;
        const localP = session.participants[id];
        if (!localP) {
          session.participants[id] = { ...sp };
        } else {
          localP.cameraOnMs = Math.max(localP.cameraOnMs || 0, sp.cameraOnMs || 0);
          localP.cameraOffMs = Math.max(localP.cameraOffMs || 0, sp.cameraOffMs || 0);
          localP.validStudyMs = Math.max(localP.validStudyMs || 0, sp.validStudyMs || 0);
          localP.totalPresentMs = Math.max(localP.totalPresentMs || 0, sp.totalPresentMs || 0);
          localP.firstSeen = Math.min(toEpochMs(localP.firstSeen) || Date.now(), toEpochMs(sp.firstSeen) || Date.now());
          localP.joinTime = Math.min(toEpochMs(localP.joinTime) || Date.now(), toEpochMs(sp.joinTime) || Date.now());
          if (sp.presenceIntervals && Array.isArray(sp.presenceIntervals) && (!localP.presenceIntervals || localP.presenceIntervals.length === 0)) {
            localP.presenceIntervals = sp.presenceIntervals;
          }
          if (sp.cameraOffIntervals && Array.isArray(sp.cameraOffIntervals)) {
            if (!localP.cameraOffIntervals) localP.cameraOffIntervals = [];
            sp.cameraOffIntervals.forEach(newInt => {
              const newStart = toEpochMs(newInt.start) || 0;
              if (!localP.cameraOffIntervals.some(ex => Math.abs((toEpochMs(ex.start) || 0) - newStart) < 2000)) {
                localP.cameraOffIntervals.push(newInt);
              }
            });
            const totOff = localP.cameraOffIntervals.reduce((s, i) => s + (i.durationMs || 0), 0);
            localP.cameraOffMs = Math.max(localP.cameraOffMs || 0, totOff);
          }
          if (sp.manualCamOverride !== undefined) {
            localP.manualCamOverride = sp.manualCamOverride;
          }
        }
      }
    }

    const isRecentLocalAction = (Date.now() - lastUserControlActionTime) < 4000;

    const controlChanged = session.sessionId !== serverSess.sessionId ||
                           (!isRecentLocalAction && (
                             session.isTracking !== serverSess.isTracking ||
                             session.isPaused !== serverSess.isPaused ||
                             session.startedAt !== serverSess.startedAt ||
                             session.stoppedAt !== serverSess.stoppedAt
                           ));

    session.sessionId = serverSess.sessionId || session.sessionId;
    session.meetingCode = serverSess.meetingCode || session.meetingCode;
    session.targetDurationHours = serverSess.targetDurationHours || 12;

    if (isActionResponse || !isRecentLocalAction) {
      session.isTracking = !!serverSess.isTracking;
      session.isPaused = !!serverSess.isPaused;
      session.startedAt = serverSess.startedAt;
      session.stoppedAt = serverSess.stoppedAt;
      session.totalPausedMs = serverSess.totalPausedMs || 0;
      session.currentPauseStart = serverSess.currentPauseStart;
      session.pauseHistory = serverSess.pauseHistory || [];
    }

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

    // Explicit action handling ALWAYS takes precedence
    if (event.type === 'ACTION_STOP') {
      lastUserControlActionTime = Date.now();
      session.isTracking = false;
      session.isPaused = false;
      session.stoppedAt = event.timestamp || (event.session && event.session.stoppedAt) || Date.now();
      session.currentPauseStart = null;
      renderControls();
      updateHudUI();
      saveSession();
    } else if (event.type === 'ACTION_PAUSE') {
      lastUserControlActionTime = Date.now();
      session.isPaused = true;
      session.currentPauseStart = event.timestamp || (event.session && event.session.currentPauseStart) || Date.now();
      renderControls();
      updateHudUI();
      saveSession();
    } else if (event.type === 'ACTION_RESUME') {
      lastUserControlActionTime = Date.now();
      session.isTracking = true;
      session.isPaused = false;
      session.stoppedAt = null;
      session.currentPauseStart = null;
      lastTickTime = Date.now();
      renderControls();
      updateHudUI();
      saveSession();
    } else if (event.type === 'ACTION_START') {
      lastUserControlActionTime = Date.now();
      session.isTracking = true;
      session.isPaused = false;
      session.currentPauseStart = null;
      session.stoppedAt = null;
      lastTickTime = Date.now();
      renderControls();
      updateHudUI();
      saveSession();
    } else if (event.type === 'ACTION_RESET') {
      lastUserControlActionTime = Date.now();
      session = {
        sessionId: event.session?.sessionId || ('session_' + Date.now()),
        meetingCode: event.session?.meetingCode || extractMeetingCode(),
        meetingTitle: 'Cockroach Library 12-Hour Study Marathon',
        startedAt: null,
        stoppedAt: null,
        lastUpdated: Date.now(),
        isTracking: false,
        isPaused: false,
        totalPausedMs: 0,
        currentPauseStart: null,
        pauseHistory: [],
        targetDurationHours: config.targetHours || 12,
        participants: {}
      };
      deletedParticipants.clear();
      renderControls();
      updateHudUI();
      saveSession();
      console.log('[Cockroach Tracker] 🔄 ACTION_RESET received from server. All participants cleared.');
      return;
    } else if (event.type === 'PARTICIPANT_DELETED') {
      const pid = event.participantId;
      if (pid) deletedParticipants.add(pid.toLowerCase());
      if (event.participantName) deletedParticipants.add(event.participantName.toLowerCase());
      if (session.participants && session.participants[pid]) {
        delete session.participants[pid];
      }
      renderControls();
      updateHudUI();
      saveSession();
    }

    if (event.session) {
      adoptServerSession(event.session, true);
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
                <button class="cm-def-del" data-id="${escapeHtml(d.id)}" data-name="${escapeHtml(d.name)}" title="Delete ${escapeHtml(d.name)} from attendance">🗑️</button>
              </div>
            `;
          }).join('');

          defListEl.querySelectorAll('.cm-def-del').forEach(btn => {
            btn.onclick = (e) => {
              e.stopPropagation();
              const pid = btn.getAttribute('data-id');
              const pname = btn.getAttribute('data-name');
              if (confirm(`Are you sure you want to delete "${pname}" from attendance?`)) {
                deleteParticipant(pid, pname);
              }
            };
          });
        }
      }
    }
  }

  // ================= TICK ENGINE (WEB WORKER + VISIBILITY CATCHUP) =================
  let tickWorker = null;
  function startTickEngine() {
    if (tickTimer) clearInterval(tickTimer);
    if (tickWorker) {
      try { tickWorker.terminate(); } catch (_) {}
      tickWorker = null;
    }

    try {
      const blobCode = `
        let timer = null;
        self.onmessage = function(e) {
          if (e.data === 'start') {
            if (timer) clearInterval(timer);
            timer = setInterval(() => self.postMessage('tick'), 1000);
          } else if (e.data === 'stop') {
            if (timer) clearInterval(timer);
            timer = null;
          }
        };
      `;
      const blob = new Blob([blobCode], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);
      tickWorker = new Worker(workerUrl);
      tickWorker.onmessage = function(e) {
        if (e.data === 'tick') {
          onTimerTick();
        }
      };
      tickWorker.postMessage('start');
      console.log('[Cockroach Tracker] ⚡ Background-resistant Web Worker timer active');
    } catch (err) {
      console.warn('[Cockroach Tracker] Worker fallback to setInterval', err);
      tickTimer = setInterval(onTimerTick, 1000);
    }

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        onTimerTick();
        renderControls();
        updateHudUI();
      }
    });
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

    let timersStarted = false;
    function startEnginesOnce() {
      if (timersStarted) return;
      timersStarted = true;
      mountHUD();
      renderControls();
      updateHudUI();
      if (tickTimer) clearInterval(tickTimer);
      tickTimer = setInterval(onTimerTick, 1000);
      if (syncTimer) clearInterval(syncTimer);
      syncTimer = setInterval(syncSessionNow, config.syncIntervalMs);
    }

    chrome.runtime.sendMessage({
      type: 'GET_SERVER_SESSION',
      serverUrl: getServerBaseUrl()
    }, (resp) => {
      const _ignored = chrome.runtime.lastError;
      if (resp && resp.success && resp.session) {
        adoptServerSession(resp.session, true);
        console.log('[Cockroach Tracker] Hydrated master session from server:', session.sessionId);
      }
      startEnginesOnce();
    });

    // Fallback in case of network lag: start engines after 1200ms
    setTimeout(startEnginesOnce, 1200);

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
