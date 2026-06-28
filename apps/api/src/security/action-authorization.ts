import type { AuthKind } from "../middleware/auth.js";
import { AuthorizationError } from "./authorization-errors.js";
import {
  type Permission,
  userHasPermission,
} from "./authorization.js";

export type WsActionType =
  | "agent:chat"
  | "agent:plan"
  | "decision:commit"
  | "agent:sync_protocols"
  | "security:capability_override"
  | "session:load"
  | "session:new";

const WS_ACTION_PERMISSIONS: Readonly<Record<WsActionType, Permission | null>> = {
  "agent:chat": "agent:invoke",
  "agent:plan": "agent:invoke",
  "decision:commit": "decision:commit",
  "agent:sync_protocols": "agent:invoke",
  "security:capability_override": "security:manage",
  "session:load": null,
  "session:new": null,
};

export interface WsActionContext {
  userId: string;
  authKind?: AuthKind | string;
  action: WsActionType;
}

export function requiredPermissionForWsAction(action: WsActionType): Permission | null {
  return WS_ACTION_PERMISSIONS[action] ?? null;
}

/**
 * Authorize a WebSocket action before execution. Default DENY for unknown actions.
 */
export function authorizeWsAction(ctx: WsActionContext): void {
  const permission = requiredPermissionForWsAction(ctx.action);
  if (permission === undefined) {
    throw new AuthorizationError(`Unknown WebSocket action "${ctx.action}" — denied.`);
  }
  if (permission === null) {
    return;
  }
  if (!userHasPermission(ctx.userId, ctx.authKind, permission)) {
    throw new AuthorizationError(
      `Missing permission "${permission}" for WebSocket action "${ctx.action}".`,
      permission,
    );
  }
}

export function wsActionFromPayload(payload: {
  type?: string;
  planMode?: boolean;
  mode?: string;
  chatMode?: string;
}): WsActionType | null {
  const t = String(payload.type || "");
  if (t === "text") {
    const plan =
      payload.planMode === true ||
      payload.mode === "plan" ||
      payload.chatMode === "plan";
    return plan ? "agent:plan" : "agent:chat";
  }
  if (t === "COMMIT_DECISION") return "decision:commit";
  if (t === "SYNC_PROTOCOLS") return "agent:sync_protocols";
  if (t === "CAPABILITY_OVERRIDE") return "security:capability_override";
  if (t === "load_session") return "session:load";
  if (t === "new_session") return "session:new";
  return null;
}
