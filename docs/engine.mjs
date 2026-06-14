const SEVERITY_WEIGHT = {
  critical: 5,
  high: 3,
  medium: 1.8,
  low: 1,
};

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  const input = String(text ?? "").replace(/\r\n?/g, "\n");

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(value);
      value = "";
    } else if (character === "\n") {
      row.push(value);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }
  row.push(value);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

function numberValue(raw, fallback) {
  const parsed = Number(String(raw ?? "").trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function probability(raw) {
  let value = numberValue(raw, Number.NaN);
  if (!Number.isFinite(value)) throw new Error(`Invalid score: ${raw}`);
  if (value > 1 && value <= 100) value /= 100;
  if (value < 0 || value > 1) throw new Error(`Score must be between 0 and 1 (or 0 and 100): ${raw}`);
  return value;
}

function optionalLabel(raw) {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return null;
  if (["1", "true", "yes", "incident", "malicious", "positive"].includes(value)) return true;
  if (["0", "false", "no", "benign", "negative"].includes(value)) return false;
  return null;
}

export function parseAlertsCsv(text) {
  const rows = parseCsvRows(text);
  if (rows.length < 2) throw new Error("CSV must include a header and at least one alert.");
  const headers = rows[0].map((value) => value.trim().toLowerCase().replace(/\s+/g, "_"));
  const required = ["id", "score"];
  for (const header of required) {
    if (!headers.includes(header)) throw new Error(`CSV is missing required column: ${header}`);
  }

  return rows.slice(1).map((row, index) => {
    const record = Object.fromEntries(headers.map((header, column) => [header, row[column] ?? ""]));
    const severity = String(record.severity || "medium").trim().toLowerCase();
    const reviewMinutes = Math.max(1, numberValue(record.review_minutes, 10));
    const estimatedLoss = Math.max(1, numberValue(record.estimated_loss, 1000));
    return {
      id: String(record.id || `alert-${index + 1}`).trim(),
      title: String(record.title || record.description || "Untitled alert").trim(),
      score: probability(record.score),
      severity: SEVERITY_WEIGHT[severity] ? severity : "medium",
      estimatedLoss,
      reviewMinutes,
      label: optionalLabel(record.label),
      source: String(record.source || "").trim(),
    };
  });
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function reviewPriority(alert) {
  const uncertainty = 1 - Math.abs((2 * alert.score) - 1);
  const severity = SEVERITY_WEIGHT[alert.severity];
  const impact = Math.log10(alert.estimatedLoss + 10);
  const incidentPressure = 0.35 + alert.score;
  const benefit = uncertainty * severity * impact * incidentPressure;
  return {
    benefit,
    valuePerMinute: benefit / alert.reviewMinutes,
  };
}

function routeCandidates(alerts, settings) {
  return alerts.map((alert) => {
    if (alert.score >= settings.commitThreshold) {
      return {
        ...alert,
        route: "AUTO-ACT",
        reviewValue: 0,
        reason: `Score ${alert.score.toFixed(2)} meets the auto-act threshold.`,
      };
    }
    if (alert.score <= settings.closeThreshold && alert.severity !== "critical") {
      return {
        ...alert,
        route: "AUTO-CLOSE",
        reviewValue: 0,
        reason: `Score ${alert.score.toFixed(2)} is below the close threshold.`,
      };
    }
    const priority = reviewPriority(alert);
    return {
      ...alert,
      route: "CANDIDATE",
      reviewBenefit: priority.benefit,
      reviewValue: priority.valuePerMinute,
      reason: "Uncertain alert ranked by impact, severity, and review time.",
    };
  });
}

function allocateReview(candidates, minuteBudget) {
  const ranked = candidates
    .filter((alert) => alert.route === "CANDIDATE")
    .sort((left, right) => (
      right.reviewValue - left.reviewValue
      || SEVERITY_WEIGHT[right.severity] - SEVERITY_WEIGHT[left.severity]
      || right.score - left.score
    ));

  let selected = new Set();
  const integerBudget = Math.floor(minuteBudget);
  if (ranked.length <= 250 && integerBudget <= 2000) {
    const best = Array.from({ length: integerBudget + 1 }, () => null);
    best[0] = { benefit: 0, ids: [] };
    for (const alert of ranked) {
      const cost = Math.max(1, Math.ceil(alert.reviewMinutes));
      for (let budget = integerBudget; budget >= cost; budget -= 1) {
        const previous = best[budget - cost];
        if (!previous) continue;
        const candidateBenefit = previous.benefit + alert.reviewBenefit;
        if (!best[budget] || candidateBenefit > best[budget].benefit) {
          best[budget] = {
            benefit: candidateBenefit,
            ids: [...previous.ids, alert.id],
          };
        }
      }
    }
    const winner = best.reduce(
      (current, state) => state && (!current || state.benefit > current.benefit) ? state : current,
      null,
    );
    selected = new Set(winner?.ids ?? []);
  } else {
    let greedyRemaining = minuteBudget;
    for (const alert of ranked) {
      if (alert.reviewMinutes <= greedyRemaining) {
        selected.add(alert.id);
        greedyRemaining -= alert.reviewMinutes;
      }
    }
  }

  const used = candidates
    .filter((alert) => selected.has(alert.id))
    .reduce((sum, alert) => sum + alert.reviewMinutes, 0);
  const remaining = Math.max(0, minuteBudget - used);
  return {
    remaining,
    rows: candidates.map((alert) => {
      if (alert.route !== "CANDIDATE") return alert;
      if (selected.has(alert.id)) {
        return {
          ...alert,
          route: "ESCALATE",
          reason: "Allocated to the human queue within the current review-time budget.",
        };
      }
      return {
        ...alert,
        route: "MONITOR",
        reason: "Not selected within this review-time budget; retain for monitoring.",
      };
    }),
  };
}

function captured(alert) {
  return alert.route === "AUTO-ACT" || alert.route === "ESCALATE";
}

function curve(alerts, settings, maximumBudget) {
  const hasLabels = alerts.some((alert) => alert.label !== null);
  const step = maximumBudget <= 60 ? 5 : maximumBudget <= 240 ? 15 : 30;
  const points = [];
  for (let budget = 0; budget <= maximumBudget; budget += step) {
    const allocation = allocateReview(routeCandidates(alerts, settings), budget).rows;
    if (hasLabels) {
      const positives = allocation.filter((alert) => alert.label === true);
      const caught = positives.filter(captured).length;
      points.push({
        budget,
        value: positives.length ? caught / positives.length : 0,
        mode: "observed",
      });
    } else {
      const totalRisk = allocation.reduce(
        (sum, alert) => sum + (alert.score * alert.estimatedLoss * SEVERITY_WEIGHT[alert.severity]),
        0,
      );
      const capturedRisk = allocation.filter(captured).reduce(
        (sum, alert) => sum + (alert.score * alert.estimatedLoss * SEVERITY_WEIGHT[alert.severity]),
        0,
      );
      points.push({
        budget,
        value: totalRisk ? capturedRisk / totalRisk : 0,
        mode: "expected",
      });
    }
  }
  return points;
}

export function allocateAlerts(alerts, rawSettings = {}) {
  if (!alerts.length) throw new Error("Add at least one alert.");
  const settings = {
    minuteBudget: Math.max(0, numberValue(rawSettings.minuteBudget, 60)),
    commitThreshold: probability(rawSettings.commitThreshold ?? 0.92),
    closeThreshold: probability(rawSettings.closeThreshold ?? 0.08),
  };
  if (settings.closeThreshold >= settings.commitThreshold) {
    throw new Error("Close threshold must be lower than the auto-act threshold.");
  }

  const routed = routeCandidates(alerts, settings);
  const { rows, remaining } = allocateReview(routed, settings.minuteBudget);
  const reviewQueue = rows
    .filter((alert) => alert.route === "ESCALATE")
    .sort((left, right) => right.reviewValue - left.reviewValue)
    .map((alert, index) => ({ ...alert, queuePosition: index + 1 }));
  const queueById = new Map(reviewQueue.map((alert) => [alert.id, alert]));
  const finalRows = rows.map((alert) => queueById.get(alert.id) ?? alert);
  const usedMinutes = settings.minuteBudget - remaining;
  const labeledPositives = finalRows.filter((alert) => alert.label === true);
  const caughtPositives = labeledPositives.filter(captured).length;
  const expectedExposure = finalRows
    .filter((alert) => !captured(alert))
    .reduce(
      (sum, alert) => sum + (alert.score * alert.estimatedLoss * SEVERITY_WEIGHT[alert.severity]),
      0,
    );

  return {
    generatedAt: new Date().toISOString(),
    settings,
    alertCount: finalRows.length,
    usedMinutes,
    unusedMinutes: remaining,
    counts: Object.fromEntries(
      ["AUTO-ACT", "ESCALATE", "MONITOR", "AUTO-CLOSE"].map((route) => [
        route,
        finalRows.filter((alert) => alert.route === route).length,
      ]),
    ),
    observedIncidentCapture: labeledPositives.length
      ? round(caughtPositives / labeledPositives.length)
      : null,
    expectedExposure: round(expectedExposure, 2),
    rows: finalRows,
    curve: curve(alerts, settings, Math.max(settings.minuteBudget * 2, 120)),
  };
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function routedCsv(allocation) {
  const headers = [
    "id", "title", "score", "severity", "route", "queue_position",
    "review_minutes", "estimated_loss", "review_value", "reason",
  ];
  const lines = allocation.rows.map((alert) => [
    alert.id,
    alert.title,
    alert.score,
    alert.severity,
    alert.route,
    alert.queuePosition ?? "",
    alert.reviewMinutes,
    alert.estimatedLoss,
    round(alert.reviewValue, 5),
    alert.reason,
  ].map(csvCell).join(","));
  return [headers.join(","), ...lines].join("\n");
}
