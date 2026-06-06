/**
 * Real-world Graph ON/OFF Experiment
 *
 * 14 functions in a realistic order management system.
 * 10 real business tasks — compare Graph OFF vs ON.
 */

import * as fs from "fs";
import { selectCapabilityChains, formatChainHint } from "../src/strategy-planner";

const ir = JSON.parse(fs.readFileSync("ir.json", "utf-8")).functions || [];
console.log(`IR: ${ir.length} real functions\n`);

const TASKS = [
  // Order workflow
  { intent: "create an order for a user and process payment", expected: ["createOrder", "processPayment"] },
  { intent: "find user by email then list their orders", expected: ["findUserByEmail", "getOrdersByUser"] },
  { intent: "calculate total revenue from completed orders", expected: ["calculateRevenue"] },
  // User management
  { intent: "create a new admin user and validate their role", expected: ["createUser", "validateUserRole"] },
  { intent: "list all users with admin role", expected: ["listUsersByRole"] },
  // Payment
  { intent: "process a payment then refund it", expected: ["processPayment", "refundPayment"] },
  { intent: "get all payments for a specific order", expected: ["getOrderPayments"] },
  // Notification
  { intent: "send a notification to a user after order is created", expected: ["sendNotification", "createOrder"] },
  { intent: "mark all notifications as read for a user", expected: ["markAsRead"] },
  // Cross-module
  { intent: "create user, create order, process payment, send notification", expected: ["createUser", "createOrder", "processPayment", "sendNotification"] },
];

console.log(`Tasks: ${TASKS.length}\n`);

let offScore = 0, onScore = 0, offHits = 0, onHits = 0, offLen = 0, onLen = 0;

for (const t of TASKS) {
  // Graph OFF: keyword-only
  const kw = t.intent.toLowerCase().split(/[\s,]+/);
  const offCandidates = ir.filter((f: any) => f.exported !== false)
    .filter((f: any) => kw.some(k => f.name.toLowerCase().includes(k) || (f.purpose || "").toLowerCase().includes(k)))
    .sort((a: any, b: any) => {
      const aHits = kw.filter((k: string) => a.name.toLowerCase().includes(k)).length;
      const bHits = kw.filter((k: string) => b.name.toLowerCase().includes(k)).length;
      return bHits - aHits;
    });

  // Graph ON: capability chains
  const { chains } = selectCapabilityChains(t.intent, ir, 3);
  const onNodes = new Set<string>();
  for (const c of chains) for (const n of c.nodes) onNodes.add(n.name);

  // Check expected functions
  const offNames = offCandidates.slice(0, 5).map((f: any) => f.name);
  const onNames = [...onNodes];
  const offHitsExpected = t.expected.filter(fn => offNames.some(n => n.includes(fn) || fn.includes(n)));
  const onHitsExpected = t.expected.filter(fn => onNames.some(n => n.includes(fn) || fn.includes(n)));

  const offOk = offHitsExpected.length >= t.expected.length * 0.5;
  const onOk = onHitsExpected.length >= t.expected.length * 0.5;

  console.log(`${t.intent.slice(0, 45).padEnd(47)} OFF:${offHitsExpected.length}/${t.expected.length} ON:${onHitsExpected.length}/${t.expected.length} ${onHitsExpected.length > offHitsExpected.length ? "✅" : offHitsExpected.length > onHitsExpected.length ? "❌" : "—"}`);

  if (offOk) { offHits++; offScore += offHitsExpected.length / t.expected.length; }
  if (onOk) { onHits++; onScore += onHitsExpected.length / t.expected.length; }
  offLen += offCandidates.length;
  onLen += onNodes.size;
}

console.log(`\n═══════ Real-World Graph Impact ═══════`);
console.log(`              OFF       ON        Δ`);
console.log(`  Tasks OK    ${offHits}/10     ${onHits}/10     ${onHits > offHits ? "+" : ""}${onHits - offHits}`);
console.log(`  Precision   ${(offScore/Math.max(1,offHits)*100).toFixed(0)}%       ${(onScore/Math.max(1,onHits)*100).toFixed(0)}%`);
console.log(`  Avg cands   ${(offLen/TASKS.length).toFixed(0)}        ${(onLen/TASKS.length).toFixed(0)}`);
console.log(`\n  Graph ROI:  ${onHits > offHits ? "✅ ON wins" : offHits > onHits ? "❌ OFF wins" : "— tied"}`);
