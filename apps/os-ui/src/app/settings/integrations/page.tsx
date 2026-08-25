"use client";

import Nango from "@nangohq/frontend";
import { Search } from "@/components/icons";
import { useCallback, useEffect, useState } from "react";
import { ProviderCatalogIcon } from "@/components/brand/IntegrationIcons";
import { StatusPill } from "@/components/ui/Primitives";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import staticFeatured from "@/lib/nango-oauth-featured.json";
import pageStyles from "@/app/pages.module.css";
import { SettingsShell } from "../_components/SettingsShell";
import styles from "../settings.module.css";

type Tab = "featured" | "all" | "connected";

type CatalogProvider = {
  slug: string;
  name: string;
  authMode: string;
  categories: string[];
  logoUrl: string;
  docsUrl: string;
  connected?: boolean;
  description?: string;
};

type ConnectSession = {
  sessionToken: string;
  integrationId: string;
  provider: string;
};

function descriptionFor(categories: string[], name: string): string {
  if (!categories.length) return `Connect ${name} via OAuth.`;
  const label = categories
    .filter((c) => c !== "popular")
    .slice(0, 2)
    .join(" · ");
  return label ? `${name} — ${label}` : `Connect ${name} via OAuth.`;
}

/** Offline fallback is featured-only; full catalog comes from the API. */
function staticList(): CatalogProvider[] {
  return (staticFeatured as CatalogProvider[]).map((p) => ({
    ...p,
    description: descriptionFor(p.categories, p.name),
  }));
}

