// Cockroach Tracker Extension Popup Script - Resilient & Error-Free (Ranked Report Edition)

document.addEventListener('DOMContentLoaded', () => {
  const extStatusPill = document.getElementById('ext-status-pill');
  const statusText = document.getElementById('status-text');
  const popMeetingCode = document.getElementById('pop-meeting-code');
  const popDuration = document.getElementById('pop-duration');
  const popStatusBadge = document.getElementById('pop-status-badge');
  const popAttendees = document.getElementById('pop-attendees');
  const popCamsOn = document.getElementById('pop-cams-on');
  const popCamsOff = document.getElementById('pop-cams-off');

  const btnForceInject = document.getElementById('btn-force-inject');
  const popBtnStart = document.getElementById('pop-btn-start');
  const popBtnReset = document.getElementById('pop-btn-reset');
  const popRunningControls = document.getElementById('pop-running-controls');
  const popBtnPause = document.getElementById('pop-btn-pause');
  const popPauseIcon = document.getElementById('pop-pause-icon');
  const popPauseText = document.getElementById('pop-pause-text');
  const popBtnStop = document.getElementById('pop-btn-stop');
  const popBtnPdf = document.getElementById('pop-btn-pdf');
  const popBtnDashboard = document.getElementById('pop-btn-dashboard');
  const linkExportCsv = document.getElementById('link-export-csv');

  const inputServerUrl = document.getElementById('input-server-url');
  const btnSaveUrl = document.getElementById('btn-save-url');

  let currentServerUrl = 'http://localhost:4200';
  let activeTabId = null;
  let cachedSession = null;

  chrome.storage.local.get(['settings'], (res) => {
    if (res && res.settings && res.settings.serverUrl) {
      currentServerUrl = res.settings.serverUrl;
    } else if (res && res.settings && res.settings.dashboardPort) {
      currentServerUrl = `http://localhost:${res.settings.dashboardPort}`;
    }
    if (inputServerUrl) inputServerUrl.value = currentServerUrl;
  });

  if (btnSaveUrl) {
    btnSaveUrl.addEventListener('click', () => {
      let val = (inputServerUrl.value || '').trim().replace(/\/+$/, '');
      if (val) {
        if (!val.startsWith('http://') && !val.startsWith('https://')) {
          val = (val.includes('localhost') || val.includes('127.0.0.1')) ? ('http://' + val) : ('https://' + val);
        }
        currentServerUrl = val;
        chrome.storage.local.get(['settings'], (res) => {
          const settings = { ...(res?.settings || {}), serverUrl: val };
          chrome.storage.local.set({ settings }, () => {
            btnSaveUrl.innerText = 'Saved!';
            setTimeout(() => { btnSaveUrl.innerText = 'Save'; }, 1500);
            pollSession();
          });
        });
      }
    });
  }

  function formatHms(ms = 0) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  // Pure & Robust Math for Active Study Time (No Jumps, No Back-Counting)
  function calculateActiveStudyMs(sess, now = Date.now()) {
    if (!sess || !sess.startedAt) return 0;
    if (sess.stoppedAt) {
      const elapsed = Math.max(0, sess.stoppedAt - sess.startedAt);
      return Math.max(0, elapsed - (sess.totalPausedMs || 0));
    }
    if (sess.isPaused) {
      // PAUSED: Study clock stays completely FROZEN at the moment pause was clicked!
      const pauseStart = sess.currentPauseStart || now;
      const elapsedUpToPause = Math.max(0, pauseStart - sess.startedAt);
      return Math.max(0, elapsedUpToPause - (sess.totalPausedMs || 0));
    }
    const elapsed = Math.max(0, now - sess.startedAt);
    return Math.max(0, elapsed - (sess.totalPausedMs || 0));
  }

  // Force Inject into Current Meet Tab
  btnForceInject.addEventListener('click', () => {
    btnForceInject.innerText = 'Injecting HUD...';

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      let targetTab = tabs[0];
      if (!targetTab || !targetTab.url || !targetTab.url.includes('meet.google.com')) {
        chrome.tabs.query({ url: 'https://meet.google.com/*' }, (meetTabs) => {
          if (meetTabs && meetTabs.length > 0) {
            injectScriptIntoTab(meetTabs[0].id);
          } else {
            btnForceInject.innerText = '⚠️ Open meet.google.com first!';
            setTimeout(() => { btnForceInject.innerText = '⚡ Re-inject / Show HUD in Meet'; }, 2500);
          }
        });
      } else {
        injectScriptIntoTab(targetTab.id);
      }
    });
  });

  function injectScriptIntoTab(tabId) {
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content/content.js']
    }).then(() => {
      chrome.tabs.sendMessage(tabId, { type: 'REINJECT' }, () => {
        const _clearErr = chrome.runtime.lastError;
        btnForceInject.innerText = '✅ HUD Mounted in Meet!';
        setTimeout(() => { btnForceInject.innerText = '⚡ Re-inject / Show HUD in Meet'; }, 3000);
        pollSession();
      });
    }).catch(() => {
      chrome.tabs.sendMessage(tabId, { type: 'REINJECT' }, () => {
        const _clearErr = chrome.runtime.lastError;
        btnForceInject.innerText = '✅ Active!';
        setTimeout(() => { btnForceInject.innerText = '⚡ Re-inject / Show HUD in Meet'; }, 3000);
        pollSession();
      });
    });
  }

  // Start / Resume Attendance Action
  popBtnStart.addEventListener('click', () => {
    if (cachedSession && cachedSession.stoppedAt && cachedSession.startedAt) {
      const activeMs = calculateActiveStudyMs(cachedSession, Date.now());
      const startFresh = confirm(
        `A previous completed attendance session exists (${formatHms(activeMs)}).\n\n` +
        `• Click OK to RESET TO 00:00:00 and start a brand new study marathon.\n` +
        `• Click CANCEL to RESUME the existing session.`
      );
      if (startFresh) {
        triggerResetAndStart();
        return;
      }
    }

    if (activeTabId) {
      chrome.tabs.sendMessage(activeTabId, { type: 'START_ATTENDANCE' }, () => {
        const _clearErr = chrome.runtime.lastError;
        pollSession();
      });
    }
    fetch(`${currentServerUrl}/api/session/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start' })
    }).then(() => pollSession()).catch(() => {});
  });

  function triggerResetAndStart() {
    if (activeTabId) {
      chrome.tabs.sendMessage(activeTabId, { type: 'RESET_SESSION' }, () => {
        const _clearErr = chrome.runtime.lastError;
        chrome.tabs.sendMessage(activeTabId, { type: 'START_ATTENDANCE' }, () => {
          const _err = chrome.runtime.lastError;
          pollSession();
        });
      });
    }
    fetch(`${currentServerUrl}/api/session/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start', payload: { resetFirst: true } })
    }).then(() => pollSession()).catch(() => {});
  }

  // Reset Session to 00:00:00 Action
  if (popBtnReset) {
    popBtnReset.addEventListener('click', () => {
      if (confirm('Archive current session and RESET all attendance timers to 00:00:00 for a fresh 12-hour marathon?')) {
        if (activeTabId) {
          chrome.tabs.sendMessage(activeTabId, { type: 'RESET_SESSION' }, () => {
            const _clearErr = chrome.runtime.lastError;
            pollSession();
          });
        }
        fetch(`${currentServerUrl}/api/session/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'reset' })
        }).then(() => pollSession()).catch(() => {});
      }
    });
  }

  // Stop Attendance Action
  popBtnStop.addEventListener('click', () => {
    if (confirm('Turn OFF attendance tracking? Timers will freeze and all attendance data will remain visible on the dashboard.')) {
      if (activeTabId) {
        chrome.tabs.sendMessage(activeTabId, { type: 'STOP_ATTENDANCE' }, () => {
          const _clearErr = chrome.runtime.lastError;
          pollSession();
        });
      }
      fetch(`${currentServerUrl}/api/session/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' })
      }).then(() => {
        pollSession();
        setTimeout(() => {
          chrome.tabs.create({ url: `${currentServerUrl}/report?print=true` });
        }, 400);
      }).catch(() => {});
    }
  });

  // Pause / Resume Action
  popBtnPause.addEventListener('click', () => {
    const isPaused = popStatusBadge.innerText.includes('PAUSED');
    if (activeTabId) {
      chrome.tabs.sendMessage(activeTabId, { type: 'TOGGLE_PAUSE' }, () => {
        const _clearErr = chrome.runtime.lastError;
        pollSession();
      });
    }
    fetch(`${currentServerUrl}/api/session/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: isPaused ? 'resume' : 'pause' })
    }).then(() => pollSession()).catch(() => {});
  });

  // Download Ranked PDF Report
  popBtnPdf.addEventListener('click', () => {
    chrome.tabs.create({ url: `${currentServerUrl}/report?print=true` });
  });

  // Open Live Dashboard
  popBtnDashboard.addEventListener('click', () => {
    chrome.tabs.create({ url: currentServerUrl });
  });

  // Export CSV
  linkExportCsv.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: `${currentServerUrl}/api/session/export/csv` });
  });

  // Update UI from Session Object
  function applySessionData(session) {
    if (!session) return;
    cachedSession = session;

    statusText.innerText = 'ONLINE';
    extStatusPill.className = 'status-indicator online';
    popMeetingCode.innerText = session.meetingCode || 'Meet Room';

    const now = Date.now();
    const activeStudyMs = calculateActiveStudyMs(session, now);
    popDuration.innerText = formatHms(activeStudyMs);

    if (!session.isTracking) {
      const isFinalized = !!session.stoppedAt;
      popStatusBadge.innerText = isFinalized ? 'FINALIZED (OFF) ⏹️' : 'ATTENDANCE OFF ⏹️';
      popStatusBadge.className = isFinalized ? 'info-badge paused' : 'info-badge off';
      popBtnStart.innerText = isFinalized ? '▶️ RESUME / START ATTENDANCE' : '▶️ START ATTENDANCE';
      popBtnStart.style.display = 'block';
      if (popBtnReset) popBtnReset.style.display = 'block';
      popRunningControls.style.display = 'none';
    } else {
      popBtnStart.style.display = 'none';
      if (popBtnReset) popBtnReset.style.display = 'none';
      popRunningControls.style.display = 'flex';

      if (session.isPaused) {
        const breakDur = session.currentPauseStart ? Math.max(0, now - session.currentPauseStart) : 0;
        popStatusBadge.innerText = `PAUSED ⏸️ (${formatHms(breakDur)})`;
        popStatusBadge.className = 'info-badge paused';
        popBtnPause.className = 'btn btn-pause resuming';
        popPauseIcon.innerText = '▶️';
        popPauseText.innerText = 'Resume Break';
      } else {
        popStatusBadge.innerText = 'ACTIVE 🟢';
        popStatusBadge.className = 'info-badge';
        popBtnPause.className = 'btn btn-pause';
        popPauseIcon.innerText = '⏸️';
        popPauseText.innerText = 'Pause Break';
      }
    }

    const participants = Object.values(session.participants || {});
    const presentList = participants.filter(p => p.currentStatus === 'present');
    const camsOn = presentList.filter(p => p.cameraStatus === 'on').length;
    const camsOff = presentList.filter(p => p.cameraStatus === 'off').length;

    popAttendees.innerText = `${presentList.length}`;
    popCamsOn.innerText = `${camsOn}`;
    popCamsOff.innerText = `${camsOff}`;
  }

  // Graceful fallback to server if tab has not initialized message listener
  function fallbackToServer() {
    fetch(`${currentServerUrl}/api/session/current`)
      .then(r => r.json())
      .then(sess => {
        if (sess && sess.sessionId) {
          applySessionData(sess);
        } else {
          statusText.innerText = 'STANDBY';
          extStatusPill.className = 'status-indicator';
          popMeetingCode.innerText = 'Waiting for Meet...';
        }
      })
      .catch(() => {
        if (currentServerUrl.includes('localhost')) {
          const fallbackUrl = currentServerUrl.replace('localhost', '127.0.0.1');
          fetch(`${fallbackUrl}/api/session/current`)
            .then(r => r.json())
            .then(sess => {
              if (sess && sess.sessionId) {
                applySessionData(sess);
              } else {
                statusText.innerText = 'STANDBY';
                extStatusPill.className = 'status-indicator';
                popMeetingCode.innerText = 'Waiting for Meet...';
              }
            })
            .catch(() => {
              statusText.innerText = 'OFFLINE';
              extStatusPill.className = 'status-indicator';
              popMeetingCode.innerText = 'Start server & open Meet';
            });
        } else {
          statusText.innerText = 'OFFLINE';
          extStatusPill.className = 'status-indicator';
          popMeetingCode.innerText = 'Check Server URL';
        }
      });
  }

  // Resilient Polling
  function pollSession() {
    chrome.tabs.query({ url: 'https://meet.google.com/*' }, (tabs) => {
      const _queryErr = chrome.runtime.lastError;

      if (!tabs || tabs.length === 0) {
        fallbackToServer();
        return;
      }

      const meetTab = tabs[0];
      activeTabId = meetTab.id;

      chrome.tabs.sendMessage(activeTabId, { type: 'GET_SESSION' }, (session) => {
        const lastErr = chrome.runtime.lastError;
        if (lastErr || !session) {
          fallbackToServer();
          return;
        }

        applySessionData(session);
      });
    });
  }

  pollSession();
  setInterval(pollSession, 1000);
});
