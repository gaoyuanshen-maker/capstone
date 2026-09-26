const path = require("node:path");
const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const port = Number(process.env.PORT) || 3000;
const databasePath = path.join(__dirname, "desksentry.db");
const database = new sqlite3.Database(databasePath);

app.use(cors());
app.use(express.json());

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

  database.run(
    "INSERT INTO readings (distance_cm, status, sitting_duration_sec) VALUES (?, ?, ?)",
    [distance_cm, status, sitting_duration_sec],
    function (error) {
      if (error) {
        return response
          .status(500)
          .json({ error: "Could not save telemetry." });
      }
      return response.status(201).json({ id: this.lastID });
    },
  );
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

app.use(express.static(path.join(__dirname, "public")));

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

    app.listen(port, () => {
      console.log(`DeskSentry listening at http://localhost:${port}`);
    });
  },
);