export default function IntegrationsSettingsPage() {
  const [tab, setTab] = useState<Tab>("featured");
  const [search, setSearch] = useState("");
  const [providers, setProviders] = useState<CatalogProvider[]>([]);
  const [connectedSlugs, setConnectedSlugs] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [nangoConfigured, setNangoConfigured] = useState(true);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshConnections = useCallback(async () => {
    try {
      const data = await apiGet<{ connections: Array<{ provider: string }> }>(
        "/api/nango/connections",
      );
      setConnectedSlugs(new Set(data.connections.map((c) => c.provider)));
      setOffline(false);
      return data.connections;
    } catch {
      return null;
    }
  }, []);

  const loadProviders = useCallback(async () => {
    setLoading(true);
    setError(null);
    const q = search.trim().toLowerCase();

    let connSlugs = new Set<string>();
    const conn = await refreshConnections();
    if (conn) {
      connSlugs = new Set(conn.map((c) => c.provider));
    }

    if (tab === "connected") {
      try {
        const data = await apiGet<{
          configured: boolean;
          connections: Array<{
            provider: string;
            name: string;
            catalog: CatalogProvider | null;
          }>;
        }>("/api/nango/connections");
        setNangoConfigured(data.configured);
        setOffline(false);
        let list = data.connections.map((c) => {
          const base = c.catalog ?? {
            slug: c.provider,
            name: c.name,
            authMode: "OAUTH2",
            categories: [],
            logoUrl: "",
            docsUrl: "",
          };
          return {
            ...base,
            slug: c.provider,
            name: base.name || c.name,
            connected: true,
            description: descriptionFor(base.categories, base.name || c.name),
          };
        });
        if (q) {
          list = list.filter(
            (p) =>
              p.slug.includes(q) ||
              p.name.toLowerCase().includes(q) ||
              p.categories.some((c) => c.toLowerCase().includes(q)),
          );
        }
        setProviders(list);
      } catch {
        setOffline(true);
        let list = staticList().filter((p) => connSlugs.has(p.slug));
        if (q) {
          list = list.filter(
            (p) =>
              p.slug.includes(q) ||
              p.name.toLowerCase().includes(q) ||
              p.categories.some((c) => c.toLowerCase().includes(q)),
          );
        }
        setProviders(list.map((p) => ({ ...p, connected: true })));
      } finally {
        setLoading(false);
      }
      return;
    }

    const params = new URLSearchParams();
    if (tab === "featured") params.set("featured", "1");
    if (q) params.set("q", q);

    try {
      const data = await apiGet<{
        configured: boolean;
        providers: CatalogProvider[];
      }>(`/api/nango/providers?${params.toString()}`);
      setNangoConfigured(data.configured);
      setOffline(false);
      setProviders(
        data.providers.map((p) => ({
          ...p,
          connected: p.connected ?? connSlugs.has(p.slug),
        })),
      );
    } catch {
      setOffline(true);
      // ponytail: full catalog is API-only; offline shows featured subset
      let list = staticList();
      if (q) {
        list = list.filter(
          (p) =>
            p.slug.includes(q) ||
            p.name.toLowerCase().includes(q) ||
            p.categories.some((c) => c.toLowerCase().includes(q)),
        );
      }
      setProviders(list.map((p) => ({ ...p, connected: connSlugs.has(p.slug) })));
    } finally {
      setLoading(false);
    }
  }, [search, tab, refreshConnections]);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  const visible = providers;

  async function handleConnect(provider: CatalogProvider) {
    if (offline) {
      setError("Sign in and ensure the API is running to connect integrations.");
      return;
    }
    if (!nangoConfigured) {
      setError("Nango is not configured on the server (NANGO_SECRET_KEY).");
      return;
    }

    setBusySlug(provider.slug);
    setError(null);

    try {
      const session = await apiPost<ConnectSession>("/api/nango/connect-session", {
        provider: provider.slug,
      });

      const nango = new Nango();
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          fn();
        };

        const connect = nango.openConnectUI({
          onEvent: (event) => {
            if (event.type === "connect") {
              void (async () => {
                try {
                  await apiPost("/api/nango/connections/sync", {
                    provider: provider.slug,
                    connectionId: event.payload.connectionId,
                    integrationId:
                      event.payload.providerConfigKey || session.integrationId,
                  });
                  await refreshConnections();
                  await loadProviders();
                  finish(resolve);
                } catch (e) {
                  finish(() =>
                    reject(e instanceof Error ? e : new Error(String(e))),
                  );
                }
              })();
            } else if (event.type === "error") {
              finish(() => reject(new Error(event.payload.errorMessage)));
            } else if (event.type === "close") {
              finish(resolve);
            }
          },
        });
        connect.setSessionToken(session.sessionToken);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed");
    } finally {
      setBusySlug(null);
    }
  }

  async function handleDisconnect(provider: CatalogProvider) {
    setBusySlug(provider.slug);
    setError(null);
    try {
      await apiDelete(`/api/nango/connections/${encodeURIComponent(provider.slug)}`);
      await refreshConnections();
      await loadProviders();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Disconnect failed");
    } finally {
      setBusySlug(null);
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "featured", label: "Featured" },
    { id: "all", label: "All OAuth" },
    { id: "connected", label: "Connected" },
  ];

  return (
    <SettingsShell
      title="Integrations"
      subtitle="Connect the tools your team already uses — 400+ OAuth providers via Nango."
    >
      <div className={styles.sectionToolbar}>
        <div className={styles.tabs} role="tablist" aria-label="Integrations filters">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              className={styles.tab}
              data-active={tab === t.id}
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <label className={styles.searchField}>
          <Search size={15} aria-hidden />
          <input
            type="search"
            placeholder="Search providers…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search integrations"
          />
        </label>
      </div>

      {offline && (
        <p className={styles.integrationDesc} style={{ margin: 0 }}>
          API offline — showing static catalog. Connect and disconnect require a live session.
        </p>
      )}
      {!nangoConfigured && !offline && (
        <p className={styles.integrationDesc} style={{ margin: 0 }}>
          Nango secret key not set on the API. Add NANGO_SECRET_KEY to enable OAuth connect flows.
        </p>
      )}
      {error && (
        <p className={styles.integrationDesc} style={{ margin: 0, color: "var(--signal-red)" }}>
          {error}
        </p>
      )}

      {loading && visible.length === 0 ? (
        <p className={styles.integrationDesc}>Loading integrations…</p>
      ) : visible.length === 0 ? (
        <p className={styles.integrationDesc}>
          {tab === "connected"
            ? "No connected integrations yet. Open Featured or All OAuth to connect one."
            : "No providers match your search."}
        </p>
      ) : (
        <div className={styles.integrationGrid}>
          {visible.map((item) => {
            const isConnected = item.connected || connectedSlugs.has(item.slug);
            const isBusy = busySlug === item.slug;
            return (
              <article key={item.slug} className={styles.integrationCard}>
                <div className={styles.integrationTop}>
                  <span className={styles.brandMark}>
                    <ProviderCatalogIcon
                      slug={item.slug}
                      name={item.name}
                      logoUrl={item.logoUrl}
                      size={26}
                    />
                  </span>
                  <strong>{item.name}</strong>
                </div>
                <p className={styles.integrationDesc}>
                  {item.description || descriptionFor(item.categories, item.name)}
                </p>
                <div className={styles.integrationFooter}>
                  {isConnected ? (
                    <>
                      <StatusPill label="Connected" tone="connected" />
                      <button
                        type="button"
                        className={styles.ghostBtn}
                        disabled={isBusy}
                        onClick={() => void handleDisconnect(item)}
                      >
                        {isBusy ? "…" : "Disconnect"}
                      </button>
                    </>
                  ) : (
                    <>
                      <StatusPill label="Not connected" tone="pending" />
                      <button
                        type="button"
                        className={pageStyles.primaryBtn}
                        disabled={isBusy || offline || !nangoConfigured}
                        onClick={() => void handleConnect(item)}
                      >
                        {isBusy ? "Connecting…" : "Connect"}
                      </button>
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </SettingsShell>
  );
}
