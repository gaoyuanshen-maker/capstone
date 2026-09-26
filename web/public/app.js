const distanceValue = document.getElementById("distance-value");
const distanceHint = document.getElementById("distance-hint");
const statusBadge = document.getElementById("status-badge");
const statusDot = document.getElementById("status-dot");
const statusValue = document.getElementById("status-value");
const durationValue = document.getElementById("duration-value");
const lastUpdated = document.getElementById("last-updated");
const connectionDot = document.getElementById("connection-dot");
const connectionLabel = document.getElementById("connection-label");

const chart = new Chart(document.getElementById("distance-chart"), {
  type: "line",
  data: {
    labels: [],
    datasets: [
      {
        label: "Distance",
        data: [],
        borderColor: "#16845b",
        backgroundColor: "rgb(22 132 91 / 10%)",
        borderWidth: 2.5,
        pointRadius: 2.5,
        pointHoverRadius: 5,
        pointBackgroundColor: "#16845b",
        fill: true,
        tension: 0.35,
      },
    ],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 450 },
    interaction: { intersect: false, mode: "index" },
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (context) => ` ${context.parsed.y} cm` } },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { maxTicksLimit: 7, maxRotation: 0, color: "#64748b" },
        border: { display: false },
      },
      y: {
        beginAtZero: true,
        suggestedMax: 140,
        title: { display: true, text: "Distance (cm)", color: "#64748b" },
        ticks: { color: "#64748b" },
        grid: { color: "#e9eeeb" },
        border: { display: false },
      },
    },
  },
  plugins: [
    {
      id: "safetyThreshold",
      afterDraw(currentChart) {
        const yScale = currentChart.scales.y;
        const y = yScale.getPixelForValue(20);
        const { left, right } = currentChart.chartArea;
        const context = currentChart.ctx;
        context.save();
        context.beginPath();
        context.setLineDash([6, 5]);
        context.strokeStyle = "#dc2626";
        context.lineWidth = 1.5;
        context.moveTo(left, y);
        context.lineTo(right, y);
        context.stroke();
        context.restore();
      },
    },
  ],
});

function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatTime(timestamp) {
  return new Date(`${timestamp.replace(" ", "T")}Z`).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function setConnection(isOnline) {
  connectionDot.className = `h-2 w-2 rounded-full ${isOnline ? "bg-emerald-500" : "bg-red-500"}`;
  connectionLabel.textContent = isOnline ? "Live" : "Disconnected";
}

function renderReading(reading) {
  if (!reading) return;

  const isViolation =
    reading.status === "VIOLATION" || reading.distance_cm < 20;
  const statusStyles = {
    NORMAL: ["bg-emerald-50 text-emerald-700", "bg-emerald-500"],
    VIOLATION: ["bg-red-50 text-red-700", "bg-red-500"],
    VACANT: ["bg-slate-100 text-slate-600", "bg-slate-400"],
  };
  const [badgeStyle, dotStyle] =
    statusStyles[reading.status] ?? statusStyles.VACANT;

  distanceValue.textContent = Number(reading.distance_cm).toFixed(1);
  distanceValue.className = `text-5xl font-semibold tabular-nums tracking-tight ${isViolation ? "text-red-600" : "text-emerald-700"}`;
  distanceHint.textContent = isViolation
    ? "Below the 20 cm safety limit"
    : "Maintain a comfortable viewing distance";
  statusBadge.className = `inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold ${badgeStyle} ${reading.status === "VIOLATION" ? "violation-pulse" : ""}`;
  statusDot.className = `h-2 w-2 rounded-full ${dotStyle}`;
  statusValue.textContent = reading.status;
  durationValue.textContent = formatDuration(reading.sitting_duration_sec);
  lastUpdated.textContent = `Updated ${formatTime(reading.timestamp)}`;
}

function addChartReading(reading) {
  chart.data.labels.push(formatTime(reading.timestamp));
  chart.data.datasets[0].data.push(Number(reading.distance_cm));

  if (chart.data.labels.length > 30) {
    chart.data.labels.shift();
    chart.data.datasets[0].data.shift();
  }

  chart.update("none");
}

async function loadHistory() {
  const response = await fetch("/api/trends");
  if (!response.ok) throw new Error("Could not load trend history.");
  const readings = await response.json();

  chart.data.labels = readings.map((reading) => formatTime(reading.timestamp));
  chart.data.datasets[0].data = readings.map((reading) =>
    Number(reading.distance_cm),
  );
  chart.update("none");
  if (readings.length > 0) renderReading(readings[readings.length - 1]);
  return readings.at(-1)?.id ?? null;
}

let latestId = null;

async function refreshLatest() {
  try {
    const response = await fetch("/api/latest");
    if (!response.ok) throw new Error("Could not load latest telemetry.");
    const reading = await response.json();
    setConnection(true);

    if (reading) {
      renderReading(reading);
      if (reading.id !== latestId) {
        addChartReading(reading);
        latestId = reading.id;
      }
    }
  } catch (error) {
    setConnection(false);
    console.error(error);
  }
}

async function startDashboard() {
  try {
    latestId = await loadHistory();
  } catch (error) {
    setConnection(false);
    console.error(error);
  }

  await refreshLatest();
  window.setInterval(refreshLatest, 2000);
}

startDashboard();
