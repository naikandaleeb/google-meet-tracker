// Pain / Akatsuki Themed PDF Report Generator for Cockroach Library
// 12-Hour Study Marathon Attendance & Strict Camera Deduction Dossier

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
            durationFormatted: `${Math.floor(liveCutMs / 60000)}m ${Math.floor((liveCutMs % 60000) / 1000)}s`
          });
        }
      }
    }
  }

  let camOn = p.cameraOnMs !== undefined ? p.cameraOnMs : (p.validStudyMs !== undefined ? p.validStudyMs : (p.duration || 0));
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

  const validStudy = camOn;
  const totalInMeet = calculateTotalInMeetMs(p, now);

  p.cameraOnMs = camOn;
  p.cameraOffMs = camOff;
  p.totalPresentMs = totMeet;
  p.validStudyMs = validStudy;
  p.totalInMeetMs = totalInMeet;

  p.totalDuration = totMeet;
  p.duration = validStudy;
  p.timeInCall = totalInMeet;
  p.durationSeconds = Math.floor(validStudy / 1000);
  p.durationMinutes = Math.floor(validStudy / 60000);
  p.studyDuration = validStudy;

  return p;
}

function cleanParticipantName(raw, isLocal = false) {
  if (!raw || typeof raw !== 'string') return isLocal ? 'Host (You)' : null;
  let s = String(raw).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!s) return isLocal ? 'Host (You)' : null;

  // 1. Strip Google Meet Material Icon ligatures
  s = s.replace(/\b(?:keep_outline|more_vert|mic_off|push_pin|volume_up|more_horiz|videocam_off|screen_share|closed_caption|hand_raise|call_end)\b/gi, '').trim();

  // 2. Extract clean name from Pin/Unpin action strings (English & Hindi)
  const pinMatchEn = s.match(/(?:Pin|Unpin)\s+(.+?)\s+(?:to|from)\s+(?:your\s+)?(?:main\s+)?screen/i);
  if (pinMatchEn) s = pinMatchEn[1].trim();
  const pinMatchHi = s.match(/(.+?)\s+को\s+(?:अपनी\s+)?(?:मुख्य\s+)?स्क्रीन\s+पर\s+(?:पिन|अनपिन)\s+करें/i);
  if (pinMatchHi) s = pinMatchHi[1].trim();
  s = s.replace(/^(?:Pin|Unpin)\s+/i, '').trim();

  // 3. Strip Video/Feed descriptions commonly found in Google Meet tile aria-labels
  s = s.replace(/^(?:video\s+feed\s+from|video\s+feed\s+of|video\s+from|video\s+of|video\s+for|feed\s+from)\s+/gi, '').trim();
  s = s.replace(/\s*(?:'s\s+video\s+feed|'s\s+video|'s\s+feed|video\s+feed|video)\s*$/gi, '').trim();
  s = s.replace(/'s\s*$/i, '').trim();

  // 4. Strip status suffixes (common in tile aria-labels and People panel)
  s = s.replace(/,\s*(?:speaking|microphone\s+is\s+muted|microphone\s+muted|mic\s+off|mic\s+on|muted|unmuted|video\s+off|video\s+on|camera\s+off|camera\s+on|meeting\s+host|meeting\s+co-host|host|co-host|you)\s*$/gi, '').trim();
  s = s.replace(/\s*\((?:speaking|muted|unmuted|mic\s+off|mic\s+on|video\s+off|video\s+on|camera\s+off|camera\s+on)\)\s*$/gi, '').trim();

  // 5. Check if local user
  const isYou = /\((?:You)\)/i.test(s) || isLocal || s.toLowerCase() === 'you' || s.toLowerCase() === 'host (you)';

  // 6. Strip multi-device qualifiers and duplicate numbers:
  s = s.replace(/\s*[\(\[]\s*(?:\d+|you|host|meeting\s+host|meeting\s+co-host|co-host|presentation|external|call|phone|mobile|laptop|desktop|tablet|guest|audio|mic|webcam|cam|secondary|device\s*\d*)\s*[\)\]]/gi, '').trim();
  s = s.replace(/\s*-\s*\d+$/i, '').trim();
  s = s.replace(/\s*#\s*\d+$/i, '').trim();
  s = s.replace(/\s+\d+$/i, '').trim();

  // 7. Strip presentation suffixes
  s = s.replace(/\s+is\s+presenting$/i, '').trim();
  s = s.replace(/^presentation\s*(?:from|of|by)?\s*[:\-]?\s*/i, '').trim();
  s = s.replace(/'s\s+presentation$/i, '').trim();

  // 8. Strip unclosed opening parentheses/brackets at the end
  s = s.replace(/\s*[\(\[\{][^\)\]\}]*$/g, '').trim();

  // 9. Strip trailing ellipsis / dots (Google Meet truncation: e.g. "Mohammad Rizwan…" or "Mohammad Rizwan...")
  s = s.replace(/[\u2026\.]+\s*$/, '').trim();

  // 10. Strip leading/trailing punctuation and symbols
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
    'return to call', 'ask to join', 'jump to call', 'camera failed', 'poor connection'
  ];

  for (const bad of BLACKLIST) {
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

  if (lower === 'host' || lower === 'you' || lower === 'host (you)') {
    return isYou ? 'Host (You)' : 'Host';
  }

  // 11. Format to clean Title Case
  const isAllUpper = (s === s.toUpperCase());
  const isAllLower = (s === s.toLowerCase());
  if (isAllUpper || isAllLower) {
    s = s.split(' ').map(w => w ? (w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()) : '').join(' ').trim();
  }

  return s;
}

function consolidateParticipantsForReport(rawList, session = {}) {
  const now = Date.now();
  const map = new Map();
  rawList.forEach(p => {
    if (!p || !p.name) return;
    const isLocal = p.isLocal || p.id === 'local_host' || (p.name && p.name.toLowerCase().includes('host'));
    const validName = cleanParticipantName(p.name, isLocal);
    if (!validName) return;

    const stableKey = isLocal ? 'local_host' : ('p_' + validName.toLowerCase().replace(/[^a-z0-9]/g, '_'));
    const existing = map.get(stableKey);

    if (existing) {
      // DUAL DEVICE MERGE: Consolidate into single row with Camera ON taking precedence!
      const isCamOn = (p.cameraStatus === 'on' || existing.cameraStatus === 'on');
      const maxOn = Math.max(p.cameraOnMs || 0, existing.cameraOnMs || 0, p.validStudyMs || 0, existing.validStudyMs || 0);
      const maxOff = Math.max(p.cameraOffMs || 0, existing.cameraOffMs || 0);
      const isPres = (p.currentStatus === 'present' || existing.currentStatus === 'present');
      const joinTs = Math.min(toEpochMs(p.joinTime) || now, toEpochMs(existing.joinTime) || now, toEpochMs(p.firstSeen) || now, toEpochMs(existing.firstSeen) || now);

      map.set(stableKey, {
        ...existing,
        ...p,
        id: stableKey,
        name: validName,
        isLocal: isLocal,
        isHost: isLocal,
        isExempt: isLocal,
        currentStatus: isPres ? 'present' : (p.currentStatus || existing.currentStatus),
        cameraStatus: isCamOn ? 'on' : 'off',
        rawCameraStatus: isCamOn ? 'on' : 'off',
        cameraOnMs: maxOn,
        cameraOffMs: maxOff,
        validStudyMs: maxOn,
        totalPresentMs: Math.max(existing.totalPresentMs || 0, p.totalPresentMs || 0, maxOn + maxOff),
        firstSeen: joinTs,
        joinTime: joinTs,
        lastSeen: Math.max(toEpochMs(p.lastSeen) || now, toEpochMs(existing.lastSeen) || now),
        rejoinCount: Math.max(p.rejoinCount || 0, existing.rejoinCount || 0),
        cameraOffIntervals: [...(existing.cameraOffIntervals || []), ...(p.cameraOffIntervals || [])],
        presenceIntervals: [...(existing.presenceIntervals || []), ...(p.presenceIntervals || [])],
        joinLeaveHistory: [...(existing.joinLeaveHistory || []), ...(p.joinLeaveHistory || [])]
      });
    } else {
      map.set(stableKey, {
        ...p,
        id: stableKey,
        name: validName,
        isLocal: isLocal,
        isHost: isLocal,
        isExempt: isLocal
      });
    }
  });
  return Array.from(map.values());
}

function generatePainThemeHtml(session) {
  const now = Date.now();
  const rawParticipants = consolidateParticipantsForReport(Object.values(session.participants || {}), session);
  
  // Identify Host
  const hostParticipant = rawParticipants.find(p => p.isLocal || p.id === 'local_host' || (p.name && p.name.toLowerCase().includes('host')));
  if (hostParticipant) {
    finalizeParticipant(hostParticipant, session, now);
    hostParticipant.isExempt = true;
  }

  // Filter students (Host is exempt from rankings & defaulter lists)
  const participants = rawParticipants.filter(p => {
    if (!p || !p.name) return false;
    const lower = p.name.toLowerCase();
    if (lower.includes('keep_outline') || lower.includes('turn off') || lower === 'host' || lower === 'pin' || lower === 'unpin') return false;
    if (p.isLocal || p.id === 'local_host' || lower === 'host' || lower === 'host (you)') return false;
    return true;
  });

  participants.forEach(p => finalizeParticipant(p, session, now));

  const formatHms = (ms = 0) => {
    const sec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const formatIst = (ts) => {
    if (!ts) return 'N/A';
    return new Date(ts).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  };

  const formatTimeOnly = (ts) => {
    if (!ts) return '--:--';
    return new Date(ts).toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  };

  // Compute active study time:
  // If session is finalized/stopped, freeze at stoppedAt; otherwise calculate to now
  let totalElapsed = 0;
  if (session.startedAt) {
    const end = session.stoppedAt || session.lastUpdated || now;
    totalElapsed = Math.max(0, end - session.startedAt);
  }
  const totalPaused = session.totalPausedMs || 0;
  const activeStudyMs = Math.max(0, totalElapsed - totalPaused);
  const targetMs = (session.targetDurationHours || 12) * 3600 * 1000;
  const progressPercent = Math.min(100, (activeStudyMs / targetMs) * 100);

  // Overall camera compliance metrics
  let totalPresenceMs = 0;
  let totalCamOnMs = 0;
  let totalDeductedMs = 0;

  participants.forEach(p => {
    const camOn = p.cameraOnMs || 0;
    const totMeet = Math.max(p.totalPresentMs || 0, camOn);
    const camOff = Math.max(0, totMeet - camOn);
    totalPresenceMs += totMeet;
    totalCamOnMs += camOn;
    totalDeductedMs += camOff;
  });

  const overallCompliance = totalPresenceMs > 0 ? ((totalCamOnMs / totalPresenceMs) * 100).toFixed(1) : '0.0';

  // Compliance tiers
  let eliteCount = 0;
  let warningCount = 0;
  let defaulterCount = 0;

  participants.forEach(p => {
    const tot = p.totalPresentMs || 0;
    const on = p.cameraOnMs || 0;
    const comp = tot > 0 ? (on / tot) * 100 : 0;
    if (comp >= 90) eliteCount++;
    else if (comp >= 75) warningCount++;
    else defaulterCount++;
  });

  // SORT STRICTLY BY VALID STUDY TIME (CAMERA ON TIME) DESCENDING!
  // Top student with highest Camera ON time is RANK 1!
  const sorted = [...participants].sort((a, b) => {
    const onDiff = (b.cameraOnMs || 0) - (a.cameraOnMs || 0);
    if (onDiff !== 0) return onDiff;
    return (b.totalPresentMs || 0) - (a.totalPresentMs || 0);
  });

  // Generate Table Rows HTML
  const rowsHtml = sorted.map((p, idx) => {
    const camOn = p.cameraOnMs || 0;
    const totMeet = Math.max(p.totalPresentMs || 0, camOn);
    const camOff = p.cameraOffMs || Math.max(0, totMeet - camOn);
    const comp = totMeet > 0 ? ((camOn / totMeet) * 100).toFixed(1) : '0.0';
    const isCamOn = p.cameraStatus === 'on';
    const isPresent = p.currentStatus === 'present';
    const numComp = parseFloat(comp);

    // Rank Badges
    let rankBadgeHtml = `<span class="rank-num">#${idx + 1}</span>`;
    let rankRowClass = '';
    if (idx === 0 && camOn > 0) {
      rankBadgeHtml = `<span class="rank-crown" title="RANK 1 - Maximum Valid Study Time!">👑 #1</span>`;
      rankRowClass = 'row-rank-1';
    } else if (idx === 1 && camOn > 0) {
      rankBadgeHtml = `<span class="rank-medal silver">🥈 #2</span>`;
    } else if (idx === 2 && camOn > 0) {
      rankBadgeHtml = `<span class="rank-medal bronze">🥉 #3</span>`;
    }

    // Classification
    let badgeClass = 'badge-elite';
    let badgeLabel = 'ELITE FOCUS';
    if (numComp < 75 || (p.consecutiveCamOffMs || 0) > 300000 || camOff > 1800000) {
      badgeClass = 'badge-defaulter';
      badgeLabel = 'DEFAULTER';
    } else if (numComp < 90) {
      badgeClass = 'badge-warning';
      badgeLabel = 'AVERAGE';
    }

    // Build Detailed Camera OFF Breakdown intervals
    const offIntervals = p.cameraOffIntervals || [];
    let intervalsHtml = '';
    if (offIntervals.length > 0) {
      intervalsHtml = `
        <div class="off-intervals-list">
          ${offIntervals.map(int => {
            const from = int.fromTime || formatTimeOnly(int.start);
            const to = int.toTime || (int.end ? formatTimeOnly(int.end) : 'Present');
            const dur = int.durationFormatted || formatHms(int.durationMs || 0);
            return `<div class="off-interval-item"><span class="off-dot">🔴</span> <strong>${escapeHtml(from)} - ${escapeHtml(to)}</strong> <span class="cut-tag">(-${escapeHtml(dur)} cut)</span></div>`;
          }).join('')}
        </div>
      `;
    } else if (camOff > 0) {
      intervalsHtml = `<div class="off-single-cut"><span class="off-dot">🔴</span> Camera OFF Time: -${formatHms(camOff)} deducted</div>`;
    } else {
      intervalsHtml = `<div class="off-perfect"><span class="green-dot">🟢</span> 100% Cam ON &bull; 0m Cut</div>`;
    }

    const initials = (p.name || 'U').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

    return `
      <tr class="${rankRowClass}">
        <td class="col-rank">${rankBadgeHtml}</td>
        <td>
          <div class="student-cell">
            <div class="student-avatar">${initials}</div>
            <div class="student-info">
              <span class="student-name">${escapeHtml(p.name)}</span>
              ${p.isLocal ? '<span class="tag-host">HOST</span>' : ''}
              ${idx === 0 && camOn > 0 ? '<span class="tag-champion">AKATSUKI CHAMPION</span>' : ''}
              ${p.manualCamOverride ? '<span class="badge" style="background: rgba(59, 130, 246, 0.2); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.4); font-size: 8px; padding: 1px 4px; border-radius: 4px; margin-left: 4px;">📷 MANUAL ON</span>' : ''}
              ${(p.rejoinCount || 0) > 0 ? `<span class="badge" style="background: rgba(167, 139, 250, 0.2); color: #c4b5fd; border: 1px solid rgba(167, 139, 250, 0.4); font-size: 9px; padding: 1px 4px; border-radius: 4px; margin-left: 4px;">🔄 ${p.rejoinCount} Rejoin${p.rejoinCount > 1 ? 's' : ''}</span>` : ''}
            </div>
          </div>
        </td>
        <td>
          <span class="status-pill ${isPresent ? 'pill-present' : 'pill-left'}">
            ${isPresent ? '🟢 Present' : `⚪ Left ${p.leaveTime ? `(${formatTimeOnly(p.leaveTime)})` : ''}`}
          </span>
        </td>
        <td>
          <span class="status-pill ${isCamOn ? (p.videoDetectionMode === 'poster' ? 'pill-cam-on' : 'pill-cam-on') : 'pill-cam-off'}">
            ${p.videoDetectionMode === 'poster' ? '☕ Poster ON' : (isCamOn ? '📹 ON' : '📷 OFF')}
          </span>
        </td>
        <td class="col-valid-time font-mono">
          <div class="valid-box">
            <span class="valid-val font-bold text-emerald">${formatHms(camOn)}</span>
            <span class="valid-sub">COUNTED STUDY</span>
          </div>
        </td>
        <td class="col-cut-time font-mono">
          <div class="cut-box">
            <span class="cut-val font-bold text-crimson">-${formatHms(camOff)}</span>
            <span class="cut-sub">DEDUCTED</span>
          </div>
        </td>
        
        <td>
          <div class="comp-wrap">
            <span class="font-mono font-bold comp-num">${comp}%</span>
            <div class="comp-bar-bg">
              <div class="comp-bar-fill" style="width: ${comp}%; background: ${numComp >= 90 ? '#00ff88' : (numComp >= 75 ? '#ffb800' : '#ff2a4b')};"></div>
            </div>
          </div>
        </td>
        <td class="col-breakdown">
          ${intervalsHtml}
        </td>
        <td><span class="compliance-badge ${badgeClass}">${badgeLabel}</span></td>
      </tr>
    `;
  }).join('');

  // Breaks rows HTML
  const breaks = session.pauseHistory || [];
  const breaksHtml = breaks.length > 0 ? breaks.map((b, i) => `
    <tr>
      <td class="font-mono text-dim">Official Break #${i + 1}</td>
      <td class="font-mono">${formatIst(b.pausedAt)}</td>
      <td class="font-mono">${b.resumedAt ? formatIst(b.resumedAt) : 'In Progress'}</td>
      <td class="font-mono text-amber font-bold">${formatHms(b.durationMs)}</td>
      <td><span class="status-pill pill-present">Verified Halt</span></td>
    </tr>
  `).join('') : `<tr><td colspan="5" class="text-center text-dim py-4">No marathon pause breaks recorded during this session.</td></tr>`;

  // Gantt Chart Rows
  const targetHours = session.targetDurationHours || 12;
  const sessionTotalWindowMs = targetHours * 3600 * 1000;
  const sessionStart = toEpochMs(session.startedAt) || now;

  const ganttRowsHtml = sorted.slice(0, 15).map(p => {
    const intervals = p.cameraIntervals || [];
    let segments = '';
    intervals.forEach(int => {
      const intStartMs = toEpochMs(int.start) || sessionStart;
      const intEndMs = toEpochMs(int.end) || now;
      const s = Math.max(0, intStartMs - sessionStart);
      const e = Math.min(sessionTotalWindowMs, intEndMs - sessionStart);
      if (e > s) {
        const l = ((s / sessionTotalWindowMs) * 100).toFixed(2);
        const w = (((e - s) / sessionTotalWindowMs) * 100).toFixed(2);
        segments += `<div class="gantt-seg ${int.state === 'on' ? 'gantt-cam-on' : 'gantt-cam-off'}" style="left:${l}%; width:${w}%;"></div>`;
      }
    });
    return `
      <div class="gantt-row">
        <div class="gantt-name">${escapeHtml(p.name)}</div>
        <div class="gantt-track">${segments}</div>
      </div>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Cockroach Library - 12H Pain Theme Attendance Dossier</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700;800&family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-void: #090a0f;
      --bg-surface: #12131d;
      --bg-card: #181a26;
      --border-subtle: #26293d;
      --border-bright: #3d4263;
      --accent-purple: #7c5cff;
      --accent-crimson: #ff2a4b;
      --accent-emerald: #00ff88;
      --accent-amber: #ffb800;
      --text-main: #f0f2fa;
      --text-muted: #8b92b2;
      --text-dim: #5c6282;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      background-color: var(--bg-void);
      color: var(--text-main);
      font-family: 'Outfit', -apple-system, sans-serif;
      padding: 30px;
      line-height: 1.4;
      -webkit-font-smoothing: antialiased;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

    /* Print action bar at top (hidden in printed document) */
    .no-print-bar {
      position: sticky;
      top: 0;
      z-index: 1000;
      background: rgba(18, 19, 29, 0.95);
      backdrop-filter: blur(12px);
      border: 1px solid var(--accent-purple);
      border-radius: 12px;
      padding: 12px 24px;
      margin-bottom: 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
    }
    .no-print-bar .btn-print {
      background: linear-gradient(135deg, var(--accent-crimson), #c0282d);
      color: #fff;
      border: none;
      padding: 10px 22px;
      border-radius: 8px;
      font-weight: 800;
      font-size: 13px;
      letter-spacing: 0.5px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 4px 16px rgba(255, 42, 75, 0.4);
      transition: all 0.2s;
    }
    .no-print-bar .btn-print:hover { transform: scale(1.03); }
    .no-print-bar .btn-secondary {
      background: var(--bg-card);
      border: 1px solid var(--border-bright);
      color: #fff;
      padding: 9px 18px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 12px;
      cursor: pointer;
      text-decoration: none;
    }

    /* Akatsuki Dossier Container */
    .report-dossier {
      max-width: 1400px;
      margin: 0 auto;
      background: var(--bg-surface);
      border: 2px solid var(--border-bright);
      border-radius: 18px;
      padding: 36px 40px;
      box-shadow: 0 16px 60px rgba(0, 0, 0, 0.7);
      position: relative;
      overflow: hidden;
    }

    .report-dossier::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 5px;
      background: linear-gradient(90deg, var(--accent-crimson), var(--accent-purple), var(--accent-emerald), var(--accent-crimson));
    }

    /* Concentric Rinnegan Rings Watermark Motif */
    .rinnegan-motif {
      position: absolute;
      top: -120px;
      right: -120px;
      width: 440px;
      height: 440px;
      border-radius: 50%;
      border: 1px solid rgba(124, 92, 255, 0.08);
      box-shadow: 
        0 0 0 30px rgba(124, 92, 255, 0.05),
        0 0 0 60px rgba(124, 92, 255, 0.04),
        0 0 0 90px rgba(124, 92, 255, 0.03),
        0 0 0 120px rgba(124, 92, 255, 0.02);
      pointer-events: none;
    }

    /* Header */
    .header-section {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid var(--border-subtle);
      padding-bottom: 24px;
      margin-bottom: 28px;
    }

    .brand-col {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .akatsuki-cloud-glyph {
      width: 56px;
      height: 56px;
      background: radial-gradient(circle, #ff2a4b, #8a0c20);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 0 24px rgba(255, 42, 75, 0.6);
      border: 2px solid #ff7a8b;
      font-size: 26px;
    }

    .brand-title-wrap h1 {
      font-family: 'Cinzel', serif;
      font-size: 26px;
      font-weight: 900;
      letter-spacing: 2px;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .akatsuki-tag {
      font-family: 'Outfit', sans-serif;
      font-size: 10px;
      font-weight: 800;
      background: rgba(255, 42, 75, 0.2);
      color: #ff6b7d;
      border: 1px solid #ff2a4b;
      padding: 3px 8px;
      border-radius: 6px;
      letter-spacing: 1px;
    }

    .brand-title-wrap p {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 4px;
      letter-spacing: 0.5px;
    }

    .header-meta {
      text-align: right;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .meta-code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 15px;
      font-weight: 800;
      color: var(--accent-purple);
      background: rgba(124, 92, 255, 0.1);
      padding: 4px 12px;
      border-radius: 6px;
      border: 1px solid rgba(124, 92, 255, 0.3);
      display: inline-block;
    }

    .meta-date {
      font-size: 11px;
      color: var(--text-muted);
    }

    .meta-badge-off {
      display: inline-block;
      font-size: 10px;
      font-weight: 800;
      color: #ffb800;
      background: rgba(255, 184, 0, 0.15);
      border: 1px solid rgba(255, 184, 0, 0.4);
      padding: 2px 8px;
      border-radius: 4px;
      margin-top: 4px;
    }

    /* Pain Epigraph Quote Banner */
    .pain-quote-banner {
      background: linear-gradient(90deg, rgba(255, 42, 75, 0.15), rgba(124, 92, 255, 0.15));
      border-left: 4px solid var(--accent-crimson);
      border-right: 4px solid var(--accent-purple);
      border-radius: 10px;
      padding: 14px 20px;
      margin-bottom: 28px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .pain-quote-text {
      font-family: 'Cinzel', serif;
      font-size: 13px;
      font-style: italic;
      color: #e2e5f5;
      letter-spacing: 0.5px;
    }

    .pain-attribution {
      font-size: 11px;
      font-weight: 800;
      color: var(--accent-crimson);
      letter-spacing: 1px;
      white-space: nowrap;
      margin-left: 16px;
    }

    /* Top KPI Cards */
    .kpi-row {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 16px;
      margin-bottom: 32px;
    }

    .kpi-card {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      padding: 16px;
      position: relative;
      overflow: hidden;
    }

    .kpi-card::after {
      content: '';
      position: absolute;
      top: 0; left: 0; width: 100%; height: 2px;
      background: var(--accent-purple);
    }

    .kpi-card.kpi-crimson::after { background: var(--accent-crimson); }
    .kpi-card.kpi-emerald::after { background: var(--accent-emerald); }
    .kpi-card.kpi-amber::after { background: var(--accent-amber); }

    .kpi-tag {
      font-size: 9px;
      font-weight: 800;
      letter-spacing: 0.8px;
      color: var(--text-muted);
      text-transform: uppercase;
      margin-bottom: 6px;
      display: block;
    }

    .kpi-val {
      font-family: 'JetBrains Mono', monospace;
      font-size: 22px;
      font-weight: 800;
      color: #fff;
      letter-spacing: 0.5px;
    }

    .kpi-sub {
      font-size: 10px;
      color: var(--text-dim);
      margin-top: 4px;
    }

    /* Core Rule Notice Box */
    .rule-notice {
      background: rgba(255, 42, 75, 0.08);
      border: 1px solid rgba(255, 42, 75, 0.35);
      border-radius: 10px;
      padding: 12px 18px;
      margin-bottom: 24px;
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 11px;
      color: #f0f2fa;
    }

    .rule-notice-icon { font-size: 20px; }

    /* Section Headings */
    .section-title-wrap {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 14px;
    }

    .section-title {
      font-family: 'Cinzel', serif;
      font-size: 16px;
      font-weight: 800;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 8px;
      letter-spacing: 1px;
    }

    .section-subtitle {
      font-size: 11px;
      color: var(--text-muted);
    }

    /* Data Table */
    .table-wrap {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 14px;
      overflow-x: auto;
      margin-bottom: 32px;
    }

    table.dossier-table {
      width: 100%;
      table-layout: fixed;
      border-collapse: collapse;
      text-align: left;
      font-size: 12px;
    }

    .col-th-rank { width: 5%; }
    .col-th-name { width: 21%; }
    .col-th-pres { width: 8%; }
    .col-th-cam { width: 7%; }
    .col-th-valid { width: 14%; }
    .col-th-cut { width: 11%; }
    .col-th-comp { width: 9%; }
    .col-th-breakdown { width: 18%; }
    .col-th-tier { width: 8%; }

    table.dossier-table thead th {
      background: rgba(10, 11, 18, 0.9);
      color: var(--text-muted);
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      padding: 10px 8px;
      border-bottom: 2px solid var(--border-bright);
      word-break: break-word;
      line-height: 1.25;
    }

    table.dossier-table tbody td {
      padding: 10px 8px;
      border-bottom: 1px solid var(--border-subtle);
      color: var(--text-main);
      vertical-align: middle;
      word-break: break-word;
    }

    table.dossier-table tbody tr:hover {
      background: rgba(255, 255, 255, 0.02);
    }

    /* Rank 1 Highlighting */
    table.dossier-table tbody tr.row-rank-1 {
      background: linear-gradient(90deg, rgba(255, 184, 0, 0.12), rgba(0, 255, 136, 0.06), transparent);
      border-left: 4px solid var(--accent-amber);
    }

    .rank-crown {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: linear-gradient(135deg, #ffd700, #ff9900);
      color: #000;
      font-weight: 900;
      font-size: 12px;
      padding: 3px 8px;
      border-radius: 6px;
      box-shadow: 0 0 12px rgba(255, 215, 0, 0.5);
    }

    .rank-medal {
      font-weight: 800;
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .rank-medal.silver { background: #c0c0c0; color: #000; }
    .rank-medal.bronze { background: #cd7f32; color: #000; }
    .rank-num { font-family: 'JetBrains Mono', monospace; color: var(--text-dim); font-weight: 700; }

    .student-cell {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .student-avatar {
      width: 30px;
      height: 30px;
      border-radius: 50%;
      background: linear-gradient(135deg, #7c5cff, #492bb2);
      color: #fff;
      font-weight: 800;
      font-size: 11px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid rgba(255, 255, 255, 0.15);
    }

    .student-name {
      font-weight: 700;
      color: #fff;
      font-size: 13px;
    }

    .tag-host {
      font-size: 8px;
      font-weight: 800;
      background: rgba(124, 92, 255, 0.3);
      color: #b7a4ff;
      border: 1px solid #7c5cff;
      padding: 1px 5px;
      border-radius: 4px;
      margin-left: 6px;
    }

    .tag-champion {
      font-size: 8px;
      font-weight: 800;
      background: rgba(255, 184, 0, 0.25);
      color: #ffd700;
      border: 1px solid #ffd700;
      padding: 1px 5px;
      border-radius: 4px;
      margin-left: 6px;
    }

    /* Valid Time & Cut Time Columns */
    .valid-box {
      display: flex;
      flex-direction: column;
    }
    .valid-val { font-size: 14px; color: var(--accent-emerald); }
    .valid-sub { font-size: 8px; color: var(--text-dim); text-transform: uppercase; font-weight: 700; }

    .cut-box {
      display: flex;
      flex-direction: column;
    }
    .cut-val { font-size: 13px; color: var(--accent-crimson); }
    .cut-sub { font-size: 8px; color: var(--text-dim); text-transform: uppercase; font-weight: 700; }

    /* Camera OFF Breakdown column */
    .col-breakdown {
      min-width: 220px;
      max-width: 320px;
    }

    .off-intervals-list {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .off-interval-item {
      font-size: 10px;
      font-family: 'JetBrains Mono', monospace;
      background: rgba(255, 42, 75, 0.08);
      border-left: 2px solid var(--accent-crimson);
      padding: 2px 6px;
      border-radius: 3px;
      color: #f0f2fa;
    }

    .off-dot { font-size: 8px; margin-right: 2px; }
    .cut-tag { color: #ff6b7d; font-weight: 800; margin-left: 4px; }

    .off-single-cut {
      font-size: 10px;
      font-family: 'JetBrains Mono', monospace;
      color: #ff6b7d;
      font-weight: 700;
    }

    .off-perfect {
      font-size: 10px;
      color: var(--accent-emerald);
      font-weight: 700;
    }

    /* Compliance meter */
    .comp-wrap {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .comp-num { font-size: 11px; min-width: 42px; text-align: right; }
    .comp-bar-bg {
      flex: 1;
      height: 6px;
      background: rgba(255, 255, 255, 0.08);
      border-radius: 3px;
      overflow: hidden;
      min-width: 60px;
    }
    .comp-bar-fill { height: 100%; border-radius: 3px; }

    /* Badges */
    .compliance-badge {
      font-size: 9px;
      font-weight: 800;
      letter-spacing: 0.5px;
      padding: 3px 8px;
      border-radius: 6px;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .badge-elite { background: rgba(0, 255, 136, 0.15); color: #00ff88; border: 1px solid rgba(0, 255, 136, 0.4); }
    .badge-warning { background: rgba(255, 184, 0, 0.15); color: #ffb800; border: 1px solid rgba(255, 184, 0, 0.4); }
    .badge-defaulter { background: rgba(255, 42, 75, 0.2); color: #ff4760; border: 1px solid #ff2a4b; }

    .status-pill {
      font-size: 10px;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 12px;
      white-space: nowrap;
    }
    .pill-present { background: rgba(0, 255, 136, 0.15); color: #00ff88; }
    .pill-left { background: rgba(255, 255, 255, 0.08); color: #8b92b2; }
    .pill-cam-on { background: rgba(0, 255, 136, 0.2); color: #00ff88; border: 1px solid rgba(0, 255, 136, 0.3); }
    .pill-cam-off { background: rgba(255, 42, 75, 0.2); color: #ff4760; border: 1px solid rgba(255, 42, 75, 0.4); }

    /* Gantt Visualizer */
    .gantt-wrap {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 32px;
    }

    .gantt-legend {
      display: flex;
      gap: 18px;
      font-size: 11px;
      color: var(--text-muted);
      margin-bottom: 12px;
    }
    .legend-item { display: flex; align-items: center; gap: 6px; }
    .legend-box { width: 14px; height: 10px; border-radius: 2px; }
    .legend-box.cam-on { background: var(--accent-emerald); }
    .legend-box.cam-off { background: var(--accent-crimson); }

    .gantt-row {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
    }
    .gantt-name {
      width: 140px;
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--text-main);
    }
    .gantt-track {
      flex: 1;
      height: 12px;
      background: rgba(255, 255, 255, 0.04);
      border-radius: 3px;
      position: relative;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.06);
    }
    .gantt-seg {
      position: absolute;
      top: 0; bottom: 0;
      border-radius: 2px;
    }
    .gantt-cam-on { background: var(--accent-emerald); opacity: 0.85; }
    .gantt-cam-off { background: var(--accent-crimson); opacity: 0.85; }

    /* Official Proctor Seal Footer */
    .report-footer {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      border-top: 2px solid var(--border-subtle);
      padding-top: 24px;
      margin-top: 32px;
    }

    .seal-wrap {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .akatsuki-seal {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      border: 2px dashed var(--accent-crimson);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      box-shadow: 0 0 16px rgba(255, 42, 75, 0.3);
      padding: 6px;
    }

    .seal-emblem { font-size: 20px; }
    .seal-text { font-size: 7px; font-weight: 900; color: #ff6b7d; letter-spacing: 0.8px; text-transform: uppercase; }

    .seal-info h4 {
      font-family: 'Cinzel', serif;
      font-size: 14px;
      color: #fff;
      font-weight: 800;
      letter-spacing: 1px;
    }
    .seal-info p {
      font-size: 11px;
      color: var(--text-muted);
      margin-top: 2px;
    }

    .signature-block {
      text-align: right;
    }

    .signature-line {
      width: 200px;
      border-bottom: 1px solid var(--border-bright);
      margin-bottom: 6px;
      display: inline-block;
    }

    .signature-title {
      font-size: 11px;
      font-weight: 700;
      color: var(--text-main);
    }

    .signature-sub {
      font-size: 9px;
      color: var(--text-dim);
    }

    /* Print Styles: Ultra-Strict A4 Landscape Fitting */
    @media print {
      * {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
        color-adjust: exact !important;
        box-sizing: border-box !important;
      }
      html, body {
        background: #090a0f !important;
        color: #f0f2fa !important;
        padding: 0 !important;
        margin: 0 !important;
        width: 100% !important;
      }
      .no-print-bar { display: none !important; }
      .report-dossier {
        border: none !important;
        box-shadow: none !important;
        padding: 4mm 6mm !important;
        max-width: 100% !important;
        width: 100% !important;
        background: #090a0f !important;
      }
      .table-wrap {
        border: 1px solid var(--border-subtle) !important;
        border-radius: 8px !important;
        overflow: visible !important;
        margin-bottom: 16px !important;
        width: 100% !important;
      }
      .dossier-table {
        table-layout: fixed !important;
        width: 100% !important;
        font-size: 8px !important;
        page-break-inside: auto;
      }
      .dossier-table thead {
        display: table-header-group !important;
      }
      .dossier-table tr {
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }
      .dossier-table th {
        background: #181a26 !important;
        color: #f0f2fa !important;
        border-color: #3d4263 !important;
        padding: 4px 3px !important;
        font-size: 7px !important;
        white-space: normal !important;
        word-break: break-word !important;
        line-height: 1.15 !important;
      }
      .dossier-table td {
        border-color: #26293d !important;
        padding: 3px 2px !important;
        font-size: 8px !important;
        word-break: break-word !important;
        white-space: normal !important;
        vertical-align: middle !important;
      }
      .student-cell {
        gap: 4px !important;
      }
      .student-avatar {
        width: 18px !important;
        height: 18px !important;
        font-size: 7px !important;
        min-width: 18px !important;
      }
      .student-name {
        font-size: 8.5px !important;
        white-space: normal !important;
        word-break: break-word !important;
      }
      .col-breakdown {
        min-width: 0 !important;
        max-width: 100% !important;
        font-size: 7.5px !important;
      }
      .off-interval-item {
        font-size: 7px !important;
        padding: 1px 2px !important;
        line-height: 1.15 !important;
      }
      .valid-val, .cut-val {
        font-size: 8.5px !important;
      }
      .valid-sub, .cut-sub {
        font-size: 6px !important;
      }
      .comp-wrap {
        gap: 2px !important;
      }
      .comp-num {
        font-size: 7.5px !important;
        min-width: 24px !important;
      }
      .comp-bar-bg {
        min-width: 24px !important;
        height: 4px !important;
      }
      .status-pill, .compliance-badge {
        font-size: 7px !important;
        padding: 1px 3px !important;
      }
      .kpi-row {
        gap: 6px !important;
        margin-bottom: 12px !important;
      }
      .kpi-card {
        padding: 6px 8px !important;
      }
      .kpi-val {
        font-size: 13px !important;
      }
      .kpi-tag {
        font-size: 7px !important;
        margin-bottom: 2px !important;
      }
      .kpi-sub {
        font-size: 7px !important;
      }
      .pain-quote-banner {
        padding: 6px 12px !important;
        margin-bottom: 12px !important;
      }
      .header-section {
        padding-bottom: 10px !important;
        margin-bottom: 12px !important;
      }
      .gantt-wrap {
        padding: 8px !important;
        margin-bottom: 14px !important;
      }
      .gantt-name {
        width: 70px !important;
        font-size: 7.5px !important;
      }
      .gantt-track {
        height: 6px !important;
      }
      .report-footer {
        padding-top: 8px !important;
        margin-top: 12px !important;
      }
      .akatsuki-seal {
        width: 44px !important;
        height: 44px !important;
      }
      @page {
        size: A4 landscape;
        margin: 4mm 5mm;
      }
    }
  </style>
</head>
<body>

  <!-- Screen Top Bar with Print Button -->
  <div class="no-print-bar">
    <div>
      <strong style="color: #fff; font-size: 14px;">🪳 Cockroach Library Dossier [Pain Sanctuary Engine]</strong>
      <span style="color: var(--text-muted); font-size: 12px; margin-left: 12px;">Port 4200 Verified &bull; Strict Camera Deduction Enforced</span>
    </div>
    <div style="display: flex; gap: 10px;">
      <a href="/" class="btn-secondary">← Back to Dashboard</a>
      <button class="btn-print" onclick="window.print()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
        <span>Print Pain Dossier (PDF)</span>
      </button>
    </div>
  </div>

  <div class="report-dossier">
    <div class="rinnegan-motif"></div>

    <!-- Header -->
    <header class="header-section">
      <div class="brand-col">
        <div class="akatsuki-cloud-glyph">🪳</div>
        <div class="brand-title-wrap">
          <h1>
            COCKROACH LIBRARY
            <span class="akatsuki-tag">PAIN THEME DOSSIER</span>
          </h1>
          <p>12-HOUR VIRTUAL STUDY MARATHON &bull; ATTENDANCE & CAMERA SURVEILLANCE REPORT</p>
        </div>
      </div>
      <div class="header-meta">
        <div><span class="meta-code">MEET: ${escapeHtml(session.meetingCode || 'cockroach-study-room')}</span></div>
        <div class="meta-date">Generated: ${formatIst(now)}</div>
        <div>
          <span class="meta-badge-off">
            ${session.stoppedAt ? '⏹️ ATTENDANCE FINALIZED (OFF)' : (session.isTracking ? '🟢 ATTENDANCE ACTIVE' : '⏹️ ATTENDANCE OFF')}
          </span>
        </div>
      </div>
    </header>

    <!-- Pain Theme Quote Banner -->
    <div class="pain-quote-banner">
      <div class="pain-quote-text">
        "Those who do not understand true discipline will never understand true peace. Through intense focus, true excellence is born."
      </div>
      <div class="pain-attribution">— PAIN (AKATSUKI)</div>
    </div>

    <!-- Core Rule Notice -->
    <div class="rule-notice">
      <span class="rule-notice-icon">⚖️</span>
      <div>
        <strong>STRICT ATTENDANCE LAW:</strong> Camera OFF duration is <strong>strictly deducted</strong> from meeting presence. 
        Only <strong>Camera ON Time</strong> counts towards official Valid Study Time. 
        The student with maximum Camera ON time is awarded <strong>👑 Rank #1</strong>.
      </div>
    </div>

    <!-- Top KPI Row -->
    <div class="kpi-row">
      <div class="kpi-card kpi-crimson">
        <span class="kpi-tag">12H Marathon Study Time</span>
        <div class="kpi-val">${formatHms(activeStudyMs)}</div>
        <div class="kpi-sub">${progressPercent.toFixed(1)}% of 12h goal achieved</div>
      </div>
      <div class="kpi-card kpi-emerald">
        <span class="kpi-tag">Total Camera ON (Net)</span>
        <div class="kpi-val text-emerald">${formatHms(totalCamOnMs)}</div>
        <div class="kpi-sub">Total valid study hours logged</div>
      </div>
      <div class="kpi-card kpi-crimson">
        <span class="kpi-tag">Total Camera OFF Cut</span>
        <div class="kpi-val text-crimson">-${formatHms(totalDeductedMs)}</div>
        <div class="kpi-sub">Time deducted from students</div>
      </div>
      <div class="kpi-card">
        <span class="kpi-tag">Verified Students</span>
        <div class="kpi-val">${participants.length}</div>
        <div class="kpi-sub">Elite: ${eliteCount} &bull; Defaulters: ${defaulterCount}</div>
      </div>
      <div class="kpi-card kpi-amber">
        <span class="kpi-tag">Compliance Rate</span>
        <div class="kpi-val">${overallCompliance}%</div>
        <div class="kpi-sub">Camera ON ratio</div>
      </div>
    </div>

    <!-- Attendees Table -->
    <div class="section-title-wrap">
      <div class="section-title">
        <span>📋 VERIFIED PARTICIPANT ATTENDANCE & CAMERA RANKINGS</span>
      </div>
      <div class="section-subtitle">Ranked strictly by Valid Study Time (Camera ON Time) Descending</div>
    </div>

    <div class="table-wrap">
      <table class="dossier-table">
        <thead>
          <tr>
            <th class="col-th-rank">Rank</th>
            <th class="col-th-name">Student Name</th>
            <th class="col-th-pres">Presence</th>
            <th class="col-th-cam">Camera</th>
            <th class="col-th-valid" style="color: var(--accent-emerald);">Net Valid Study Time (Cam ON)</th>
            <th class="col-th-cut" style="color: var(--accent-crimson);">Cut Time (Cam OFF)</th>
            <th class="col-th-comp">Compliance</th>
            <th class="col-th-breakdown">Camera OFF Breakdown (Exact Intervals Deducted)</th>
            <th class="col-th-tier">Focus Tier</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml || '<tr><td colspan="9" style="text-align: center; padding: 24px;">No participants recorded.</td></tr>'}
        </tbody>
      </table>
    </div>

    <!-- Visual 12-Hour Timeline (Gantt) -->
    <div class="section-title-wrap">
      <div class="section-title">
        <span>📊 12-HOUR VISUAL CAMERA TIMELINE</span>
      </div>
      <div class="gantt-legend">
        <span class="legend-item"><span class="legend-box cam-on"></span> Camera ON (Study Verified)</span>
        <span class="legend-item"><span class="legend-box cam-off"></span> Camera OFF (Deducted Break)</span>
      </div>
    </div>
    <div class="gantt-wrap">
      ${ganttRowsHtml || '<div style="color: var(--text-dim); text-align: center; padding: 12px;">No interval data available.</div>'}
    </div>

    <!-- Official Verified Breaks -->
    <div class="section-title-wrap">
      <div class="section-title">
        <span>⏸️ OFFICIAL VERIFIED MARATHON BREAKS</span>
      </div>
      <div class="section-subtitle">Recorded session pause intervals</div>
    </div>
    <div class="table-wrap" style="margin-bottom: 24px;">
      <table class="dossier-table">
        <thead>
          <tr>
            <th>Break ID</th>
            <th>Halted At (IST)</th>
            <th>Resumed At (IST)</th>
            <th>Break Duration</th>
            <th>Verification</th>
          </tr>
        </thead>
        <tbody>
          ${breaksHtml}
        </tbody>
      </table>
    </div>

    <!-- Footer & Seal -->
    <footer class="report-footer">
      <div class="seal-wrap">
        <div class="akatsuki-seal">
          <span class="seal-emblem">🪳</span>
          <span class="seal-text">COCKROACH SEAL</span>
        </div>
        <div class="seal-info">
          <h4>COCKROACH LIBRARY PROCTOR SANCTUARY</h4>
          <p>Official 12-Hour Study Marathon Verification Seal &bull; Automated Attendance Audit</p>
          <p style="font-size: 9px; color: var(--text-dim); margin-top: 2px;">Session ID: ${escapeHtml(session.sessionId)} &bull; Port 4200 Engine</p>
        </div>
      </div>
      <div class="signature-block">
        <div class="signature-line"></div>
        <div class="signature-title">Proctor Surveillance Authority</div>
        <div class="signature-sub">Cockroach Library Virtual Proctor</div>
      </div>
    </footer>
  </div>

</body>
</html>`;
}

module.exports = {
  generatePainThemeHtml
};
