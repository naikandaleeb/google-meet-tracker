// Cockroach Library Meet Tracker - Background Service Worker (Manifest V3)

const DEFAULT_SETTINGS = {
  dashboardPort: 4200,
  syncEnabled: true,
  autoDetectIntervalMs: 1500,
  targetDurationHours: 12
};

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Cockroach Tracker] Extension installed.');
  chrome.storage.local.get(['settings'], (res) => {
    if (!res.settings) {
      chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
    }
  });

  // Setup periodic alarm to keep worker responsive and trigger sync check
  chrome.alarms.create('cockroach_keepalive', { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'cockroach_keepalive') {
    // Ping all Google Meet tabs to ensure active tracking
    chrome.tabs.query({ url: 'https://meet.google.com/*' }, (tabs) => {
      tabs.forEach(tab => {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, { type: 'PING_CHECK' }, () => {
            const _clearErr = chrome.runtime.lastError;
          });
        }
      });
    });
  }
});

function resolveBaseUrl(msg, callback) {
  if (msg.serverUrl && typeof msg.serverUrl === 'string' && msg.serverUrl.trim()) {
    let clean = msg.serverUrl.trim().replace(/\/+$/, '');
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
      clean = (clean.includes('localhost') || clean.includes('127.0.0.1')) ? ('http://' + clean) : ('https://' + clean);
    }
    callback(clean);
    return;
  }

  chrome.storage.local.get(['settings'], (res) => {
    const sUrl = res?.settings?.serverUrl;
    if (sUrl && typeof sUrl === 'string' && sUrl.trim()) {
      let clean = sUrl.trim().replace(/\/+$/, '');
      if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
        clean = (clean.includes('localhost') || clean.includes('127.0.0.1')) ? ('http://' + clean) : ('https://' + clean);
      }
      callback(clean);
    } else {
      const port = res?.settings?.dashboardPort || msg.port || 4200;
      callback(`http://localhost:${port}`);
    }
  });
}

// Relay messages between content script and popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_STATUS') {
    chrome.storage.local.get(['activeMeeting', 'isPaused', 'settings'], (res) => {
      sendResponse(res);
    });
    return true;
  }

  if (msg.type === 'GET_SERVER_SESSION') {
    resolveBaseUrl(msg, (baseUrl) => {
      fetch(`${baseUrl}/api/session/current`)
        .then(r => r.json())
        .then(session => {
          if (session) {
            chrome.storage.local.set({ lastKnownSession: session });
          }
          sendResponse({ success: true, session, baseUrl });
        })
        .catch(() => {
          if (baseUrl.includes('localhost')) {
            const fallbackUrl = baseUrl.replace('localhost', '127.0.0.1');
            fetch(`${fallbackUrl}/api/session/current`)
              .then(r => r.json())
              .then(session => {
                if (session) {
                  chrome.storage.local.set({ lastKnownSession: session });
                }
                sendResponse({ success: true, session, baseUrl: fallbackUrl });
              })
              .catch(() => {
                // Service worker sleep resilience: fallback to locally persisted session
                chrome.storage.local.get(['lastKnownSession'], (res) => {
                  if (res?.lastKnownSession) {
                    sendResponse({ success: true, session: res.lastKnownSession, cached: true, baseUrl });
                  } else {
                    sendResponse({ success: false, error: 'Cannot connect to server or load cached session' });
                  }
                });
              });
          } else {
            chrome.storage.local.get(['lastKnownSession'], (res) => {
              if (res?.lastKnownSession) {
                sendResponse({ success: true, session: res.lastKnownSession, cached: true, baseUrl });
              } else {
                sendResponse({ success: false, error: 'Cannot connect to ' + baseUrl });
              }
            });
          }
        });
    });
    return true;
  }

  if (msg.type === 'SYNC_TO_SERVER') {
    // Persist active session state immediately in chrome.storage.local
    // so durations and joinTimes survive Manifest V3 service worker terminations!
    if (msg.session) {
      chrome.storage.local.set({ lastKnownSession: msg.session });
    }

    resolveBaseUrl(msg, (baseUrl) => {
      fetch(`${baseUrl}/api/session/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(msg.session)
      })
      .then(r => r.json())
      .then(data => sendResponse({ success: true, data, baseUrl }))
      .catch(() => {
        if (baseUrl.includes('localhost')) {
          const fallbackUrl = baseUrl.replace('localhost', '127.0.0.1');
          fetch(`${fallbackUrl}/api/session/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(msg.session)
          })
          .then(r => r.json())
          .then(data => sendResponse({ success: true, data, baseUrl: fallbackUrl }))
          .catch(err => sendResponse({ success: false, error: err.message }));
        } else {
          sendResponse({ success: false, error: 'Sync failed to ' + baseUrl });
        }
      });
    });
    return true;
  }

  if (msg.type === 'OPEN_TAB') {
    chrome.tabs.create({ url: msg.url }, (tab) => {
      sendResponse({ success: true, tabId: tab ? tab.id : null });
    });
    return true;
  }

  if (msg.type === 'SERVER_ACTION') {
    resolveBaseUrl(msg, (baseUrl) => {
      fetch(`${baseUrl}/api/session/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: msg.action, payload: msg.payload })
      })
      .then(r => r.json())
      .then(data => sendResponse({ success: true, data, baseUrl }))
      .catch(() => {
        if (baseUrl.includes('localhost')) {
          const fallbackUrl = baseUrl.replace('localhost', '127.0.0.1');
          fetch(`${fallbackUrl}/api/session/action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: msg.action, payload: msg.payload })
          })
          .then(r => r.json())
          .then(data => sendResponse({ success: true, data, baseUrl: fallbackUrl }))
          .catch(err => sendResponse({ success: false, error: err.message }));
        } else {
          sendResponse({ success: false, error: 'Action failed on ' + baseUrl });
        }
      });
    });
    return true;
  }
});
