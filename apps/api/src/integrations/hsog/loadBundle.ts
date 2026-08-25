import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { repoRoot } from "../../config.js";
import type { HsogIngestBundle } from "./types.js";

function candidateRoots(): string[] {
  const envRoot = (process.env.HSOG_ROOT || "").trim();
  const envExport = (process.env.HSOG_EXPORT || "").trim();
  const out: string[] = [];
  if (envExport) out.push(envExport);
  if (envRoot) {
    out.push(resolve(envRoot, "benchmarks/hustronix-enterprise/fixtures/os_ingest.json"));
    out.push(resolve(envRoot, "orgforge/benchmarks/hustronix-enterprise/fixtures/os_ingest.json"));
    out.push(resolve(envRoot, "export/hustronix"));
  }
  out.push(resolve(repoRoot, "../hsog/orgforge/benchmarks/hustronix-enterprise/fixtures/os_ingest.json"));
  out.push(resolve(repoRoot, "../hsog/benchmarks/hustronix-enterprise/fixtures/os_ingest.json"));
  out.push(resolve("D:/hsog/orgforge/benchmarks/hustronix-enterprise/fixtures/os_ingest.json"));
  return out;
}

function isBundle(v: unknown): v is HsogIngestBundle {
  if (!v || typeof v !== "object") return false;
  const o = v as HsogIngestBundle;
  return Array.isArray(o.events) && (o.version === 1 || o.version == null);
}

function loadExportDir(dir: string): HsogIngestBundle {
  const entitiesPath = resolve(dir, "entities.json");
  const eventsPath = resolve(dir, "event_log.jsonl");
  const artifactsPath = resolve(dir, "artifact_index.json");
  if (!existsSync(eventsPath)) throw new Error(`HSOG export missing event_log.jsonl: ${dir}`);

  const entities = existsSync(entitiesPath)
    ? (JSON.parse(readFileSync(entitiesPath, "utf8")) as Record<string, unknown>)
    : {};
  const artifactIndex = existsSync(artifactsPath)
    ? (JSON.parse(readFileSync(artifactsPath, "utf8")) as { artifacts?: Array<Record<string, unknown>> })
    : { artifacts: [] };

  const byEvent = new Map<string, Array<Record<string, unknown>>>();
  for (const a of artifactIndex.artifacts || []) {
    const eids = (a.related_event_ids as string[]) || [];
    for (const eid of eids) {
      const list = byEvent.get(eid) || [];
      list.push(a);
      byEvent.set(eid, list);
    }
  }

  const events = readFileSync(eventsPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .map((row) => {
      const eid = String(row.event_id || "");
      const arts = (byEvent.get(eid) || []).map((a) => ({
        artifact_id: String(a.artifact_id || ""),
        artifact_type: String(a.artifact_type || "unknown"),
        evidence_quality: a.evidence_quality ? String(a.evidence_quality) : undefined,
        visibility_scope: a.visibility_scope ? String(a.visibility_scope) : undefined,
        related_entity_ids: (a.related_entity_ids as string[]) || (row.entity_ids as string[]) || [],
        ground_truth_fact_ids:
          (a.ground_truth_fact_ids as string[]) || (row.ground_truth_fact_ids as string[]) || [],
      }));
      return {
        event_id: eid,
        day: Number(row.day || 0),
        date: row.date ? String(row.date) : undefined,
        scenario_id: String(row.scenario_id || "unknown"),
        event_type: String(row.event_type || "event"),
        actors: (row.actors as string[]) || [],
        entity_ids: (row.entity_ids as string[]) || [],
        visibility_scope: row.visibility_scope ? String(row.visibility_scope) : undefined,
        ground_truth_fact_ids: (row.ground_truth_fact_ids as string[]) || [],
        summary: row.summary ? String(row.summary) : undefined,
        private: !!row.private,
        artifacts: arts,
      };
    });

  const peopleMap = (entities.people as Record<string, string> | undefined) || {};
  const people = Object.entries(peopleMap).map(([id, name]) => ({
    id,
    name,
    first_name: String(name).split(/\s+/)[0],
    email: `${id.replace(/_/g, ".")}@hustronix.io`,
  }));

  return {
    version: 1,
    benchmark: "hustronix-enterprise",
    start_date: "2026-02-02",
    company: (entities.company as Record<string, unknown>) || {},
    products: (entities.products as HsogIngestBundle["products"]) || [],
    projects: (entities.projects as HsogIngestBundle["projects"]) || [],
    departments: (entities.departments as HsogIngestBundle["departments"]) || [],
    customers: (entities.customers as HsogIngestBundle["customers"]) || [],
    people,
    events,
  };
}

export function resolveHsogBundlePath(explicit?: string): string {
  if (explicit?.trim()) {
    const p = resolve(explicit.trim());
    if (!existsSync(p)) throw new Error(`HSOG bundle not found: ${p}`);
    return p;
  }
  for (const c of candidateRoots()) {
    if (existsSync(c)) return c;
  }
  throw new Error(
    "HSOG bundle not found. Set HSOG_ROOT or HSOG_EXPORT, or pass --bundle <path> to os_ingest.json.",
  );
}

export function loadHsogBundle(pathOrDir: string): { path: string; bundle: HsogIngestBundle } {
  const path = resolveHsogBundlePath(pathOrDir);
  if (path.endsWith(".json")) {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!isBundle(parsed)) throw new Error(`Invalid HSOG ingest bundle: ${path}`);
    return { path, bundle: parsed };
  }
  return { path, bundle: loadExportDir(path) };
}
