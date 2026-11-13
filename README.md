# DeskSentry - Web Dashboard & Backend

This section provides instructions for setting up, running, and testing the DeskSentry software pipeline locally.

## Prerequisites

- Node.js (v18 or higher)
- npm

## Getting Started

### 1. Install Dependencies

Open a terminal in the project root and run:

cd web
npm install

### 2. Start the Backend Server

Start the Express server and SQLite database:

cd web
node server.js

The server will start on: http://localhost:3000
_(Keep this terminal running)_

### 3. Start the Mock Sensor Simulator (Hardware-Free Testing)

Open a second terminal window and run:

cd web
node mock_device.js

```markdown
# DeskSentry - Web Dashboard & Backend

This section provides instructions for setting up, running, and testing the DeskSentry software pipeline locally.

## Prerequisites

- Node.js (v18 or higher)
- npm

## Getting Started

### 1. Install Dependencies

Open a terminal in the project root and run:
```

cd web
npm install

```

### 2. Start the Backend Server
Start the Express server and SQLite database:

```

cd web
node server.js

```
The server will start on: http://localhost:3000
*(Keep this terminal running)*

### 3. Start the Mock Sensor Simulator (Hardware-Free Testing)
Open a second terminal window and run:

```

cd web
node mock_device.js

```
This script sends simulated distance and posture events (Normal, Violation, Vacant) every 2 seconds.

### 4. View the Dashboard
Open your browser and visit:
http://localhost:3000

The dashboard displays:
- Real-time head-to-screen distance (cm)
- Sitting status indicator (NORMAL / VIOLATION / VACANT)
- Cumulative sitting duration
- Live Chart.js trend chart with a 20 cm warning threshold

## Hardware Telemetry API Reference

The MCU can report sensor readings using the following endpoint:

- Method: POST
- URL: http://<HOST_IP>:3000/api/telemetry
- Content-Type: application/json
- Payload Schema:
  {
    "distance_cm": 55.0,
    "status": "NORMAL",
    "sitting_duration_sec": 120
  }

```

## Sitting reports

The Aero dashboard has Today / This week reports, session totals, counts,
longest stretches, daily bars and gentle movement reminders. Settings include
viewing-distance calibration advice and a suggested reminder interval.

`GET /api/reports?period=day|week&time_zone=Asia%2FTokyo` returns seconds,
sessions and daily aggregates. The browser supplies its IANA time zone; direct
API requests default to UTC. Weeks start Monday. Cross-boundary sessions are
clipped to the requested period and count once per overlapping period.

The `sessions` table is created automatically in the existing database. Presence
starts a session and confirmed VACANT ends it, preserving the serial input's
10-second absence grace period. NORMAL/VIOLATION changes do not split sessions.
A signal gap over 15 seconds stops accumulation at the last observed reading;
resumed input starts a new session. Process restart closes interrupted records
at their last observed reading. Downtime is not inferred as sitting time.
History starts with this feature; old telemetry is not backfilled. Running
reports include fresh ongoing sessions. Summaries refresh every ten seconds.

### Verification

From `web/` after installing dependencies (browser tests require Node.js 20+):

- `npm test`: in-memory SQLite tests for transitions, gaps, restart, cross-day/
  cross-week allocation and daylight-saving boundaries.
- `npm run test:serial`: Python 3 / Unix PTY simulation through the real serial
  parser, including brief absence, 10-second confirmed departure and signal loss.
- `npm run test:browser`: Playwright checks for HTTP telemetry, report switching,
  empty/ongoing states, API validation, failure/retry and mobile layout. Install
  Chromium using `npx playwright install chromium` if needed, or set
  `CHROMIUM_PATH` to an installed browser. The test uses temporary databases.

Integration tests use ports 3101 and 3102. Normal startup remains `npm start`.
`DB_PATH` can select a separate SQLite file for development or simulations.
