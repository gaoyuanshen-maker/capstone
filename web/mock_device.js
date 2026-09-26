const endpoint = "http://localhost:3000/api/telemetry";
const intervalMs = 2000;
const scenarioLength = 8;
const scenarios = ["NORMAL", "VIOLATION", "VACANT"];
let readingCount = 0;
let sittingDurationSec = 0;

function createReading() {
  const scenario =
    scenarios[Math.floor(readingCount / scenarioLength) % scenarios.length];
  let distance_cm;
  let status = scenario;

  if (scenario === "NORMAL") {
    distance_cm = Math.round((45 + Math.random() * 20) * 10) / 10;
    sittingDurationSec += intervalMs / 1000;
  } else if (scenario === "VIOLATION") {
    distance_cm = Math.round((12 + Math.random() * 6) * 10) / 10;
    sittingDurationSec += intervalMs / 1000;
  } else {
    distance_cm = Math.round((121 + Math.random() * 39) * 10) / 10;
  }

  readingCount += 1;
  return { distance_cm, status, sitting_duration_sec: sittingDurationSec };
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

    console.log(
      `[${new Date().toLocaleTimeString()}] ${reading.status} | ${reading.distance_cm} cm | seated ${reading.sitting_duration_sec}s`,
    );
  } catch (error) {
    console.error(
      `[${new Date().toLocaleTimeString()}] Could not send telemetry: ${error.message}`,
    );
  }
}

console.log(
  `Sending mock telemetry to ${endpoint} every ${intervalMs / 1000}s`,
);
sendReading();
setInterval(sendReading, intervalMs);
