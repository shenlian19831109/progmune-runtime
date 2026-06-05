/** Report generation. */
import { getInventoryValue, getStockSummary } from "./inventory";
import { calculateRevenue } from "./orders";
import { getDailyActiveUsers, getTopEvents } from "./analytics";
import { getPendingShipments } from "./shipping";

export function generateInventoryReport(): string {
  const value=getInventoryValue(); const stock=getStockSummary();
  return `Inventory: ${stock.total} products, value $${value}, low stock: ${stock.low}, out: ${stock.outOfStock}`;
}
export function generateRevenueReport(): string { return `Revenue: $${calculateRevenue()}`; }
export function generateActivityReport(): string {
  const dau=getDailyActiveUsers(); const top=getTopEvents(5);
  return `DAU: ${dau}, top events: ${top.map(e=>e.type+":"+e.count).join(", ")}`;
}
export function generateShippingReport(): string {
  const pending=getPendingShipments(); return `Pending shipments: ${pending.length}`;
}
export function generateFullReport(): string {
  return [generateInventoryReport(),generateRevenueReport(),generateActivityReport(),generateShippingReport()].join("\n");
}
export function formatReportAsHTML(report: string): string { return `<html><body><pre>${report}</pre></body></html>`; }
export function formatReportAsJSON(report: string): string { return JSON.stringify({report,generated:new Date().toISOString()}); }
export function saveReport(report: string, filename: string): boolean { return true; /* stub */ }
