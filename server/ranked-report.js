// Ranked Attendance Report Generator (Clean Mint Green Consolidated Theme)
// Exactly matching the user's specification with Leaderboard Podium and Equal Duration Shared Ranks

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

  // Fallback only if both are 0
  if (camOn === 0 && camOff === 0) {
    if (openIntervalOnMs > 0 || openIntervalOffMs > 0) {
      camOn = openIntervalOnMs;
      camOff = openIntervalOffMs;
    } else if (totalInCallMs > 0) {
      if (p.cameraStatus === 'on') camOn = totalInCallMs;
      else camOff = totalInCallMs;
    }
  }

  const totMeet = (p.totalPresentMs && p.totalPresentMs >= camOn + camOff)
    ? p.totalPresentMs
    : Math.max(totalInCallMs, camOn + camOff);

  if (camOff === 0 && totMeet > camOn) {
    camOff = totMeet - camOn;
  }

  const validStudy = camOn;

  p.cameraOnMs = camOn;
  p.cameraOffMs = camOff;
  p.totalPresentMs = totMeet;
  p.validStudyMs = validStudy;

  p.totalDuration = totMeet;
  p.duration = validStudy;
  p.timeInCall = totMeet;
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

function generateRankedAttendanceHtml(session, options = {}) {
  const rawParticipants = Object.values(session.participants || {});
  
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
  // If there are participants >= 7h, cutoff is 7 hours.
  // Otherwise show all participants so report isn't blank on shorter runs.
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

  // Group by rank for Page 1 Top 10 table
  const ranksMap = new Map();
  rankedList.forEach(p => {
    if (!ranksMap.has(p.rank)) ranksMap.set(p.rank, []);
    ranksMap.get(p.rank).push(p);
  });

  const top10RankNumbers = Array.from(ranksMap.keys()).slice(0, 10);
  const top10RowsHtml = top10RankNumbers.map(rNum => {
    const studentsInRank = ranksMap.get(rNum);
    const combinedNames = studentsInRank.map(s => escapeHtml(s.name.toUpperCase())).join(', ');
    const studyTime = formatHms(studentsInRank[0].validStudyMs || studentsInRank[0].cameraOnMs || 0);

    let badgeClass = 'badge-other';
    if (rNum === 1) badgeClass = 'badge-gold';
    else if (rNum === 2) badgeClass = 'badge-silver';
    else if (rNum === 3) badgeClass = 'badge-bronze';

    return `
      <tr>
        <td class="col-rank">
          <span class="rank-circle ${badgeClass}">${rNum}</span>
        </td>
        <td class="col-name font-bold text-dark">${combinedNames}</td>
        <td class="col-time font-mono text-dark">${studyTime}</td>
      </tr>
    `;
  }).join('');

  // Page 2: Complete Ranked Analytics (Each student gets individual row with shared rank)
  const completeRowsHtml = rankedList.map((p, idx) => {
    const studyTime = formatHms(p.validStudyMs !== undefined ? p.validStudyMs : (p.cameraOnMs || 0));
    return `
      <tr class="${idx % 2 === 1 ? 'row-alt' : ''}">
        <td class="col-rank text-center font-bold text-gray">${p.rank}</td>
        <td class="col-name font-bold text-dark">${escapeHtml(p.name.toUpperCase())}</td>
        <td class="col-time font-mono text-dark">${studyTime}</td>
      </tr>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Ranked Attendance Report</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-page: #f2faf4;
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
      padding: 12px 24px;
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
      padding: 9px 20px;
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

    /* Page Container */
    .a4-page {
      width: 210mm;
      min-height: 297mm;
      margin: 16px auto;
      background: #ffffff;
      padding: 18mm 20mm 14mm;
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
      text-align: center;
      margin-bottom: 22px;
    }

    .report-title {
      font-family: 'Outfit', sans-serif;
      font-size: 32px;
      font-weight: 900;
      letter-spacing: 1.5px;
      color: var(--text-forest);
      text-transform: uppercase;
      margin-bottom: 8px;
    }

    .badge-pill {
      display: inline-block;
      font-size: 12px;
      font-weight: 800;
      color: var(--coral-text);
      background: var(--coral-bg);
      border: 1.5px solid var(--coral-border);
      padding: 4px 14px;
      border-radius: 20px;
      letter-spacing: 0.8px;
      margin-bottom: 8px;
      text-transform: uppercase;
    }

    .report-subtitle {
      font-size: 12px;
      font-weight: 800;
      color: var(--text-emerald);
      letter-spacing: 1.5px;
      text-transform: uppercase;
    }

    /* 3 KPI Metric Boxes */
    .kpi-boxes-row {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      margin-bottom: 28px;
    }

    .kpi-box {
      border: 2px solid var(--border-green-dark);
      border-radius: 12px;
      padding: 14px 10px;
      text-align: center;
      background: #ffffff;
      box-shadow: 0 2px 6px rgba(16, 185, 129, 0.08);
    }

    .kpi-box-num {
      font-family: 'Outfit', sans-serif;
      font-size: 28px;
      font-weight: 900;
      color: var(--text-forest);
      line-height: 1.1;
      margin-bottom: 4px;
    }

    .kpi-box-label {
      font-size: 10px;
      font-weight: 800;
      color: var(--text-forest);
      letter-spacing: 0.6px;
      text-transform: uppercase;
    }

    /* Section Headings with Green Marker */
    .section-head {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 14px;
    }

    .green-marker {
      width: 7px;
      height: 22px;
      background: #10b981;
      border-radius: 4px;
      display: inline-block;
    }

    .section-title {
      font-family: 'Outfit', sans-serif;
      font-size: 18px;
      font-weight: 800;
      color: var(--text-forest);
      letter-spacing: 0.5px;
    }

    /* Leaderboard Podium (Olympic Podium) */
    .podium-container {
      display: grid;
      grid-template-columns: 1fr 1.15fr 1fr;
      align-items: flex-end;
      gap: 12px;
      margin-bottom: 28px;
      min-height: 155px;
    }

    .podium-card {
      border-radius: 10px;
      padding: 14px 12px;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
    }

    .podium-card.rank-2 {
      background: var(--podium-silver-bg);
      border: 1.5px solid var(--podium-silver-border);
      min-height: 135px;
    }

    .podium-card.rank-1 {
      background: var(--podium-gold-bg);
      border: 2px solid var(--podium-gold-border);
      min-height: 165px;
      transform: translateY(-8px);
      box-shadow: 0 6px 18px rgba(234, 179, 8, 0.25);
    }

    .podium-card.rank-3 {
      background: var(--podium-bronze-bg);
      border: 1.5px solid var(--podium-bronze-border);
      min-height: 120px;
    }

    .podium-rank-title {
      font-family: 'Outfit', sans-serif;
      font-size: 16px;
      font-weight: 900;
      letter-spacing: 1px;
      margin-bottom: 4px;
      text-transform: uppercase;
    }
    .rank-2 .podium-rank-title { color: var(--podium-silver-text); }
    .rank-1 .podium-rank-title { color: var(--podium-gold-text); font-size: 19px; }
    .rank-3 .podium-rank-title { color: var(--podium-bronze-text); }

    .podium-time {
      font-family: 'JetBrains Mono', monospace;
      font-size: 14px;
      font-weight: 800;
      margin-bottom: 8px;
    }
    .rank-2 .podium-time { color: var(--podium-silver-text); }
    .rank-1 .podium-time { color: var(--podium-gold-text); font-size: 15px; }
    .rank-3 .podium-time { color: var(--podium-bronze-text); }

    .podium-names {
      font-size: 11px;
      font-weight: 800;
      line-height: 1.35;
      text-transform: uppercase;
    }
    .rank-2 .podium-names { color: var(--podium-silver-text); }
    .rank-1 .podium-names { color: var(--podium-gold-text); }
    .rank-3 .podium-names { color: var(--podium-bronze-text); }

    /* Tables */
    .ranked-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
      font-size: 12px;
    }

    .ranked-table thead th {
      background: var(--table-header-bg);
      color: #ffffff;
      font-family: 'Outfit', sans-serif;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      padding: 10px 14px;
      border: none;
    }

    .ranked-table thead th.col-rank { width: 70px; text-align: left; }
    .ranked-table thead th.col-name { text-align: left; }
    .ranked-table thead th.col-time { width: 160px; text-align: left; }

    .ranked-table tbody td {
      padding: 8.5px 14px;
      border-bottom: 1px solid #e2e8f0;
      vertical-align: middle;
      font-size: 12px;
    }

    .ranked-table tbody tr.row-alt {
      background-color: #f8fafc;
    }

    .ranked-table tbody tr:hover {
      background-color: #f1f5f9;
    }

    .col-rank { text-align: left; }
    .col-name { font-weight: 700; color: #0f172a; }
    .col-time { font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 700; color: #0f172a; }

    /* Rank Badges in Top 10 */
    .rank-circle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      font-size: 11px;
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
      background: #22c55e;
    }

    /* Page 2 Callout Notice Box */
    .notice-callout-box {
      border: 1.5px dashed #10b981;
      border-radius: 8px;
      background: #f0fdf4;
      padding: 12px 16px;
      font-size: 11px;
      color: var(--text-forest);
      font-weight: 600;
      text-align: center;
      margin-top: auto;
      margin-bottom: 16px;
    }

    /* Footer */
    .report-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 10px;
      font-weight: 700;
      color: var(--text-forest);
      border-top: 1px solid #e2e8f0;
      padding-top: 10px;
      margin-top: auto;
    }

    .footer-left {
      font-family: 'Outfit', sans-serif;
      letter-spacing: 0.5px;
    }

    .footer-right {
      color: #334155;
    }

    /* Print settings */
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
        padding: 12mm 15mm 10mm !important;
      }
      .page-break {
        page-break-before: always !important;
        break-before: page !important;
      }
      @page {
        size: A4 portrait;
        margin: 0;
      }
    }
  </style>
</head>
<body>

  <!-- Screen Top Bar with Print Button -->
  <div class="screen-action-bar">
    <div>
      <strong>📄 Ranked Attendance Report</strong> &bull; <span style="font-weight: normal; opacity: 0.9;">Equal Durations Share Identical Rank</span>
    </div>
    <div style="display: flex; gap: 12px; align-items: center;">
      <a href="/report?theme=pain&print=true" style="color: #fca5a5;">🩸 Switch to Pain Akatsuki Theme</a>
      <a href="/">← Dashboard</a>
      <button class="btn-print-now" onclick="window.print()">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
        <span>Print Report (PDF)</span>
      </button>
    </div>
  </div>

  <!-- PAGE 1: Top 10 Consolidated Report with Podium -->
  <div class="a4-page">
    <header class="report-header">
      <h1 class="report-title">RANKED ATTENDANCE</h1>
      <div><span class="badge-pill">${cutoffBadge}</span></div>
      <div class="report-subtitle">&#9733; CONSOLIDATED REPORT &#9733;</div>
    </header>

    <!-- 3 KPI Boxes -->
    <div class="kpi-boxes-row">
      <div class="kpi-box">
        <div class="kpi-box-num">${rankedList.length}</div>
        <div class="kpi-box-label">RANKED PARTICIPANTS</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-box-num">${exemptedCount}</div>
        <div class="kpi-box-label">EXEMPTED</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-box-num">${belowCutoffCount}</div>
        <div class="kpi-box-label">BELOW ${cutoffLabel} CUTOFF</div>
      </div>
    </div>

    <!-- Leaderboard Podium -->
    <div class="section-head">
      <span class="green-marker"></span>
      <h2 class="section-title">Leaderboard Podium</h2>
    </div>

    <div class="podium-container">
      <!-- Rank 2 (Silver) -->
      <div class="podium-card rank-2">
        <div class="podium-rank-title">RANK 2</div>
        <div class="podium-time">${rank2Time}</div>
        <div class="podium-names">
          ${rank2Students.length > 0 ? rank2Students.map(s => escapeHtml(s.name.toUpperCase())).join('<br>') : '—'}
        </div>
      </div>

      <!-- Rank 1 (Gold - Elevated in Center) -->
      <div class="podium-card rank-1">
        <div class="podium-rank-title">RANK 1</div>
        <div class="podium-time">${rank1Time}</div>
        <div class="podium-names">
          ${rank1Students.length > 0 ? rank1Students.map(s => escapeHtml(s.name.toUpperCase())).join('<br>') : '—'}
        </div>
      </div>

      <!-- Rank 3 (Bronze) -->
      <div class="podium-card rank-3">
        <div class="podium-rank-title">RANK 3</div>
        <div class="podium-time">${rank3Time}</div>
        <div class="podium-names">
          ${rank3Students.length > 0 ? rank3Students.map(s => escapeHtml(s.name.toUpperCase())).join('<br>') : '—'}
        </div>
      </div>
    </div>

    <!-- The Top 10 Rankings Table -->
    <div class="section-head">
      <span class="green-marker"></span>
      <h2 class="section-title">The Top 10 Rankings</h2>
    </div>

    <table class="ranked-table">
      <thead>
        <tr>
          <th class="col-rank">RANK</th>
          <th class="col-name">PARTICIPANT NAME</th>
          <th class="col-time">TOTAL ATTENDANCE</th>
        </tr>
      </thead>
      <tbody>
        ${top10RowsHtml || '<tr><td colspan="3" style="text-align: center; padding: 18px;">No participants recorded.</td></tr>'}
      </tbody>
    </table>

    <footer class="report-footer">
      <span class="footer-left">Ranked Attendance Report</span>
      <span class="footer-right">Page 1 of 2</span>
    </footer>
  </div>

  <!-- PAGE 2: Complete Ranked Analytics -->
  <div class="a4-page page-break">
    <div class="section-head" style="margin-top: 6px;">
      <span class="green-marker"></span>
      <h2 class="section-title">Complete Ranked Analytics (${cutoffBadge})</h2>
    </div>

    <table class="ranked-table">
      <thead>
        <tr>
          <th class="col-rank">RANK</th>
          <th class="col-name">PARTICIPANT NAME</th>
          <th class="col-time">TOTAL ATTENDANCE</th>
        </tr>
      </thead>
      <tbody>
        ${completeRowsHtml || '<tr><td colspan="3" style="text-align: center; padding: 18px;">No participants recorded.</td></tr>'}
      </tbody>
    </table>

    <div class="notice-callout-box">
      Participants with equal attendance share the same rank. Only participants with attendance of ${cutoffLabel} or more are shown; those below the cutoff are excluded.
    </div>

    <footer class="report-footer">
      <span class="footer-left">Ranked Attendance Report</span>
      <span class="footer-right">Page 2 of 2</span>
    </footer>
  </div>

</body>
</html>`;
}

module.exports = {
  generateRankedAttendanceHtml,
  computeDenseRanks
};
