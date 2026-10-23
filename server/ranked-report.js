// Ranked Attendance Report Generator (Clean Mint Green Landscape Theme)
// Exactly matching the user's specification with Leaderboard Podium, Landscape A4, and Neat Non-Jumbled Data

function escapeHtml(str = '') {
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[m]);
}

function formatHms(ms = 0) {
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
            durationFormatted: formatHms(liveCutMs)
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

function computeDenseRanks(participants, session = {}) {
  const now = Date.now();
  participants.forEach(p => finalizeParticipant(p, session, now));

  // Sort descending by valid study time (camera ON time), fallback to totalPresentMs
  participants.sort((a, b) => {
    const timeA = a.validStudyMs !== undefined ? a.validStudyMs : (a.cameraOnMs !== undefined ? a.cameraOnMs : (a.duration || 0));
    const timeB = b.validStudyMs !== undefined ? b.validStudyMs : (b.cameraOnMs !== undefined ? b.cameraOnMs : (b.duration || 0));
    const diff = timeB - timeA;
    if (diff !== 0) return diff;
    return (b.totalPresentMs || b.totalDuration || 0) - (a.totalPresentMs || a.totalDuration || 0);
  });

  // Assign Dense Rank: equal seconds share the same rank number
  let currentRank = 1;
  for (let i = 0; i < participants.length; i++) {
    if (i > 0) {
      const prevTime = participants[i - 1].validStudyMs !== undefined ? participants[i - 1].validStudyMs : (participants[i - 1].cameraOnMs || 0);
      const currTime = participants[i].validStudyMs !== undefined ? participants[i].validStudyMs : (participants[i].cameraOnMs || 0);
      const prevSec = Math.floor(prevTime / 1000);
      const currSec = Math.floor(currTime / 1000);
      if (currSec < prevSec) {
        currentRank++;
      }
    }
    participants[i].rank = currentRank;
  }
  return participants;
}

function cleanParticipantName(raw, isLocal = false) {
  if (!raw) return isLocal ? 'Host (You)' : null;
  let s = String(raw).trim();
  s = s.replace(/keep_outline|more_vert|mic_off|push_pin|volume_up|more_horiz/gi, '').trim();
  s = s.replace(/(?:'s\s+video|'s\s+feed|video\s+of\s+|video\s+feed\s+of\s+)/gi, '').trim();
  const pinMatch = s.match(/(?:Pin|Unpin)\s+(.+?)\s+(?:to|from)\s+(?:your\s+)?(?:main\s+)?screen/i);
  if (pinMatch) s = pinMatch[1].trim();
  s = s.replace(/^(?:Pin|Unpin)\s+/i, '').trim();
  const isYou = /\((?:You)\)/i.test(s) || isLocal || s.toLowerCase() === 'you';
  s = s.replace(/\s*[\(\[]\s*(\d+|you|host|co-host|presentation|external|call|phone|mobile|laptop|desktop|tablet|guest|audio|mic|webcam|cam)\s*[\)\]]/gi, '').trim();
  s = s.replace(/\s*-\s*\d+$/i, '').trim();
  s = s.replace(/\s*#\s*\d+$/i, '').trim();
  if (!s || s.length === 0) return isYou ? 'Host (You)' : null;
  if (/^\d+$/.test(s) || /^\d{1,2}:\d{2}/.test(s) || /^\d+%/.test(s)) return null;
  const lower = s.toLowerCase();
  const UI_ACTIONS = ['turn off', 'turn on', 'visual effects', 'leave call', 'for everyone', 'click to', 'more options', 'microphone', 'pin to screen', 'dont turn off'];
  for (const act of UI_ACTIONS) { if (lower.includes(act)) return null; }
  if (lower === 'pin' || lower === 'unpin') return null;
  if (lower === 'host' || lower === 'you') return isYou ? 'Host (You)' : 'Host';
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

function generateRankedAttendanceHtml(session, options = {}) {
  const consolidated = consolidateParticipantsForReport(Object.values(session.participants || {}), session);
  const rawParticipants = consolidated;
  
  // HOST IS 100% EXEMPT FROM STUDENT RANKING COMPETITION & PODIUM!
  const hostParticipant = rawParticipants.find(p => p.isLocal || p.id === 'local_host' || (p.name && p.name.toLowerCase().includes('host')));
  if (hostParticipant) {
    finalizeParticipant(hostParticipant, session, Date.now());
    hostParticipant.rank = 'EXEMPT';
    hostParticipant.isExempt = true;
  }

  // Filter students (Host is exempt from ranking)
  const participants = rawParticipants.filter(p => {
    if (!p || !p.name) return false;
    const lower = p.name.toLowerCase();
    if (lower.includes('keep_outline') || lower.includes('turn off') || lower === 'pin' || lower === 'unpin') return false;
    if (p.isLocal || p.id === 'local_host' || lower === 'host' || lower === 'host (you)') return false;
    return true;
  });

  // Dense ranking ONLY on students!
  computeDenseRanks(participants, session);

  const exemptedCount = hostParticipant ? 1 : 0;

  // 7 Hours Cutoff in milliseconds: 7 * 3600 * 1000 = 25200000 ms
  const cutoffMs = 7 * 3600 * 1000;
  
  // Check if session has participants >= 7 hours
  const hasSevenHourParticipants = participants.some(p => {
    const t = p.validStudyMs !== undefined ? p.validStudyMs : (p.cameraOnMs || 0);
    return t >= cutoffMs;
  });

  // Filter for qualified participants:
  const effectiveCutoffMs = hasSevenHourParticipants ? cutoffMs : 0;
  const cutoffLabel = hasSevenHourParticipants ? '07:00:00' : '00:00:00';
  const cutoffBadge = hasSevenHourParticipants ? '7+ HOURS ELITE' : 'ALL QUALIFIED';

  const rankedList = participants.filter(p => {
    const t = p.validStudyMs !== undefined ? p.validStudyMs : (p.cameraOnMs || 0);
    return t >= effectiveCutoffMs;
  });

  const belowCutoffList = participants.filter(p => {
    const t = p.validStudyMs !== undefined ? p.validStudyMs : (p.cameraOnMs || 0);
    return t < effectiveCutoffMs;
  });

  const belowCutoffCount = belowCutoffList.length;

  // Podium participants:
  const rank1Students = rankedList.filter(p => p.rank === 1);
  const rank2Students = rankedList.filter(p => p.rank === 2);
  const rank3Students = rankedList.filter(p => p.rank === 3);

  const rank1Time = rank1Students.length > 0 ? formatHms(rank1Students[0].validStudyMs || rank1Students[0].cameraOnMs) : '--:--:--';
  const rank2Time = rank2Students.length > 0 ? formatHms(rank2Students[0].validStudyMs || rank2Students[0].cameraOnMs) : '--:--:--';
  const rank3Time = rank3Students.length > 0 ? formatHms(rank3Students[0].validStudyMs || rank3Students[0].cameraOnMs) : '--:--:--';

  // All Ranked Rows HTML (Neat, Short, and strictly necessary details ONLY)
  const allRankedRowsHtml = rankedList.map((p, idx) => {
    const camOn = p.validStudyMs !== undefined ? p.validStudyMs : (p.cameraOnMs || 0);
    const camOff = p.cameraOffMs !== undefined ? p.cameraOffMs : 0;
    const totMeet = (p.totalPresentMs && p.totalPresentMs >= camOn + camOff) ? p.totalPresentMs : (camOn + camOff);
    const totalInMeet = p.totalInMeetMs || totMeet;
    const compScore = totMeet > 0 ? ((camOn / totMeet) * 100).toFixed(1) + '%' : (camOn > 0 ? '100.0%' : '0.0%');
    const isPresent = p.currentStatus === 'present';
    const rejoins = p.rejoinCount || 0;

    let badgeClass = 'badge-other';
    if (p.rank === 1) badgeClass = 'badge-gold';
    else if (p.rank === 2) badgeClass = 'badge-silver';
    else if (p.rank === 3) badgeClass = 'badge-bronze';

    return `
      <tr class="${idx % 2 === 1 ? 'row-alt' : ''}">
        <td class="col-rank text-center">
          <span class="rank-circle ${badgeClass}">${p.rank}</span>
        </td>
        <td class="col-name font-bold text-dark">
          ${escapeHtml(p.name.toUpperCase())}
        </td>
        <td class="col-status text-center">
          <span class="badge-pill-sm ${isPresent ? 'badge-present' : 'badge-left'}">${isPresent ? '🟢 Present' : '⚪ Left'}</span>
        </td>
        <td class="col-time font-mono text-emerald font-bold text-right">${formatHms(camOn)}</td>
        <td class="col-time font-mono text-crimson font-bold text-right">-${formatHms(camOff)}</td>
        <td class="col-time font-mono text-blue font-bold text-right">${formatHms(totalInMeet)}</td>
        <td class="col-comp font-mono font-bold text-center">
          <span class="comp-badge ${parseFloat(compScore) >= 80 ? 'comp-high' : (parseFloat(compScore) >= 50 ? 'comp-mid' : 'comp-low')}">${compScore}</span>
        </td>
        <td class="col-rejoins text-center">
          ${rejoins > 0 ? `<span class="badge-rejoin-mini">🔄 ${rejoins} Rejoin${rejoins > 1 ? 's' : ''}</span>` : '<span class="text-muted text-xs">—</span>'}
        </td>
      </tr>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Ranked Attendance Report - Landscape</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-page: #eef7f2;
      --bg-card: #ffffff;
      --border-green: #86efac;
      --border-green-dark: #10b981;
      --text-forest: #064e3b;
      --text-emerald: #059669;
      --text-dark: #0f172a;
      --text-gray: #334155;
      --text-muted: #64748b;
      --coral-bg: #ffe4e6;
      --coral-border: #f43f5e;
      --coral-text: #e11d48;
      --table-header-bg: #064e3b;
      --podium-gold-bg: #fef08a;
      --podium-gold-border: #eab308;
      --podium-gold-text: #713f12;
      --podium-silver-bg: #e2e8f0;
      --podium-silver-border: #94a3b8;
      --podium-silver-text: #1e293b;
      --podium-bronze-bg: #fed7aa;
      --podium-bronze-border: #f97316;
      --podium-bronze-text: #7c2d12;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      background-color: var(--bg-page);
      color: var(--text-dark);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      line-height: 1.35;
      -webkit-font-smoothing: antialiased;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

    /* Screen Action Bar (hidden in PDF print) */
    .screen-action-bar {
      position: sticky;
      top: 0;
      z-index: 9999;
      background: #064e3b;
      color: #fff;
      padding: 10px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
    }
    .screen-action-bar a {
      color: #a7f3d0;
      text-decoration: none;
      font-size: 13px;
      font-weight: 600;
    }
    .screen-action-bar .btn-print-now {
      background: #10b981;
      color: #ffffff;
      border: none;
      padding: 8px 18px;
      border-radius: 8px;
      font-weight: 800;
      font-size: 13px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 2px 10px rgba(16, 185, 129, 0.4);
      transition: all 0.2s;
    }
    .screen-action-bar .btn-print-now:hover {
      background: #059669;
      transform: scale(1.02);
    }

    /* Page Container: Pure A4 Landscape (297mm x 210mm) */
    .a4-page {
      width: 297mm;
      min-height: 210mm;
      margin: 18px auto;
      background: #ffffff;
      padding: 10mm 15mm 8mm;
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.08);
      position: relative;
      display: flex;
      flex-direction: column;
    }

    .page-break {
      page-break-before: always;
      break-before: page;
    }

    /* Header Block */
    .report-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 2px solid #e2e8f0;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .header-logo-badge {
      font-size: 24px;
      background: #ecfdf5;
      border: 1.5px solid #10b981;
      padding: 4px 8px;
      border-radius: 8px;
    }

    .report-title {
      font-family: 'Outfit', sans-serif;
      font-size: 24px;
      font-weight: 900;
      letter-spacing: 1px;
      color: var(--text-forest);
      text-transform: uppercase;
      line-height: 1.1;
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .badge-pill {
      display: inline-block;
      font-size: 11px;
      font-weight: 800;
      color: var(--coral-text);
      background: var(--coral-bg);
      border: 1.5px solid var(--coral-border);
      padding: 4px 12px;
      border-radius: 20px;
      letter-spacing: 0.8px;
      text-transform: uppercase;
    }

    .report-subtitle {
      font-size: 11px;
      font-weight: 800;
      color: var(--text-emerald);
      letter-spacing: 1px;
      text-transform: uppercase;
      background: #ecfdf5;
      padding: 4px 10px;
      border-radius: 6px;
      border: 1px solid #a7f3d0;
    }

    /* Session Metadata Strip (6-card landscape grid) */
    .session-meta-strip {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 8px;
      background: #f8fafc;
      border: 1.5px solid #e2e8f0;
      border-radius: 8px;
      padding: 8px 12px;
      margin-bottom: 12px;
      font-size: 11px;
    }

    .meta-item {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .meta-item span {
      font-size: 9.5px;
      text-transform: uppercase;
      color: var(--text-muted);
      font-weight: 700;
      letter-spacing: 0.5px;
    }

    .meta-item strong {
      font-size: 11px;
      color: var(--text-dark);
      font-weight: 800;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* 4 KPI Metric Boxes (wide landscape) */
    .kpi-boxes-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin-bottom: 14px;
    }

    .kpi-box {
      border: 1.5px solid var(--border-green-dark);
      border-radius: 8px;
      padding: 8px 10px;
      text-align: center;
      background: #ffffff;
      box-shadow: 0 2px 5px rgba(16, 185, 129, 0.06);
    }

    .kpi-box-num {
      font-family: 'Outfit', sans-serif;
      font-size: 22px;
      font-weight: 900;
      color: var(--text-forest);
      line-height: 1.1;
      margin-bottom: 2px;
    }

    .kpi-box-label {
      font-size: 9px;
      font-weight: 800;
      color: var(--text-forest);
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }

    /* Section Headings with Green Marker */
    .section-head {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }

    .green-marker {
      width: 5px;
      height: 18px;
      background: #10b981;
      border-radius: 3px;
      display: inline-block;
    }

    .section-title {
      font-family: 'Outfit', sans-serif;
      font-size: 15px;
      font-weight: 800;
      color: var(--text-forest);
      letter-spacing: 0.5px;
    }

    /* Leaderboard Podium (Clean Compact Landscape Layout) */
    .podium-container {
      display: grid;
      grid-template-columns: 1fr 1.1fr 1fr;
      align-items: flex-end;
      gap: 12px;
      margin-bottom: 14px;
    }

    .podium-card {
      border-radius: 8px;
      padding: 10px 12px;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      box-shadow: 0 3px 8px rgba(0, 0, 0, 0.05);
    }

    .podium-card.rank-2 {
      background: var(--podium-silver-bg);
      border: 1.5px solid var(--podium-silver-border);
      min-height: 85px;
    }

    .podium-card.rank-1 {
      background: var(--podium-gold-bg);
      border: 2px solid var(--podium-gold-border);
      min-height: 105px;
      box-shadow: 0 4px 14px rgba(234, 179, 8, 0.25);
    }

    .podium-card.rank-3 {
      background: var(--podium-bronze-bg);
      border: 1.5px solid var(--podium-bronze-border);
      min-height: 75px;
    }

    .podium-rank-title {
      font-family: 'Outfit', sans-serif;
      font-size: 13px;
      font-weight: 900;
      letter-spacing: 0.8px;
      margin-bottom: 2px;
      text-transform: uppercase;
    }
    .rank-2 .podium-rank-title { color: var(--podium-silver-text); }
    .rank-1 .podium-rank-title { color: var(--podium-gold-text); font-size: 15px; }
    .rank-3 .podium-rank-title { color: var(--podium-bronze-text); }

    .podium-time {
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      font-weight: 800;
      margin-bottom: 4px;
    }
    .rank-2 .podium-time { color: var(--podium-silver-text); }
    .rank-1 .podium-time { color: var(--podium-gold-text); font-size: 14px; }
    .rank-3 .podium-time { color: var(--podium-bronze-text); }

    .podium-names {
      font-size: 10.5px;
      font-weight: 800;
      line-height: 1.3;
      text-transform: uppercase;
    }
    .rank-2 .podium-names { color: var(--podium-silver-text); }
    .rank-1 .podium-names { color: var(--podium-gold-text); }
    .rank-3 .podium-names { color: var(--podium-bronze-text); }

    /* Tables: Crisp Landscape Grid */
    .ranked-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 12px;
      font-size: 10.5px;
      table-layout: fixed;
    }

    .ranked-table thead th {
      background: var(--table-header-bg);
      color: #ffffff;
      font-family: 'Outfit', sans-serif;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.6px;
      text-transform: uppercase;
      padding: 7px 10px;
      border: none;
      vertical-align: middle;
    }

    .ranked-table tbody td {
      padding: 6px 10px;
      border-bottom: 1px solid #e2e8f0;
      vertical-align: middle;
      font-size: 10.5px;
    }

    .ranked-table tbody tr.row-alt {
      background-color: #f8fafc;
    }

    .ranked-table tbody tr:hover {
      background-color: #f1f5f9;
    }

    /* Single Neat Ranked Table Widths (A4 Landscape) */
    .ranked-table .col-rank { width: 60px; }
    .ranked-table .col-name { width: 280px; }
    .ranked-table .col-status { width: 110px; }
    .ranked-table .col-time { width: 125px; }
    .ranked-table .col-comp { width: 100px; }
    .ranked-table .col-rejoins { width: 100px; }

    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .text-left { text-align: left; }
    .font-bold { font-weight: 700; }
    .font-mono { font-family: 'JetBrains Mono', monospace; }
    .text-dark { color: #0f172a; }
    .text-emerald { color: #059669; }
    .text-crimson { color: #dc2626; }
    .text-blue { color: #2563eb; }
    .text-muted { color: #64748b; }
    .text-xs { font-size: 9px; line-height: 1.2; }
    .text-base-clean { font-size: 11px; }

    .badge-rejoin-mini {
      display: inline-block;
      background: rgba(167, 139, 250, 0.18);
      color: #6d28d9;
      border: 1px solid rgba(167, 139, 250, 0.4);
      font-size: 8.5px;
      font-weight: 800;
      padding: 1px 5px;
      border-radius: 4px;
      margin-left: 4px;
      vertical-align: middle;
    }

    .badge-pill-sm {
      display: inline-block;
      font-size: 9.5px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 12px;
    }
    .badge-present { background: #dcfce7; color: #166534; }
    .badge-left { background: #f1f5f9; color: #475569; }

    .comp-badge {
      display: inline-block;
      font-size: 9.5px;
      font-weight: 800;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .comp-high { background: #dcfce7; color: #166534; }
    .comp-mid { background: #fef9c3; color: #854d0e; }
    .comp-low { background: #fee2e2; color: #991b1b; }

    .sub-log-presence {
      font-size: 9.5px;
      color: #1e40af;
      margin-bottom: 2px;
      line-height: 1.35;
    }
    .sub-log-cut {
      font-size: 9.5px;
      color: #991b1b;
      margin-bottom: 2px;
      line-height: 1.35;
    }
    .sub-log-good {
      font-size: 9.5px;
      color: #166534;
      font-weight: 600;
    }

    .col-details {
      word-break: break-word;
      font-size: 9.5px;
      line-height: 1.35;
    }

    /* Rank Badges */
    .rank-circle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      font-size: 10px;
      font-weight: 900;
      color: #ffffff;
    }

    .rank-circle.badge-gold {
      background: #f59e0b;
      box-shadow: 0 0 6px rgba(245, 158, 11, 0.4);
    }
    .rank-circle.badge-silver {
      background: #94a3b8;
    }
    .rank-circle.badge-bronze {
      background: #ea580c;
    }
    .rank-circle.badge-other {
      background: #10b981;
    }

    /* Page 2 Header Strip */
    .page2-header-strip {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
      padding-bottom: 6px;
      border-bottom: 1.5px solid #e2e8f0;
    }

    .page2-meta-badge {
      font-size: 10.5px;
      font-weight: 700;
      color: var(--text-forest);
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      padding: 3px 8px;
      border-radius: 6px;
    }

    /* Notice Box */
    .notice-callout-box {
      border: 1.5px dashed #10b981;
      border-radius: 6px;
      background: #f0fdf4;
      padding: 8px 14px;
      font-size: 10px;
      color: var(--text-forest);
      font-weight: 600;
      text-align: center;
      margin-top: auto;
      margin-bottom: 8px;
    }

    /* Footer */
    .report-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 9.5px;
      font-weight: 700;
      color: var(--text-forest);
      border-top: 1px solid #e2e8f0;
      padding-top: 6px;
      margin-top: auto;
    }

    .footer-left {
      font-family: 'Outfit', sans-serif;
      letter-spacing: 0.5px;
    }

    .footer-right {
      color: #64748b;
    }

    /* Strict A4 Landscape Print Settings */
    @media print {
      body {
        background: #ffffff !important;
        padding: 0 !important;
      }
      .screen-action-bar { display: none !important; }
      .a4-page {
        margin: 0 !important;
        box-shadow: none !important;
        width: 100% !important;
        min-height: auto !important;
        height: auto !important;
        padding: 8mm 10mm !important;
      }
      .page-break {
        page-break-before: always !important;
        break-before: page !important;
      }
      .ranked-table thead {
        display: table-header-group !important;
      }
      .ranked-table tr {
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }
      @page {
        size: A4 landscape;
        margin: 8mm 10mm;
      }
    }
  </style>
</head>
<body>

  <!-- Screen Top Bar with Print Button -->
  <div class="screen-action-bar">
    <div>
      <strong>📄 Ranked Attendance Report</strong> &bull; <span style="font-weight: normal; opacity: 0.9;">A4 Landscape &bull; Equal Durations Share Identical Rank</span>
    </div>
    <div style="display: flex; gap: 12px; align-items: center;">
      <a href="/report?theme=pain&print=true" style="color: #fca5a5;">🩸 Switch to Pain Akatsuki Theme</a>
      <a href="/">← Live Dashboard</a>
      <button class="btn-print-now" onclick="window.print()">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
        <span>Print Landscape PDF</span>
      </button>
    </div>
  </div>

  <!-- PAGE 1: Top 10 Consolidated Report with Podium (Landscape) -->
  <div class="a4-page">
    <header class="report-header">
      <div class="header-left">
        <div class="header-logo-badge">🪳</div>
        <div>
          <h1 class="report-title">RANKED ATTENDANCE &amp; STUDY REPORT</h1>
          <div style="font-size: 10px; color: var(--text-muted); font-weight: 600;">COCKROACH LIBRARY &bull; 12-HOUR MARATHON</div>
        </div>
      </div>
      <div class="header-right">
        <span class="badge-pill">${cutoffBadge}</span>
        <span class="report-subtitle">&#9733; CONSOLIDATED RANKINGS &#9733;</span>
      </div>
    </header>

    <!-- Session Metadata Strip (6 Columns across landscape width) -->
    <div class="session-meta-strip">
      <div class="meta-item"><span>Room Code:</span> <strong>${session.meetingCode || 'cockroach-study-room'}</strong></div>
      <div class="meta-item"><span>Target Goal:</span> <strong>${session.targetDurationHours || 12}h Marathon</strong></div>
      <div class="meta-item"><span>Session Status:</span> <strong>${session.isTracking ? (session.isPaused ? 'PAUSED ⏸️' : 'ACTIVE 🟢') : 'FINALIZED ⏹️'}</strong></div>
      <div class="meta-item"><span>Started At:</span> <strong>${session.startedAt ? new Date(session.startedAt).toLocaleTimeString('en-IN') : 'N/A'}</strong></div>
      <div class="meta-item"><span>Total Breaks:</span> <strong>${formatHms(session.totalPausedMs || 0)}</strong></div>
      <div class="meta-item"><span>Host Exemption:</span> <strong style="color: #10b981;">100% EXEMPT</strong></div>
    </div>

    <!-- 4 KPI Metric Cards (Symmetrical landscape row) -->
    <div class="kpi-boxes-row">
      <div class="kpi-box">
        <div class="kpi-box-num">${rankedList.length}</div>
        <div class="kpi-box-label">RANKED PARTICIPANTS</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-box-num" style="color: #10b981;">${rankedList.filter(p => (p.cameraOffMs || 0) === 0).length}</div>
        <div class="kpi-box-label">100% CAM COMPLIANT</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-box-num" style="color: #2563eb;">${exemptedCount}</div>
        <div class="kpi-box-label">EXEMPTED (HOST)</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-box-num" style="color: #dc2626;">${belowCutoffCount}</div>
        <div class="kpi-box-label">BELOW ${cutoffLabel} CUTOFF</div>
      </div>
    </div>

    <!-- Leaderboard Podium -->
    <div class="section-head">
      <span class="green-marker"></span>
      <h2 class="section-title">Leaderboard Podium (Olympic Top 3)</h2>
    </div>

    <div class="podium-container">
      <!-- Rank 2 (Silver) -->
      <div class="podium-card rank-2">
        <div class="podium-rank-title">🥈 RANK 2</div>
        <div class="podium-time">${rank2Time}</div>
        <div class="podium-names">
          ${rank2Students.length > 0 ? rank2Students.map(s => escapeHtml(s.name.toUpperCase())).join(', ') : '—'}
        </div>
      </div>

      <!-- Rank 1 (Gold - Elevated in Center) -->
      <div class="podium-card rank-1">
        <div class="podium-rank-title">👑 RANK 1 (GOLD)</div>
        <div class="podium-time">${rank1Time}</div>
        <div class="podium-names">
          ${rank1Students.length > 0 ? rank1Students.map(s => escapeHtml(s.name.toUpperCase())).join(', ') : '—'}
        </div>
      </div>

      <!-- Rank 3 (Bronze) -->
      <div class="podium-card rank-3">
        <div class="podium-rank-title">🥉 RANK 3</div>
        <div class="podium-time">${rank3Time}</div>
        <div class="podium-names">
          ${rank3Students.length > 0 ? rank3Students.map(s => escapeHtml(s.name.toUpperCase())).join(', ') : '—'}
        </div>
      </div>
    </div>

    <!-- The Official Student Rankings Table (Neat, Short, Landscape) -->
    <div class="section-head">
      <span class="green-marker"></span>
      <h2 class="section-title">Official Student Rankings (${cutoffBadge})</h2>
    </div>

    <table class="ranked-table">
      <thead>
        <tr>
          <th class="col-rank text-center">RANK</th>
          <th class="col-name text-left">PARTICIPANT NAME</th>
          <th class="col-status text-center">STATUS</th>
          <th class="col-time text-right" style="color: #10b981;">STUDY (CAM ON)</th>
          <th class="col-time text-right" style="color: #f43f5e;">CUT (CAM OFF)</th>
          <th class="col-time text-right" style="color: #2563eb;">TOTAL IN MEET</th>
          <th class="col-comp text-center">COMPLIANCE</th>
          <th class="col-rejoins text-center">REJOINS</th>
        </tr>
      </thead>
      <tbody>
        ${allRankedRowsHtml || '<tr><td colspan="8" style="text-align: center; padding: 18px; color: #64748b;">No participants recorded yet.</td></tr>'}
      </tbody>
    </table>

    <div class="notice-callout-box" style="margin-top: 14px; padding: 10px 14px; background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; font-size: 11px; color: #166534; line-height: 1.5;">
      <strong>Official Ranking Rules:</strong> Students with identical valid study duration share identical rank. Host (local_host) is 100% exempt from student ranks and deductions.
      <br>
      <span style="color: #475569;">For full second-by-second camera cut breakdowns, presence logs, and break charts, view the <a href="/report?theme=pain&print=true" style="color: #dc2626; font-weight: 700; text-decoration: underline;">Akatsuki Pain Full Dossier</a>.</span>
    </div>

    <footer class="report-footer" style="margin-top: auto; padding-top: 12px; display: flex; justify-content: space-between; font-size: 10px; color: #64748b; border-top: 1px solid #e2e8f0;">
      <span class="footer-left">Cockroach Library &bull; Official Ranked Attendance Report (Landscape)</span>
      <span class="footer-right">Generated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</span>
    </footer>
  </div>

</body>
</html>`;
}

module.exports = {
  generateRankedAttendanceHtml,
  computeDenseRanks
};
