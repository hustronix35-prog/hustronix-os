export type EpistemicTruthState = "supported" | "contradicted" | "ambiguous" | "unknown" | "stale";

export interface EpistemicState {
  truthState: EpistemicTruthState;
  confidence: number;
  uncertainty: number;
  evidenceEventIds?: string[];
  assumptions?: string[];
}

export class EpistemicGateError extends Error {
  constructor(message: string, readonly requiresApproval: boolean) {
    super(message);
    this.name = "EpistemicGateError";
  }
}

export function requireEpistemicSupport(
  state: EpistemicState,
  action: { maxUncertainty: number; minConfidence: number; irreversible?: boolean },
) {
  if (state.truthState === "contradicted" || state.truthState === "stale") {
    throw new EpistemicGateError("claim cannot support execution in its current epistemic state", false);
  }
  if (state.truthState === "unknown" || state.truthState === "ambiguous") {
    throw new EpistemicGateError("insufficient evidence for autonomous execution", true);
  }
  if (state.uncertainty > action.maxUncertainty) {
    throw new EpistemicGateError("uncertainty exceeds autonomous threshold", true);
  }
  if (state.confidence < action.minConfidence) {
    throw new EpistemicGateError("confidence below autonomous threshold", true);
  }
  if (action.irreversible && state.uncertainty > 0.2) {
    throw new EpistemicGateError("irreversible action requires low uncertainty", true);
  }
}
