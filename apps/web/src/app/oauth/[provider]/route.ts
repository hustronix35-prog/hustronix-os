import { NextResponse, type NextRequest } from "next/server";
import {
  backendProviderId,
  isOAuthProviderSlug,
  resolveOAuthAuthorizeUrl,
} from "@/lib/oauth-providers";

/**
 * OAuth start URLs live here (not under `/api/*`) because `next.config`
 * rewrites every `/api/*` request to the Express backend — popups need a
 * same-origin entry that delegates to the API's CSRF-protected start handler.
 *
 * Routing logic:
 *   1. Manual override (env `OAUTH_<SLUG>_URL`) wins for any slug.
 *   2. Otherwise we forward to `/api/oauth/{providerId}/start` so the backend
 *      generates a session-bound state token and builds the authorize URL
 *      from `oauthProviders.ts`.
 *
 * Same-origin proxy ensures the session cookie is sent — the backend
 * needs it to bind the CSRF state to the calling user.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider } = await context.params;

  if (!isOAuthProviderSlug(provider)) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
  }

  /** Manual URL override — used for legacy Slack installs and rare custom flows. */
  const manual = resolveOAuthAuthorizeUrl(provider);
  if (manual) return NextResponse.redirect(manual);

  const backendId = backendProviderId(provider);
  if (!backendId) {
    const back = new URL("/settings", request.url);
    back.searchParams.set("tab", "connections");
    back.searchParams.set("oauthMissing", provider);
    return NextResponse.redirect(back);
  }

  /**
   * Use same-origin so cookies travel with the request; Next's rewrite forwards
   * `/api/oauth/...` to the API, which sets a redirect to the provider's
   * authorize URL. We redirect with `307` to preserve method semantics.
   */
  const start = new URL(`/api/oauth/${backendId}/start`, request.url);
  start.searchParams.set("redirect_path", "/settings?tab=connections");
  return NextResponse.redirect(start, 307);
}
