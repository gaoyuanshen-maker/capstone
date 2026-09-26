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
