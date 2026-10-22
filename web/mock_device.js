// 模拟板子:默认每 0.1 秒发一条(10 Hz),和 VL53L0X 连续测距的节奏一样
// 改频率: node mock_device.js --hz=0.5  (0.5 Hz = 每 2 秒一条)
const hzArg = process.argv.find((arg) => arg.startsWith("--hz="));
const hz = Number(hzArg?.split("=")[1]) || 10;
const port = Number(process.env.PORT) || 3000;
const endpoint = `http://localhost:${port}/api/telemetry`;
const intervalMs = 1000 / hz;
const scenarioMs = 16000;
const scenarios = ["NORMAL", "VIOLATION", "VACANT"];
const startMs = Date.now();
let seatedSinceMs = null;
let distanceCm = 55;
let lastLogMs = 0;

function createReading() {
  const now = Date.now();
  const scenario =
    scenarios[Math.floor((now - startMs) / scenarioMs) % scenarios.length];
  const target = { NORMAL: 55, VIOLATION: 15, VACANT: 140 }[scenario];

  // 平滑地靠近目标距离,再加一点传感器噪声
  distanceCm += (target - distanceCm) * Math.min(1, 0.6 / hz) +
    (Math.random() - 0.5) * 0.8;
  const distance_cm = Math.round(distanceCm * 10) / 10;

  if (scenario === "VACANT") {
    seatedSinceMs = null;
  } else if (seatedSinceMs === null) {
    seatedSinceMs = now;
  }
  const sitting_duration_sec =
    seatedSinceMs === null ? 0 : Math.floor((now - seatedSinceMs) / 1000);

  return { distance_cm, status: scenario, sitting_duration_sec };
}

async function sendReading() {
  const reading = createReading();

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reading),
    });

    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
    }

    // 最多每秒打印一行
    if (Date.now() - lastLogMs >= 1000) {
      lastLogMs = Date.now();
      console.log(
        `[${new Date().toLocaleTimeString()}] ${reading.status} | ${reading.distance_cm} cm | seated ${reading.sitting_duration_sec}s`,
      );
    }
  } catch (error) {
    if (Date.now() - lastLogMs < 1000) return;
    lastLogMs = Date.now();
    console.error(
      `[${new Date().toLocaleTimeString()}] Could not send telemetry: ${error.message}`,
    );
  }
}

console.log(`Sending mock telemetry to ${endpoint} at ${hz} Hz`);
sendReading();
setInterval(sendReading, intervalMs);
