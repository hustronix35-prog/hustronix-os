/**
 * Retrieval ranking for Talk — not a readiness score.
 */
export type RankableContext = {
  id: string;
  text: string;
  entities: string[];
  impact?: number;
  recency?: number;
  trajectoryBoost?: number;
  situationBoost?: number;
  customerImportance?: number;
  financialImportance?: number;
  dependencyBoost?: number;
  decisionStateBoost?: number;
};

export type Ranked<T> = T & { relevance: number };

const STOP = new Set([
  "the",
  "and",
  "for",
  "how",
  "can",
  "our",
  "with",
  "what",
  "this",
  "that",
  "from",
  "have",
  "just",
  "about",
  "could",
  "would",
  "should",
  "increase",
  "improve",
  "give",
]);

export function queryTokens(question: string): string[] {
  return String(question || "")
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

export function topicMatch(question: string, hay: string): number {
  const tokens = queryTokens(question);
  const h = hay.toLowerCase();
  if (!tokens.length) return 0;
  let n = 0;
  for (const t of tokens) if (h.includes(t)) n += 1;
  return n / tokens.length;
}

export function entityMatch(question: string, entities: string[]): number {
  const q = question.toLowerCase();
  if (!entities.length) return 0;
  let n = 0;
  for (const e of entities) {
    const k = String(e || "").toLowerCase();
    if (k.length > 2 && q.includes(k)) n += 1;
  }
  return Math.min(1, n);
}

/**
 * relevance = topic + entity + situation + impact + recency + trajectory
 * Bounded 0–1. Does not mint decisions.
 */
export function relevanceScore(question: string, item: RankableContext): number {
  const topic = topicMatch(question, item.text);
  const ent = entityMatch(question, item.entities);
  const sit = Math.max(0, Math.min(1, item.situationBoost ?? 0));
  const impact = Math.max(0, Math.min(1, item.impact ?? 0));
  const recency = Math.max(0, Math.min(1, item.recency ?? 0.4));
  const traj = Math.max(0, Math.min(1, item.trajectoryBoost ?? 0));
  const cust = Math.max(0, Math.min(1, item.customerImportance ?? 0));
  const money = Math.max(0, Math.min(1, item.financialImportance ?? 0));
  const dep = Math.max(0, Math.min(1, item.dependencyBoost ?? 0));
  const dec = Math.max(0, Math.min(1, item.decisionStateBoost ?? 0));
  return (
    Math.round(
      (0.22 * topic +
        0.18 * ent +
        0.12 * sit +
        0.12 * impact +
        0.08 * recency +
        0.08 * traj +
        0.08 * cust +
        0.06 * money +
        0.03 * dep +
        0.03 * dec) *
        1000,
    ) / 1000
  );
}

export function expandRetrievalQuery(question: string): string {
  const q = String(question || "");
  const extra: string[] = [q];
  if (/\b(sales|revenue|pipeline|deal|quota|arr|forecast|conversion|coverage)\b/i.test(q) || /\bincrease sales\b/i.test(q)) {
    extra.push(
      "sales revenue pipeline conversion forecast coverage renewal expansion customer health deal velocity sales capacity quota arr deal",
    );
  }
  if (/\b(churn|retention|renewal)\b/i.test(q)) {
    extra.push("churn retention renewal customer health support competitor expansion");
  }
  if (/\b(acme|northstar|meridian|atlas)\b/i.test(q)) {
    extra.push("customer risk renewal health support");
  }
  if (/\b(this week|this month|focus|biggest|attention|going wrong|prioritize)\b/i.test(q)) {
    extra.push("risk blocked dependency capacity decision trajectory");
  }
  return extra.join(" ");
}

export function isImpactScan(question: string): boolean {
  const q = String(question || "").toLowerCase();
  if (/\b(europe|european|expansion strategy|asia|latam)\b/.test(q)) return false;
  return /\b(what should (i|we) focus|this week|biggest (risk|worry)|needs attention|what matters|going wrong in the company|what worries you|what('s| is) going on|happening (in|with) (the |our )?company|which customers?|worry about)\b/.test(
    q,
  );
}

export function rankContext<T extends RankableContext>(
  question: string,
  items: T[],
  limit = 8,
  opts?: { requireTopic?: boolean },
): Ranked<T>[] {
  const expanded = expandRetrievalQuery(question);
  const requireTopic = opts?.requireTopic ?? !isImpactScan(question);
  return items
    .map((item) => ({ ...item, relevance: relevanceScore(expanded, item) }))
    .filter((item) => {
      if (item.relevance <= 0.04) return false;
      if (!requireTopic) return true;
      const topic = topicMatch(expanded, item.text);
      const ent = entityMatch(question, item.entities) || entityMatch(expanded, item.entities);
      return topic > 0 || ent > 0;
    })
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, limit);
}
