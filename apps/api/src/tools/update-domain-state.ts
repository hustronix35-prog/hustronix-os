import type { DomainName } from "../state/domain-state.js";
import { upsertDomainStatePatch } from "../state/domain-state.js";
import { resolveTenantContext } from "../security/tenant-context.js";

export const updateDomainStateDefinition = {
  name: "update_domain_state",
  description:
    "Write a structured domain state patch (engineering, sales, marketing). Use JSON sections, not prose.",
  parameters: {
    type: "object",
    properties: {
      domain: {
        type: "string",
        enum: ["engineering", "sales", "marketing"],
        description: "Domain owning this patch.",
      },
      sections: {
        type: "object",
        description: "Partial OrganizationState sections owned by this domain.",
        properties: {
          blockers: { type: "object" },
          risks: { type: "object" },
          commitments: { type: "object" },
          priorities: { type: "object" },
          externalContext: { type: "object" },
          teams: { type: "array", items: { type: "object" } },
        },
      },
    },
    required: ["domain", "sections"],
  },
};

export async function updateDomainStateHandler(args: {
  userId: string;
  domain: DomainName;
  sections: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const ctx = resolveTenantContext(args.userId);
  const row = upsertDomainStatePatch({
    tenantId: ctx.orgId,
    domain: args.domain,
    sections: args.sections as any,
    author: args.userId,
  });
  return { success: true, domain: args.domain, version: row.version };
}
