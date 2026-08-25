import { genericAdapter } from "./generic.js";
import { slackAdapter } from "./slack.js";
import type { AdapterContext, NangoSyncRecord, ProviderAdapter } from "./types.js";
import type { EvidenceEnvelope } from "../ingest/types.js";

const SPECIALIZED: ProviderAdapter[] = [slackAdapter];

export function resolveAdapter(provider: string, model: string): ProviderAdapter {
  const p = provider.trim().toLowerCase();
  const m = model.trim().toLowerCase();
  for (const a of SPECIALIZED) {
    if (!a.providers.map((x) => x.toLowerCase()).includes(p)) continue;
    if (a.models?.length && !a.models.map((x) => x.toLowerCase()).includes(m)) continue;
    return a;
  }
  return genericAdapter;
}

export function adaptNangoRecord(
  record: NangoSyncRecord,
  ctx: AdapterContext,
): EvidenceEnvelope | null {
  return resolveAdapter(ctx.provider, ctx.model).adapt(record, ctx);
}

export type { AdapterContext, NangoSyncRecord, ProviderAdapter };
