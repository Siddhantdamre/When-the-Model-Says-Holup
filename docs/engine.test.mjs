import assert from "node:assert/strict";
import test from "node:test";

import { allocateAlerts, parseAlertsCsv, routedCsv } from "./engine.mjs";

const CSV = `id,title,score,severity,estimated_loss,review_minutes,label
A-1,"Encoded PowerShell, suspicious",0.96,critical,80000,15,true
A-2,Repeated login failures,0.52,high,15000,10,true
A-3,Known scanner traffic,0.07,low,500,5,false
A-4,Unusual service account,0.48,critical,120000,20,true
A-5,Noisy health check,0.18,medium,1000,10,false`;

test("parses quoted CSV fields", () => {
  const alerts = parseAlertsCsv(CSV);
  assert.equal(alerts.length, 5);
  assert.equal(alerts[0].title, "Encoded PowerShell, suspicious");
});

test("never exceeds the human review budget", () => {
  const result = allocateAlerts(parseAlertsCsv(CSV), { minuteBudget: 20 });
  assert.ok(result.usedMinutes <= 20);
  assert.equal(result.unusedMinutes, 0);
});

test("routes highly confident incidents to auto-act", () => {
  const result = allocateAlerts(parseAlertsCsv(CSV), { minuteBudget: 10 });
  assert.equal(result.rows.find((alert) => alert.id === "A-1").route, "AUTO-ACT");
});

test("prioritizes uncertain high-impact alerts for review", () => {
  const result = allocateAlerts(parseAlertsCsv(CSV), { minuteBudget: 20 });
  assert.equal(result.rows.find((alert) => alert.id === "A-4").route, "ESCALATE");
});

test("budget curve is non-decreasing and export contains routes", () => {
  const result = allocateAlerts(parseAlertsCsv(CSV), { minuteBudget: 20 });
  for (let index = 1; index < result.curve.length; index += 1) {
    assert.ok(result.curve[index].value >= result.curve[index - 1].value);
  }
  assert.match(routedCsv(result), /AUTO-ACT/);
  assert.match(routedCsv(result), /ESCALATE/);
});
