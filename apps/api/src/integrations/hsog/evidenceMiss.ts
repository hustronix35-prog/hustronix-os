/**
 * Honest missing-evidence investigation — why a GT artifact was not attached.
 * Do not force-attach irrelevant/ambiguous artifacts to chase a score.
 */
import { db } from "../../database.js";
import { SITUATION_PATTERNS } from "../../intelligence/situation-patterns.js";
import { PATTERN_FACETS } from "../../intelligence/situation-engine.js";
import { extractEntities } from "../../intelligence/entity-resolver.js";
import type { HsogGroundTruth } from "./customerPathCorpus.js";

function textHas(content: string, keyword: string): boolean {
  const lower = content.toLowerCase();
  const k = keyword.toLowerCase().trim();
  if (!k) return false;
  if (k.includes(" ") || k.length >= 6) return lower.includes(k);
  return new RegExp(
    `(?:^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[^a-z0-9]|$)`,
    "i",
  ).test(content);
}

export type MissingArtifactRow = {
  scenario_id: string;
  artifact_id: string;
  day: number;
  summary: string;
  snippet: string;
  ingested: boolean;
  reason: string;
  class: "architectural" | "off_facet" | "ambiguous" | "not_ingested";
};

export type MissingEvidenceReport = {
  by_scenario: Array<{
    scenario_id: string;
    title: string;
    missing: number;
    total: number;
    hit_rate: number;
    rows: MissingArtifactRow[];
  }>;
  markdown: string;
};

export function investigateMissingEvidence(
  userId: string,
  gt: HsogGroundTruth,
  focusScenarioIds?: string[],
): MissingEvidenceReport {
  const focus = new Set(
    focusScenarioIds?.length
      ? focusScenarioIds
      : gt.scenarios.map((s) => s.id),
  );
  const by_scenario: MissingEvidenceReport["by_scenario"] = [];

  for (const sc of gt.scenarios) {
    if (!focus.has(sc.id)) continue;
    const pattern = SITUATION_PATTERNS.find((p) => p.id === sc.id);
    const arts = gt.artifacts.filter((a) => a.scenario_id === sc.id);
    const sit = (
      db.rawGet(`SELECT id FROM situations WHERE user_id = ? AND pattern_id = ?`, [
        userId,
        sc.id,
      ]) as { id: string }[]
    )[0];

    const attached = new Set<string>();
    if (sit) {
      const ev = db.rawGet(
        `SELECT s.external_id FROM situation_evidence e
         JOIN external_signals s ON s.id = e.signal_id
         WHERE e.situation_id = ?`,
        [sit.id],
      ) as { external_id: string | null }[];
      for (const e of ev) if (e.external_id) attached.add(String(e.external_id));
    }

    const sitKeys = new Set<string>();
    if (sit) {
      const ents = db.rawGet(
        `SELECT entity_key FROM situation_entities WHERE situation_id = ?`,
        [sit.id],
      ) as { entity_key: string }[];
      for (const e of ents) sitKeys.add(e.entity_key);
    }

    const rows: MissingArtifactRow[] = [];
    for (const a of arts) {
      if (attached.has(a.blind_external_id)) continue;
      const sig = (
        db.rawGet(
          `SELECT id, content FROM external_signals WHERE user_id = ? AND external_id = ?`,
          [userId, a.blind_external_id],
        ) as { id: string; content: string }[]
      )[0];
      if (!sig) {
        rows.push({
          scenario_id: sc.id,
          artifact_id: a.artifact_id,
          day: a.day,
          summary: a.summary,
          snippet: "",
          ingested: false,
          reason: "Signal never ingested (or external_id mismatch).",
          class: "not_ingested",
        });
        continue;
      }
      const content = sig.content || "";
      const kws = (pattern?.keywords || []).filter((k) => textHas(content, k));
      const facetMap = PATTERN_FACETS[sc.id] || {};
      const facets = Object.entries(facetMap)
        .filter(([, klist]) => klist.some((k) => textHas(content, k)))
        .map(([f]) => f);
      const ents = extractEntities(content).filter(
        (e) => e.type === "customer" || e.type === "product" || e.type === "project",
      );
      const share = ents.some((e) => sitKeys.has(e.key));

      let reason: string;
      let cls: MissingArtifactRow["class"];
      if (!sit) {
        reason = "Situation never opened — no keyword seed on this or earlier artifacts.";
        cls = "architectural";
      } else if (kws.length === 0 && facets.length === 0 && !share) {
        reason =
          "No keyword hit, no pattern facet, no shared primary entity. Likely off-facet / ambient relative to the situation.";
        cls = "off_facet";
      } else if (kws.length === 0 && facets.length === 0 && share) {
        reason = `Shares entity [${ents.map((e) => e.label).join(", ")}] but no facet/keyword — attach gate requires facet or keyword with entity.`;
        cls = "architectural";
      } else if (facets.length > 0 && !share && kws.length === 0) {
        reason = `Has facets [${facets.join(", ")}] but does not share the situation's primary entity, and keyword strength was below minHits.`;
        cls = "ambiguous";
      } else if (kws.length > 0) {
        reason = `Keyword hits [${kws.slice(0, 4).join(", ")}] but still not attached — possible minHits/open-seed timing or duplicate skip.`;
        cls = "architectural";
      } else {
        reason = "Did not meet keyword / entity+facet / graph attach gates.";
        cls = "ambiguous";
      }
      rows.push({
        scenario_id: sc.id,
        artifact_id: a.artifact_id,
        day: a.day,
        summary: a.summary,
        snippet: content.slice(0, 180).replace(/\s+/g, " "),
        ingested: true,
        reason,
        class: cls,
      });
    }

    by_scenario.push({
      scenario_id: sc.id,
      title: sc.title,
      missing: rows.length,
      total: arts.length,
      hit_rate: arts.length ? (arts.length - rows.length) / arts.length : 0,
      rows,
    });
  }

  const focusLines = by_scenario.filter((s) =>
    ["infrastructure_outage", "feature_quality_regression", "security_incident"].includes(
      s.scenario_id,
    ),
  );
  const markdown = [
    "MISSING EVIDENCE INVESTIGATION",
    "────────────────────────────",
    "Do not force-attach. Architectural = gate/entity miss. Off-facet = probably should stay unattached.",
    "",
    ...focusLines.flatMap((s) => {
      const arch = s.rows.filter((r) => r.class === "architectural").length;
      const off = s.rows.filter((r) => r.class === "off_facet").length;
      const amb = s.rows.filter((r) => r.class === "ambiguous").length;
      return [
        `### ${s.title} (${s.scenario_id}) — attached ${Math.round(s.hit_rate * 100)}% · missing ${s.missing}/${s.total}`,
        `Classes: architectural=${arch} off-facet=${off} ambiguous=${amb}`,
        ...s.rows.slice(0, 12).map(
          (r) =>
            `- d${r.day} [${r.class}] ${r.artifact_id}: ${r.reason}\n  “${(r.snippet || r.summary).slice(0, 140)}”`,
        ),
        s.rows.length > 12 ? `  … ${s.rows.length - 12} more` : "",
        "",
      ];
    }),
  ]
    .filter((l) => l !== "")
    .join("\n");

  return { by_scenario, markdown };
}
