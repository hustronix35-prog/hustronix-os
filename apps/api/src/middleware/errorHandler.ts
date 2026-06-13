import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";

/** Prevent Express/body-parser HTML stack traces from leaking to clients. */
export function jsonErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  if (res.headersSent) return next(err);
  const syntax =
    err instanceof SyntaxError ||
    (err && typeof err === "object" && (err as { type?: string }).type === "entity.parse.failed");
  if (syntax) {
    return res.status(400).json({ error: "Invalid JSON body." });
  }
  if (config.server.isProduction) {
    console.error("[http] unhandled error", err);
    return res.status(500).json({ error: "Internal server error." });
  }
  const message = err instanceof Error ? err.message : "Internal server error";
  return res.status(500).json({ error: message });
}
