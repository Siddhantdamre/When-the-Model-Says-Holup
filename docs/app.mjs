import { allocateAlerts, parseAlertsCsv, routedCsv } from "./engine.mjs";

const SAMPLE = `id,title,score,severity,estimated_loss,review_minutes,label,source
SOC-1042,"Encoded PowerShell from finance laptop",0.97,critical,120000,18,true,EDR
SOC-1043,"Repeated failed logins followed by success",0.63,high,45000,12,true,Identity
SOC-1044,"Known vulnerability scanner traffic",0.06,low,500,5,false,Firewall
SOC-1045,"Unusual service-account access to backups",0.51,critical,180000,20,true,SIEM
SOC-1046,"New unsigned binary in temporary folder",0.74,high,70000,15,true,EDR
SOC-1047,"Noisy health-check endpoint",0.11,medium,1000,8,false,WAF
SOC-1048,"Impossible travel with managed VPN exit",0.42,high,30000,10,false,Identity
SOC-1049,"Outbound DNS burst to newly seen domain",0.58,critical,150000,18,true,DNS
SOC-1050,"Developer port scan in lab subnet",0.21,low,2000,8,false,NDR
SOC-1051,"Large encrypted upload after hours",0.82,high,95000,20,true,CASB
SOC-1052,"Endpoint agent temporarily offline",0.31,medium,8000,10,false,EDR
SOC-1053,"Credential-dumping signature match",0.95,critical,200000,15,true,EDR`;

const form = document.querySelector("#planner-form");
const csvInput = document.querySelector("#csv-input");
const emptyState = document.querySelector("#empty-state");
const resultsShell = document.querySelector("#results-shell");
let currentAllocation = null;
let currentFilter = "ALL";

function routeClass(route) {
  return route.toLowerCase();
}

function drawCurve(curve) {
  const canvas = document.querySelector("#curve");
  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const padding = { left: 50, right: 18, top: 18, bottom: 40 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#f8fafb";
  context.fillRect(0, 0, width, height);

  context.strokeStyle = "#d6dfe5";
  context.lineWidth = 1;
  context.fillStyle = "#667784";
  context.font = "11px Inter, sans-serif";
  for (let index = 0; index <= 4; index += 1) {
    const value = index / 4;
    const y = padding.top + plotHeight - (value * plotHeight);
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
    context.textAlign = "right";
    context.fillText(`${Math.round(value * 100)}%`, padding.left - 8, y + 4);
  }

  const maxBudget = Math.max(...curve.map((point) => point.budget), 1);
  context.beginPath();
  curve.forEach((point, index) => {
    const x = padding.left + ((point.budget / maxBudget) * plotWidth);
    const y = padding.top + plotHeight - (point.value * plotHeight);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.strokeStyle = "#117f8d";
  context.lineWidth = 3;
  context.stroke();

  context.fillStyle = "#117f8d";
  for (const point of curve) {
    const x = padding.left + ((point.budget / maxBudget) * plotWidth);
    const y = padding.top + plotHeight - (point.value * plotHeight);
    context.beginPath();
    context.arc(x, y, 3.5, 0, Math.PI * 2);
    context.fill();
  }

  context.fillStyle = "#445865";
  context.textAlign = "center";
  context.fillText("Human review budget (minutes)", padding.left + (plotWidth / 2), height - 10);
  context.save();
  context.translate(14, padding.top + (plotHeight / 2));
  context.rotate(-Math.PI / 2);
  context.fillText("Incident / expected-risk capture", 0, 0);
  context.restore();
}

function renderRows() {
  if (!currentAllocation) return;
  const rows = currentAllocation.rows
    .filter((alert) => currentFilter === "ALL" || alert.route === currentFilter)
    .sort((left, right) => (
      (left.queuePosition ?? 9999) - (right.queuePosition ?? 9999)
      || right.score - left.score
    ));
  document.querySelector("#alert-rows").replaceChildren(
    ...rows.map((alert) => {
      const row = document.createElement("tr");
      const values = [
        alert.queuePosition ?? "—",
        alert.title,
        alert.score.toFixed(2),
        alert.severity,
      ];
      for (const value of values) {
        const cell = document.createElement("td");
        cell.textContent = value;
        if (value === alert.severity) cell.className = "severity";
        row.append(cell);
      }
      const routeCell = document.createElement("td");
      const route = document.createElement("span");
      route.className = `route ${routeClass(alert.route)}`;
      route.textContent = alert.route;
      routeCell.append(route);
      row.append(routeCell);
      const review = document.createElement("td");
      review.textContent = `${alert.reviewMinutes} min`;
      row.append(review);
      const reason = document.createElement("td");
      reason.className = "reason";
      reason.textContent = alert.reason;
      row.append(reason);
      return row;
    }),
  );
}

function render(allocation) {
  currentAllocation = allocation;
  emptyState.classList.add("hidden");
  resultsShell.classList.remove("hidden");
  document.querySelector("#result-subtitle").textContent =
    `${allocation.alertCount} alerts | ${allocation.usedMinutes} of ${allocation.settings.minuteBudget} review minutes allocated`;
  document.querySelector("#metric-act").textContent = allocation.counts["AUTO-ACT"];
  document.querySelector("#metric-review").textContent = allocation.counts.ESCALATE;
  document.querySelector("#metric-monitor").textContent = allocation.counts.MONITOR;
  document.querySelector("#metric-close").textContent = allocation.counts["AUTO-CLOSE"];
  document.querySelector("#metric-budget").textContent =
    `${allocation.usedMinutes}/${allocation.settings.minuteBudget}m`;
  const mode = allocation.curve[0]?.mode === "observed" ? "observed labeled incidents" : "expected weighted risk";
  document.querySelector("#curve-note").textContent =
    `Curve reports ${mode}. Current unreviewed expected exposure: ${Math.round(allocation.expectedExposure).toLocaleString()}.`;
  drawCurve(allocation.curve);
  renderRows();
  resultsShell.scrollIntoView({ behavior: "smooth", block: "start" });
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const alerts = parseAlertsCsv(csvInput.value);
    render(allocateAlerts(alerts, {
      minuteBudget: document.querySelector("#budget").value,
      commitThreshold: document.querySelector("#act-threshold").value,
      closeThreshold: document.querySelector("#close-threshold").value,
    }));
  } catch (error) {
    window.alert(error instanceof Error ? error.message : "Could not allocate the alert budget.");
  }
});

document.querySelector("#example-button").addEventListener("click", () => {
  csvInput.value = SAMPLE;
  csvInput.focus();
});

document.querySelector("#csv-file").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (file) csvInput.value = await file.text();
});

document.querySelector("#tabs").addEventListener("click", (event) => {
  const button = event.target.closest("[data-route]");
  if (!button) return;
  currentFilter = button.dataset.route;
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab === button));
  renderRows();
});

document.querySelector("#download-button").addEventListener("click", () => {
  if (!currentAllocation) return;
  const blob = new Blob([routedCsv(currentAllocation)], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "holup-routed-alerts.csv";
  anchor.click();
  URL.revokeObjectURL(url);
});

csvInput.value = SAMPLE;
