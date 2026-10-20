const path = require("node:path");
const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const { SerialPort } = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");

const app = express();
const port = Number(process.env.PORT) || 3000;
const databasePath = path.join(__dirname, "desksentry.db");
const database = new sqlite3.Database(databasePath);

app.use(cors());
app.use(express.json());

// ==================== 共用的写入函数 ====================
function insertReading(distance_cm, status, sitting_duration_sec, callback) {
  database.run(
    "INSERT INTO readings (distance_cm, status, sitting_duration_sec) VALUES (?, ?, ?)",
    [distance_cm, status, sitting_duration_sec],
    function (error) {
      if (callback) callback(error, this?.lastID);
    },
  );
}

// ==================== 实时数据(板子可能 0.1 秒一条)====================
// 每条读数都实时推给网页;数据库最多每秒存一条(状态变化时也存),避免数据库暴涨
const RECENT_WINDOW_MS = 60 * 1000; // 内存里保留最近 60 秒,给网页图表用
const STORE_INTERVAL_MS = 1000;
const RATE_WINDOW_MS = 5000;

let readingSeq = 0;
let recentReadings = [];
let lastStoredMs = 0;
let lastStoredStatus = null;
const streamClients = new Set();

// seated_since: 这次坐下的时间(毫秒),网页用它平滑地显示坐了多久
function ingestReading(distance_cm, status, sitting_duration_sec, seated_since) {
  const ts = Date.now();
  const reading = {
    seq: ++readingSeq,
    ts,
    distance_cm,
    status,
    sitting_duration_sec,
    seated_since:
      status === "VACANT"
        ? null
        : (seated_since ?? ts - sitting_duration_sec * 1000),
  };

  recentReadings.push(reading);
  while (recentReadings[0].ts < ts - RECENT_WINDOW_MS) recentReadings.shift();

  const message = `data: ${JSON.stringify(reading)}\n\n`;
  for (const client of streamClients) client.write(message);

  const store =
    ts - lastStoredMs >= STORE_INTERVAL_MS || status !== lastStoredStatus;
  if (store) {
    lastStoredMs = ts;
    lastStoredStatus = status;
    insertReading(distance_cm, status, sitting_duration_sec, (error) => {
      if (error) console.error("[data] 写入数据库失败:", error.message);
    });
  }
  return { reading, stored: store };
}

// 最近 5 秒内平均每秒收到几条
function dataRateHz() {
  const now = Date.now();
  const times = recentReadings
    .filter((r) => r.ts >= now - RATE_WINDOW_MS)
    .map((r) => r.ts);
  if (times.length < 2 || now - times.at(-1) > 3000) return 0;
  const spanSec = (times.at(-1) - times[0]) / 1000;
  return Math.round(((times.length - 1) / spanSec) * 10) / 10;
}

const toApiReading = (row) => ({
  ...row,
  ts: Date.parse(`${row.timestamp.replace(" ", "T")}Z`),
});

app.post("/api/telemetry", (request, response) => {
  const { distance_cm, status, sitting_duration_sec } = request.body ?? {};
  const validStatuses = new Set(["NORMAL", "VIOLATION", "VACANT"]);

  if (
    typeof distance_cm !== "number" ||
    !Number.isFinite(distance_cm) ||
    typeof sitting_duration_sec !== "number" ||
    !Number.isInteger(sitting_duration_sec) ||
    sitting_duration_sec < 0 ||
    !validStatuses.has(status)
  ) {
    return response.status(400).json({ error: "Invalid telemetry payload." });
  }

  const { reading, stored } = ingestReading(
    distance_cm,
    status,
    sitting_duration_sec,
  );
  return response.status(201).json({ seq: reading.seq, stored });
});

// 实时推送(Server-Sent Events):每收到一条读数就推给网页
app.get("/api/stream", (request, response) => {
  response.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  response.flushHeaders();
  response.write("retry: 2000\n\n");
  streamClients.add(response);
  request.on("close", () => streamClients.delete(response));
});
setInterval(() => {
  for (const client of streamClients) client.write(": ping\n\n");
}, 15000);

// 最近 60 秒的读数;服务器刚启动内存里没有时,从数据库取最后 60 秒
app.get("/api/recent", (request, response) => {
  if (recentReadings.length) return response.json(recentReadings);
  database.all(
    `SELECT * FROM readings
     WHERE timestamp >= (SELECT datetime(MAX(timestamp), '-60 seconds') FROM readings)
     ORDER BY id ASC`,
    (error, rows) => {
      if (error) {
        return response
          .status(500)
          .json({ error: "Could not read recent telemetry." });
      }
      return response.json(rows.map(toApiReading));
    },
  );
});

