import type { NextFunction, Request, Response } from "express";
import { db } from "../database.js";
import type { AuthKind } from "../middleware/auth.js";

export type HustronixRole = "owner" | "admin" | "strategist" | "operator" | "viewer" | "agent";

export type Permission =
  | "decision:read"
  | "decision:write"
  | "decision:commit"
  | "execution:read"
  | "execution:write"
  | "signal:read"
  | "signal:write"
  | "settings:read"
  | "settings:write"
  | "security:manage"
  | "agent:invoke"
  | "audit:run";

const ROLE_PERMISSIONS: Record<HustronixRole, ReadonlySet<Permission>> = {
  owner: new Set([
    "decision:read",
    "decision:write",
    "decision:commit",
    "execution:read",
    "execution:write",
    "signal:read",
    "signal:write",
    "settings:read",
    "settings:write",
    "security:manage",
    "agent:invoke",
    "audit:run",
  ]),
  admin: new Set([
    "decision:read",
    "decision:write",
    "decision:commit",
    "execution:read",
    "execution:write",
    "signal:read",
    "signal:write",
    "settings:read",
    "settings:write",
    "security:manage",
    "agent:invoke",
    "audit:run",
  ]),
  strategist: new Set([
    "decision:read",
    "decision:write",
    "decision:commit",
    "execution:read",
    "signal:read",
    "signal:write",
    "agent:invoke",
  ]),
  operator: new Set(["decision:read", "execution:read", "execution:write", "signal:read", "signal:write"]),
  viewer: new Set(["decision:read", "execution:read", "signal:read", "settings:read"]),
  agent: new Set(["decision:read", "execution:read", "signal:read", "signal:write", "agent:invoke"]),
};

function normalizeRoleLabel(raw: string | undefined | null): HustronixRole | null {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (!s) return null;
  if (s === "owner") return "owner";
  if (s === "admin" || s === "administrator") return "admin";
  if (s === "strategist") return "strategist";
  if (s === "operator") return "operator";
  if (s === "viewer" || s === "read-only" || s === "readonly") return "viewer";
  if (s === "agent") return "agent";
  return null;
}

export function roleForUser(userId: string, authKind?: AuthKind | string): HustronixRole {
  if (authKind === "api_token") return "agent";
  if (userId === "system") return "agent";
  const ownerId = (db.getSetting(userId, "org.owner_user_id") || "").trim();
  if (ownerId && ownerId === userId) return "owner";
  const fromSettings = normalizeRoleLabel(db.getSetting(userId, "org.role"));
  if (fromSettings) return fromSettings;
  return "viewer";
}

export function permissionsForRole(role: HustronixRole): Permission[] {
  return Array.from(ROLE_PERMISSIONS[role] || []);
}

export function principalRole(req: Request): HustronixRole {
  const explicit = (req as any).role as HustronixRole | undefined;
  if (explicit && explicit in ROLE_PERMISSIONS) return explicit;
  const userId = String((req as any).userId || "");
  const authKind = (req as any).authKind as AuthKind | undefined;
  return roleForUser(userId, authKind);
}

export function userHasPermission(
  userId: string,
  authKind: AuthKind | string | undefined,
  permission: Permission,
): boolean {
  return ROLE_PERMISSIONS[roleForUser(userId, authKind)]?.has(permission) ?? false;
}

export function hasPermission(req: Request, permission: Permission): boolean {
  return ROLE_PERMISSIONS[principalRole(req)]?.has(permission) ?? false;
}

export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (hasPermission(req, permission)) return next();
    return res.status(403).json({ error: "Forbidden", requiredPermission: permission });
  };
}
