/**
 * Lightweight entity extraction for situation intelligence.
 * Keywords propose candidates; entities bind signals into one evolving situation.
 */
export type ExtractedEntity = {
  key: string;
  label: string;
  type: "customer" | "product" | "person" | "team" | "project" | "metric" | "other";
};

/** Extensible org lexicon — labels that recur in enterprise ops (not scenario IDs). */
const LEXICON: Array<{ label: string; type: ExtractedEntity["type"]; aliases?: string[] }> = [
  { label: "Acme", type: "customer", aliases: ["acme industrials"] },
  { label: "Northstar", type: "customer" },
  { label: "Meridian", type: "customer" },
  { label: "Atlas", type: "customer" },
  { label: "CobaltWorks", type: "customer", aliases: ["cobaltworks"] },
  { label: "Kaldera", type: "customer" },
  { label: "SentryLine", type: "customer", aliases: ["sentryline"] },
  { label: "HelixBio", type: "customer", aliases: ["helixbio"] },
  { label: "PayOrbit", type: "product", aliases: ["payorbit"] },
  { label: "Northwind", type: "project", aliases: ["northwind campaign", "northwind"] },
  { label: "LatticeOps", type: "product", aliases: ["latticeops"] },
  { label: "SignalGrid", type: "product", aliases: ["signalgrid"] },
  { label: "NexusAI", type: "product", aliases: ["nexus ai", "nexusai 2.0", "nexusai", "nexus"] },
  { label: "FlowOps", type: "product", aliases: ["flowops", "nested-approval"] },
  { label: "Kafka", type: "product" },
  { label: "HRIS", type: "product" },
  { label: "SIEM", type: "product" },
  { label: "Engineering", type: "team", aliases: ["#engineering"] },
  { label: "Security", type: "team", aliases: ["#security"] },
  { label: "Customer Success", type: "team", aliases: ["#customer_success", "customer success"] },
  { label: "Sales", type: "team", aliases: ["#sales"] },
  { label: "Finance", type: "team", aliases: ["#finance"] },
  { label: "Product", type: "team", aliases: ["#product"] },
  { label: "Executive", type: "team", aliases: ["#executive"] },
  { label: "Support", type: "team", aliases: ["#support"] },
  { label: "QA", type: "team", aliases: ["#qa"] },
];

const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "will",
  "have",
  "been",
  "into",
  "owner",
  "update",
  "email",
  "slack",
  "jira",
  "doc",
  "crm",
  "meeting",
  "notes",
  "action",
  "items",
  "follow",
  "writing",
]);

function normKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function extractEntities(content: string): ExtractedEntity[] {
  const text = String(content || "");
  const lower = text.toLowerCase();
  const out = new Map<string, ExtractedEntity>();

  for (const entry of LEXICON) {
    const names = [entry.label, ...(entry.aliases || [])];
    for (const name of names) {
      const n = name.toLowerCase();
      if (n.length < 3) continue;
      const re =
        n.includes(" ") || n.includes("#")
          ? lower.includes(n)
          : new RegExp(`(?:^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[^a-z0-9]|$)`, "i").test(
              text,
            );
      if (re) {
        const key = normKey(entry.label);
        out.set(key, { key, label: entry.label, type: entry.type });
        break;
      }
    }
  }

  // CamelCase / product-like tokens (SignalGrid, FlowOps, NEX-418)
  const camel = text.match(/\b[A-Z][a-z]+[A-Z][A-Za-z0-9]+\b/g) || [];
  for (const c of camel) {
    if (c.length < 4 || STOP.has(c.toLowerCase())) continue;
    const key = normKey(c);
    if (!out.has(key)) out.set(key, { key, label: c, type: "product" });
  }

  // Person-like: "Owner: Name" / "by Name" / "from Name"
  const people =
    text.match(/\b(?:Owner|by|from|cc)\s*:\s*([A-Z][a-z]+)\b/g) ||
    text.match(/\b(?:Owner|by|from)\s+([A-Z][a-z]{2,})\b/g) ||
    [];
  for (const p of people) {
    const m = p.match(/([A-Z][a-z]{2,})\s*$/);
    if (!m) continue;
    const name = m[1];
    if (STOP.has(name.toLowerCase())) continue;
    const key = `person_${normKey(name)}`;
    out.set(key, { key, label: name, type: "person" });
  }

  // Context-sensitive: "the launch" / v2 / "the release" bind to NexusAI only when Nexus is in-scope.
  if (out.has("nexusai") || /\bnexus(?:ai)?\b/i.test(text)) {
    out.set("nexusai", { key: "nexusai", label: "NexusAI", type: "product" });
  }

  return [...out.values()];
}

export function entityKeys(content: string): string[] {
  return extractEntities(content).map((e) => e.key);
}

const COMMON_ENGLISH = new Set([
  ...STOP,
  "owner",
  "email",
  "please",
  "today",
  "tomorrow",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "hello",
  "thanks",
  "regarding",
  "subject",
  "update",
  "status",
  "team",
  "company",
  "office",
  "people",
  "issue",
  "ticket",
  "still",
  "after",
  "before",
  "during",
  "about",
  "there",
  "their",
  "which",
  "would",
  "could",
  "should",
]);

/**
 * Open-world entities: CamelCase, multi-word Proper Nouns, and unknown Titlecase
 * tokens. Does **not** use the HSOG/theme lexicon.
 */
export function extractOpenWorldEntities(content: string): ExtractedEntity[] {
  const text = String(content || "");
  const out = new Map<string, ExtractedEntity>();

  const camel = text.match(/\b[A-Z][a-z]+[A-Z][A-Za-z0-9]+\b/g) || [];
  for (const c of camel) {
    if (c.length < 4) continue;
    const key = normKey(c);
    out.set(key, { key, label: c, type: "product" });
  }

  const multi = text.match(/\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})+\b/g) || [];
  for (const m of multi) {
    if (/^(Owner|From|Subject|Meeting Notes)\b/i.test(m)) continue;
    const key = normKey(m);
    out.set(key, { key, label: m, type: "customer" });
  }

  const singles = text.match(/\b[A-Z][a-z]{4,}\b/g) || [];
  for (const s of singles) {
    if (COMMON_ENGLISH.has(s.toLowerCase())) continue;
    if (["Jordan", "Marcus", "Helen", "Maya", "Noor", "Omar", "Ethan", "Quinn"].includes(s)) {
      continue;
    }
    const key = normKey(s);
    if (!out.has(key)) out.set(key, { key, label: s, type: "other" });
  }

  return [...out.values()];
}
