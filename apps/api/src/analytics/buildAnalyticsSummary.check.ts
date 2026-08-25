/**
 * ponytail: smoke-check analytics aggregations (no framework).
 * Run: npx tsx apps/api/src/analytics/buildAnalyticsSummary.check.ts
 */
import { buildAnalyticsSummary } from "./buildAnalyticsSummary.js";

const empty = buildAnalyticsSummary("__analytics_check_missing_user__", "7d");
if (!empty.overview?.kpis?.length) throw new Error("expected overview.kpis");
if (empty.overview.kpis.length !== 6) throw new Error(`expected 6 KPIs, got ${empty.overview.kpis.length}`);
if (!empty.execution?.distribution) throw new Error("expected execution.distribution");
if (!Array.isArray(empty.trends.metrics) || empty.trends.metrics.length < 3) {
  throw new Error("expected trend metrics");
}
if (!empty.reports.length) throw new Error("expected reports catalog");
console.log("analytics summary check ok", {
  kpis: empty.overview.kpis.map((k) => k.id).join(","),
  range: empty.rangeLabel,
});
