import { resolveTenantContext } from "../security/tenant-context.js";
import {
  runContentTrustPipeline,
} from "../security/content-trust-pipeline.js";
import { storeMemoryFact } from "../security/memory-fact.js";
import { syncCoreMemoryProjection } from "../security/memory-store.js";
import { indexMemoryAsEvidence } from "../security/evidence-graph.js";
import { validateLlmOutput } from "../security/llm-output-firewall.js";

export const definition = {
  name: "remember_fact",
  description:
    "Store a verifiable organizational fact with full provenance. Requires memory:write. AI-sourced facts pass weighted claim validation.",
  parameters: {
    type: "object",
    properties: {
      fact: {
        type: "string",
        description: "The fact to remember",
      },
      block: {
        type: "string",
        enum: ["user_profile", "persona"],
        description: "Memory block. Usually 'user_profile'.",
      },
      approval_id: {
        type: "string",
        description: "Required dual-control approval id for high-risk memory writes.",
      },
    },
    required: ["fact", "block"],
  },
};

export async function handler(input: Record<string, unknown>): Promise<string> {
  const { fact, block, userId, orgId, workspaceId, approvalId, approval_id } = input as {
    fact: string;
    block: string;
    userId: string;
    orgId?: string;
    workspaceId?: string;
    approvalId?: string;
    approval_id?: string;
  };

  if (!fact || !block || !userId) {
    return "Error: Missing required parameters.";
  }

  const tenant = orgId ? { orgId, workspaceId: workspaceId ?? "" } : resolveTenantContext(userId);
  const tenantId = orgId ?? tenant.orgId;
  const resolvedApprovalId = approvalId ?? approval_id;

  const firewall = validateLlmOutput(fact);
  if (!firewall.allowed) {
    return `Error: Fact blocked by LLM output firewall (${firewall.blockedReasons.join(", ")}).`;
  }

  const trust = runContentTrustPipeline({
    content: fact,
    sourceLabel: "agent_tool:remember_fact",
    tenantId,
    actorId: userId,
    workspaceId: workspaceId ?? tenant.workspaceId,
  });

  if (!trust.allowMemoryWrite) {
    return `Error: Memory write blocked — content classified as ${trust.classification}.`;
  }

  const record = storeMemoryFact({
    tenantId,
    workspaceId: workspaceId ?? tenant.workspaceId,
    sourceType: "agent_tool",
    sourceId: null,
    author: userId,
    content: fact,
    confidence: trust.classification === "SAFE" ? 0.7 : 0.4,
    block,
    createdBy: userId,
    approvalId: resolvedApprovalId ?? null,
  });

  indexMemoryAsEvidence({
    tenantId,
    memoryId: record.id,
    label: fact,
    confidence: record.confidence,
  });

  syncCoreMemoryProjection(tenantId, block);

  return `MemoryFact stored [${record.id}] with provenance (evidence=${record.evidence_count ?? 0}, state=${record.verification_state}).`;
}
