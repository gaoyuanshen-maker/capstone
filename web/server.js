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

  insertReading(distance_cm, status, sitting_duration_sec, (error, id) => {
    if (error) {
      return response.status(500).json({ error: "Could not save telemetry." });
    }
    return response.status(201).json({ id });
  });
});

app.get("/api/latest", (request, response) => {
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
      console.log(
        "[settings] 准备发送给板子, distance:",
        distance_threshold_mm,
        "alert:",
        sitting_alert_minutes,
        "串口是否打开:",
        !!(serial && serial.isOpen),
      );
      if (serial && serial.isOpen) {
        serial.write(`SET:DIST=${distance_threshold_mm}\r\n`);
        serial.write(`SET:ALERT=${sitting_alert_minutes}\r\n`);
      }

      return response.json({ ok: true, settings: currentSettings });
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

let presentSinceMs = null;

function handleSerialLine(line) {
  const match = line.trim().match(/^DIST:(\d+),STATE:(PRESENT|AWAY)$/);
  if (!match) {
    console.warn(`[serial] 无法解析的数据行: "${line}"`);
    return;
  }

  const distance_mm = Number(match[1]);
  const deviceState = match[2];
  const distance_cm = Math.round((distance_mm / 10) * 10) / 10;

  let status;
  let sitting_duration_sec;

  if (deviceState === "AWAY") {
    status = "VACANT";
    presentSinceMs = null;
    sitting_duration_sec = 0;
  } else {
    if (presentSinceMs === null) {
      presentSinceMs = Date.now();
    }
    sitting_duration_sec = Math.floor((Date.now() - presentSinceMs) / 1000);
    const thresholdCm = currentSettings.distance_threshold_mm / 10;
    status = distance_cm < thresholdCm ? "VIOLATION" : "NORMAL";
  }

  insertReading(distance_cm, status, sitting_duration_sec, (error) => {
    if (error) {
      console.error("[serial] 写入数据库失败:", error.message);
    } else {
      console.log(
        `[serial] 收到: ${distance_cm}cm | ${status} | 坐了${sitting_duration_sec}秒`,
      );
    }
  });
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
    loadSettingsFromDb();
    app.listen(port, () => {
      console.log(`DeskSentry listening at http://localhost:${port}`);
    });
  },
);
