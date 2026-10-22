# 🪳 Cockroach Library - 12-Hour Google Meet Attendance & Camera Tracker

A dedicated, ultra-accurate **Chrome/Edge Extension & Localhost Dashboard** built specifically for **Cockroach Library Virtual Study Marathons (12-Hour Sessions)**.

Designed with the **Pain / Akatsuki Dark Cyberpunk Aesthetic** (*Void Black `#090A0F`, Rinnegan Purple `#7C5CFF`, Crimson `#FF2A4B`, Neon Emerald `#00FF88`*).

---

## 🌟 Key Highlights & Requirements Fulfilled

1. **⏱️ Accurate 12-Hour Session Tracking**:
   - Uses real clock delta timestamps (`Date.now()`) and an inline **Web Worker Timer** (immune to Chrome's background tab sleep & throttling).
   - Keeps track across 6h, 8h, 10h, 12h, and 14h marathons without memory leaks.
   - Automatically saves state to `chrome.storage.local` and `server/data/current-session.json`. If a tab refreshes or reconnects, the 12-hour progress is preserved.

2. **⏸️ In-Meet & Remote PAUSE / RESUME Button ("Pause ka Button")**:
   - Master Pause / Resume toggle right inside the Google Meet floating overlay HUD.
   - Also controllable remotely from the Web Dashboard.
   - During breaks (lunch, dinner, stretch breaks), clicking **PAUSE** halts all attendance and camera time counters.
   - Tracks total break count and cumulative break durations (`pauseHistory`).

3. **📹 Per-Participant Camera ON / OFF Tracking ("Camera Kitne Time On / Off Thaa")**:
   - Continuously monitors whether each student's camera is **🟢 ON** or **🔴 OFF**.
   - Accurately tracks:
     - **Camera ON Duration** (HH:MM:SS)
     - **Camera OFF Duration** (HH:MM:SS)
     - **Camera Compliance %** (e.g., `92.4%`)
     - Complete state transition timeline intervals (`cameraIntervals`).
   - **Real-Time Camera Defaulter Watch**: Instantly alerts moderators when any student turns their camera off for more than 5 minutes.

4. **⚡ Dedicated Localhost Port 4200 ("Mera Study Tracker Se Alag Localhost")**:
   - Completely isolated on **Port 4200** (`http://localhost:4200`).
   - Will never conflict with your existing study tracker running on Port 3000, 5000, or 8080.
   - Port is also customizable via the extension popup settings or `PORT` environment variable.

5. **📥 One-Click CSV & Excel Export**:
   - Download complete session attendance sheets with student names, total study time, camera ON time, camera OFF time, compliance scores, and join/last seen timestamps.

---

## 🚀 Quick Setup & Installation Guide (English & Hindi)

### Step 1: Install the Chrome / Edge Extension (1 Minute)

1. Open **Google Chrome** or **Microsoft Edge**.
2. Go to `chrome://extensions` (or `edge://extensions` in Edge).
3. Toggle on **"Developer mode"** in the top-right corner.
4. Click **"Load unpacked"** (अनपैक किया गया लोड करें).
5. Select this folder:
   ```
   C:\Users\Lenovo\Downloads\google meet tracker\extension
   ```
6. The **🪳 Cockroach Library Tracker** extension will appear in your extensions list! Pin it to your browser toolbar.

---

### Step 2: Start the Dashboard Server (Port 4200)

Double-click the starter script:
- **Windows Batch File**: Double-click [`start-dashboard.bat`](start-dashboard.bat)
- **Or via PowerShell**:
  ```powershell
  cd "C:\Users\Lenovo\Downloads\google meet tracker\server"
  npm start
  ```

Your dedicated dashboard will open immediately at:
👉 **`http://localhost:4200`**

---

### Step 3: Open Google Meet

1. Join any Google Meet room (e.g., `https://meet.google.com/abc-defg-hij`).
2. The **Cockroach Tracker HUD** will automatically appear in the top-right corner of Google Meet!
3. Features inside Google Meet:
   - **Marathon Clock**: Live study time counter towards your 12-hour goal.
   - **⏸️ PAUSE STUDY BREAK**: Click whenever taking an official break.
   - **Defaulters Watch**: Real-time list of who currently has their camera OFF and for how many minutes.
   - **📥 CSV**: Instant download of attendance.
   - **🌐 Port 4200**: One-click jump to the full localhost analytics screen.
   - **🗕 Minimize**: Click `_` to minimize the HUD into a compact floating pill.

---

## 📊 Dashboard Features (`http://localhost:4200`)

| Feature | Description |
| :--- | :--- |
| **12-Hour Study Clock** | Large glowing timer with linear progress bar towards 6h, 8h, 10h, 12h, or 14h targets. |
| **Master Controls** | Central Pause / Resume button that syncs bidirectionally with Google Meet in real-time. |
| **Live Student Matrix** | Real-time table displaying student avatars, presence status, camera status, compliance meter, and durations. |
| **12H Gantt Visualizer** | Interactive visual timeline displaying green blocks (Camera ON), red blocks (Camera OFF), and amber blocks (Breaks) across the entire 12-hour session. |
| **Defaulter Watchdog** | Filter students with camera off > 5 minutes or compliance < 85%. |
| **Break Log** | Timestamped list of every break taken with exact start time, resume time, and duration. |
| **Session Archive** | Automatic persistent archiving of past study sessions in `server/data/sessions.json`. |

---

## 📁 Project Architecture

```
google meet tracker/
├── extension/                       # Chrome/Edge Manifest V3 Extension
│   ├── manifest.json                # MV3 permissions and background configuration
│   ├── background/
│   │   └── service-worker.js        # Periodic keep-alive alarm & tab messaging
│   ├── content/
│   │   ├── content.js               # Web Worker timer, DOM video/avatar detector, HUD
│   │   └── overlay.css              # Dark Akatsuki in-meet draggable styling
│   ├── popup/
│   │   ├── popup.html               # Extension popup UI
│   │   ├── popup.css
│   │   └── popup.js                 # Port configuration & quick pause controls
│   └── icons/                       # High-res Cockroach Library icons (16, 48, 128px)
├── server/                          # Dedicated Localhost Server (Port 4200)
│   ├── server.js                    # Express + WebSocket + CSV Generator
│   ├── package.json                 # Express, cors, ws dependencies
│   ├── data/                        # JSON session persistence
│   │   ├── current-session.json
│   │   └── sessions.json
│   └── public/                      # Standalone Dashboard
│       ├── index.html               # 12-Hour Marathon Command Center
│       ├── dashboard.css            # Void Black & Rinnegan styling
│       └── dashboard.js             # Live WebSocket client & Gantt visualizer
├── start-dashboard.bat              # 1-Click Windows Starter
├── start-dashboard.ps1              # PowerShell Starter
└── README.md
```

---

## ❓ Frequently Asked Questions (FAQ)

### Q: Mera study tracker jo already chal raha hai, kya yeh usse takrayega?
**Nahi!** Yeh completely separate port **`4200`** par chalta hai (`http://localhost:4200`). Aapka study tracker jo `3000` ya kisi aur port par chal raha hai, woh bina kisi disturbance ke chalta rahega. Extension popup me port change karne ka option bhi hai agar aap kisi aur port par chalana chahein.

### Q: 12 ghante ke session me browser refresh ya tab background me jaane par time accurate rahega?
**Haan, bilkul 100% accurate!**
1. Content script ke andar **Web Worker Timer** lagaya gaya hai, jo Chrome ke background tab throttling ya sleep mode se affect nahi hota.
2. Har second real wall-clock timestamps (`Date.now()`) ka delta calculate hota hai.
3. Saara session data `chrome.storage.local` aur local JSON file me auto-save hota rehta hai, toh refresh ya disconnect hone par bhi data safe rehta hai.

### Q: Camera ON aur OFF ka time kaise track hota hai?
Google Meet ke andar video stream active hone par (active video track, video rendering, avatar absence) user ka state **Camera ON** mark hota hai. Jaise hi koi camera band karta hai ya avatar show hota hai, state **Camera OFF** ho jaata hai. Dono ka exact time alag-alag store hota hai aur **Compliance %** calculate hota hai.

### Q: Pause button se kya hota hai?
Jab host break leta hai (lunch/dinner/rest), **PAUSE** button dabane par pure room ke liye study aur camera time counter freeze ho jaata hai. Break khatam hone par **RESUME** dabate hi tracking wahi se bina kisi time drift ke aage badhti hai, aur break ka time "Break History" me save ho jaata hai.