app.get("/api/latest", (request, response) => {
  if (recentReadings.length) return response.json(recentReadings.at(-1));
  database.get(
    "SELECT * FROM readings ORDER BY id DESC LIMIT 1",
    (error, row) => {
      if (error) {
        return response
          .status(500)
          .json({ error: "Could not read latest telemetry." });
      }
      return response.json(row ?? null);
    },
  );
});

app.get("/api/trends", (request, response) => {
  database.all(
    `SELECT * FROM (
       SELECT * FROM readings ORDER BY id DESC LIMIT 30
     ) ORDER BY timestamp ASC, id ASC`,
    (error, rows) => {
      if (error) {
        return response
          .status(500)
          .json({ error: "Could not read telemetry trends." });
      }
      return response.json(rows);
    },
  );
});
app.get("/api/settings", (request, response) => {
  response.json(currentSettings);
});

app.post("/api/settings", (request, response) => {
  const { distance_threshold_mm, sitting_alert_minutes } = request.body ?? {};

  if (
    typeof distance_threshold_mm !== "number" ||
    !Number.isInteger(distance_threshold_mm) ||
    distance_threshold_mm < 50 ||
    distance_threshold_mm > 2000 ||
    typeof sitting_alert_minutes !== "number" ||
    !Number.isInteger(sitting_alert_minutes) ||
    sitting_alert_minutes < 1 ||
    sitting_alert_minutes > 600
  ) {
    return response.status(400).json({ error: "Invalid settings payload." });
  }

  database.run(
    `INSERT INTO settings (id, distance_threshold_mm, sitting_alert_minutes)
     VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       distance_threshold_mm = excluded.distance_threshold_mm,
       sitting_alert_minutes = excluded.sitting_alert_minutes`,
    [distance_threshold_mm, sitting_alert_minutes],
    (error) => {
      if (error) {
        return response.status(500).json({ error: "Could not save settings." });
      }

      currentSettings.distance_threshold_mm = distance_threshold_mm;
      currentSettings.sitting_alert_minutes = sitting_alert_minutes;
      const sent_to_board = sendSettingsToBoard();

      return response.json({
        ok: true,
        settings: currentSettings,
        sent_to_board,
      });
    },
  );
});

app.get("/api/status", (request, response) => {
  response.json({
    serial_open: !!(serial && serial.isOpen),
    serial_path: SERIAL_PORT_PATH,
    data_hz: dataRateHz(),
  });
});

// 今天(本地时间)的统计
app.get("/api/stats", (request, response) => {
  database.get(
    `SELECT COUNT(*) AS readings,
            SUM(status = 'VIOLATION') AS violations,
            SUM(status != 'VACANT') AS present,
            AVG(CASE WHEN status != 'VACANT' THEN distance_cm END) AS avg_distance_cm
     FROM readings
     WHERE date(timestamp, 'localtime') = date('now', 'localtime')`,
    (error, row) => {
      if (error) {
        return response.status(500).json({ error: "Could not read stats." });
      }
      return response.json({
        readings: row.readings ?? 0,
        violations: row.violations ?? 0,
        present: row.present ?? 0,
        avg_distance_cm: row.avg_distance_cm,
      });
    },
  );
});
app.use(express.static(path.join(__dirname, "public")));

// ==================== 串口监听（真实硬件数据）====================
const SERIAL_PORT_PATH =
  process.env.SERIAL_PORT || "/dev/tty.usbserial-B003R20K";
const SERIAL_BAUD_RATE = 115200;
// 删除原来的: const VIOLATION_DISTANCE_CM = 20;

// 换成这个,表示"网页当前用的设置",启动时先给个默认值
let currentSettings = {
  distance_threshold_mm: 250,
  sitting_alert_minutes: 30,
};

function loadSettingsFromDb(callback) {
  database.get("SELECT * FROM settings WHERE id = 1", (error, row) => {
    if (!error && row) {
      currentSettings.distance_threshold_mm = row.distance_threshold_mm;
      currentSettings.sitting_alert_minutes = row.sitting_alert_minutes;
    }
    if (callback) callback();
  });
}

// 把当前设置通过串口发给板子,返回是否真的发出去了
function sendSettingsToBoard() {
  const isOpen = !!(serial && serial.isOpen);
  console.log(
    "[settings] 发送给板子, distance:",
    currentSettings.distance_threshold_mm,
    "alert:",
    currentSettings.sitting_alert_minutes,
    "串口是否打开:",
    isOpen,
  );
  if (!isOpen) return false;
  serial.write(`SET:DIST=${currentSettings.distance_threshold_mm}\r\n`);
  setTimeout(() => {
    serial.write(`SET:ALERT=${currentSettings.sitting_alert_minutes * 60}\r\n`);
  }, 100);
  return true;
}

