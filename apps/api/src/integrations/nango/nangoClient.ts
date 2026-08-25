/**
 * Nango Cloud client for managed OAuth (900+ providers).
 * Credentials stay in Nango; we store connection IDs keyed by Hustronix user.
 *
 * Env:
 *   NANGO_SECRET_KEY / NANGO_API_KEY — secret API key from Nango Environment Settings
 *   NANGO_HOST — optional (default https://api.nango.dev; use http://localhost:3003 for self-host)
 */

import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { Nango } from "@nangohq/node";

export type NangoCatalogEntry = {
  slug: string;
  name: string;
  authMode: string;
  categories: string[];
  logoUrl: string;
  docsUrl: string;
};

const moduleDir = dirname(fileURLToPath(import.meta.url));

let catalogCache: NangoCatalogEntry[] | null = null;
let featuredCache: NangoCatalogEntry[] | null = null;

export function nangoSecretKey(): string {
  return (
    process.env.NANGO_SECRET_KEY?.trim() ||
    process.env.NANGO_API_KEY?.trim() ||
    ""
  );
}

export function isNangoConfigured(): boolean {
  return nangoSecretKey().length > 0;
}

export function getNangoClient(): Nango {
  const secretKey = nangoSecretKey();
  if (!secretKey) {
    throw new Error("nango_not_configured");
  }
  const host = process.env.NANGO_HOST?.trim() || undefined;
  return new Nango(host ? { secretKey, host } : { secretKey });
}

function loadJsonArray(file: string): NangoCatalogEntry[] {
  const raw = readFileSync(resolve(moduleDir, file), "utf8").replace(/^\uFEFF/, "");
  const parsed = JSON.parse(raw) as NangoCatalogEntry[];
  return Array.isArray(parsed) ? parsed : [];
}

export function getOAuthCatalog(): NangoCatalogEntry[] {
  if (!catalogCache) catalogCache = loadJsonArray("oauth-providers.catalog.json");
  return catalogCache;
}

export function getFeaturedOAuthCatalog(): NangoCatalogEntry[] {
  if (!featuredCache) featuredCache = loadJsonArray("oauth-providers.featured.json");
  return featuredCache;
}

/** Integration unique_key we create in Nango mirrors the provider slug. */
export function integrationIdForProvider(providerSlug: string): string {
  return providerSlug.trim().toLowerCase();
}

export function findCatalogEntry(slug: string): NangoCatalogEntry | undefined {
  const key = slug.trim().toLowerCase();
  return getOAuthCatalog().find((p) => p.slug === key);
}
