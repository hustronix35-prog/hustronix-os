export type CapabilityName =
  | "signal.ingest.slack"
  | "signal.ingest.manual"
  | "signal.write"
  | "execution.read"
  | "execution.write"
  | "task.transition.limited"
  | "decision.commit"
  | "agent.invoke";

export interface CapabilityClaims {
  jti: string;
  subject: string;
  orgId: string;
  workflowId?: string;
  decisionId?: string;
  capabilities: CapabilityName[];
  constraints?: {
    allowedTaskStates?: string[];
    maxTaskTransitions?: number;
    allowedSources?: string[];
    dataClasses?: string[];
  };
  issuedAt: number;
  expiresAt: number;
  epochId?: string;
}

export class CapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilityError";
  }
}

export function requireCapability(
  claims: CapabilityClaims,
  capability: CapabilityName,
  resource: { orgId: string; nextState?: string; source?: string; dataClass?: string; now?: number },
) {
  const now = resource.now ?? Date.now();
  if (claims.expiresAt <= now) throw new CapabilityError("capability expired");
  if (claims.orgId !== resource.orgId) throw new CapabilityError("capability org mismatch");
  if (!claims.capabilities.includes(capability)) throw new CapabilityError("missing capability");

  const constraints = claims.constraints || {};
  if (
    resource.nextState &&
    constraints.allowedTaskStates &&
    !constraints.allowedTaskStates.includes(resource.nextState)
  ) {
    throw new CapabilityError("task state outside capability boundary");
  }
  if (resource.source && constraints.allowedSources && !constraints.allowedSources.includes(resource.source)) {
    throw new CapabilityError("source outside capability boundary");
  }
  if (resource.dataClass && constraints.dataClasses && !constraints.dataClasses.includes(resource.dataClass)) {
    throw new CapabilityError("data class outside capability boundary");
  }
}