// 高频读数会有噪声,两处防抖:
// 1. 已经是 VIOLATION 时,要退到阈值 + 1cm 以外才算恢复 NORMAL,避免在阈值附近来回跳
// 2. 板子报 AWAY 要持续 1 秒才算离开,偶尔一两条误读不会把坐姿计时清零
const HYSTERESIS_CM = 1;
const AWAY_GRACE_MS = 1000;

let presentSinceMs = null;
let awaySinceMs = null;
let presentStatus = "NORMAL";
let lastPresentDistanceCm = null;
let lastLogMs = 0;

function handleSerialLine(line) {
  const match = line.trim().match(/^DIST:(\d+),STATE:(PRESENT|AWAY)$/);
  if (!match) {
    console.warn(`[serial] 无法解析的数据行: "${line}"`);
    return;
  }

  const distance_mm = Number(match[1]);
  const deviceState = match[2];
  let distance_cm = Math.round((distance_mm / 10) * 10) / 10;
  const now = Date.now();

  let status;
  let sitting_duration_sec;

  if (deviceState === "AWAY") {
    if (awaySinceMs === null) awaySinceMs = now;
  } else {
    awaySinceMs = null;
  }

  if (
    deviceState === "AWAY" &&
    (presentSinceMs === null || now - awaySinceMs >= AWAY_GRACE_MS)
  ) {
    status = "VACANT";
    presentSinceMs = null;
    presentStatus = "NORMAL";
    lastPresentDistanceCm = null;
    sitting_duration_sec = 0;
  } else {
    if (presentSinceMs === null) {
      presentSinceMs = now;
    }
    sitting_duration_sec = Math.floor((now - presentSinceMs) / 1000);
    if (deviceState === "PRESENT") {
      const thresholdCm = currentSettings.distance_threshold_mm / 10;
      const limit =
        presentStatus === "VIOLATION" ? thresholdCm + HYSTERESIS_CM : thresholdCm;
      presentStatus = distance_cm < limit ? "VIOLATION" : "NORMAL";
      lastPresentDistanceCm = distance_cm;
    } else if (lastPresentDistanceCm !== null) {
      // AWAY 还没满 1 秒:沿用上一个正常距离(超量程时传感器会报 8190mm 之类的值)
      distance_cm = lastPresentDistanceCm;
    }
    // AWAY 还没满 1 秒时保持上一个坐姿状态
    status = presentStatus;
  }

  ingestReading(distance_cm, status, sitting_duration_sec, presentSinceMs);

  // 终端最多每秒打印一行,不然 0.1 秒一条会刷屏
  if (now - lastLogMs >= 1000) {
    lastLogMs = now;
    console.log(
      `[serial] 收到: ${distance_cm}cm | ${status} | 坐了${sitting_duration_sec}秒 | ${dataRateHz()} Hz`,
    );
  }
}
let serial;
try {
  serial = new SerialPort({
    path: SERIAL_PORT_PATH,
    baudRate: SERIAL_BAUD_RATE,
  });
  const parser = serial.pipe(new ReadlineParser({ delimiter: "\r\n" }));

  serial.on("open", () => {
    console.log(`[serial] 已连接硬件: ${SERIAL_PORT_PATH}`);
    // 板子重启/重新插上后,把网页保存的设置重新发一遍
    sendSettingsToBoard();
  });

  serial.on("error", (error) => {
    console.warn(
      `[serial] 串口错误（硬件没接也没关系，不影响网页）: ${error.message}`,
    );
  });

  parser.on("data", handleSerialLine);
} catch (error) {
  console.warn(`[serial] 无法打开串口: ${error.message}`);
}

// ==================== 建表+启动服务器 ====================
database.run(
  `CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY,
    distance_threshold_mm INTEGER NOT NULL DEFAULT 250,
    sitting_alert_minutes INTEGER NOT NULL DEFAULT 30
  )`,
  (error) => {
    if (error) {
      console.error("Could not initialize settings table:", error.message);
    }
  },
);
database.run(
  `CREATE TABLE IF NOT EXISTS readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    distance_cm REAL,
    status TEXT,
    sitting_duration_sec INTEGER
  )`,
  (error) => {
    if (error) {
      console.error("Could not initialize database:", error.message);
      process.exitCode = 1;
      return;
    }
    // 串口可能比数据库先打开,读到设置后再同步一次
    loadSettingsFromDb(sendSettingsToBoard);
    app.listen(port, () => {
      console.log(`DeskSentry listening at http://localhost:${port}`);
    });
  },
);
