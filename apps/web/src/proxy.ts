import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION = "hustronix_session";

/** Routes that require a session cookie (same-origin UI + API proxy). */
const PROTECTED = [
  "/mission-control",
  "/execute",
  "/signals",
  "/chat",
  "/reports",
  "/teams",
  "/settings",
  "/profile",
];

/** Next.js 16+: `middleware` convention renamed to `proxy` (edge boundary in front of the app). */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/login") || pathname.startsWith("/signup")) {
    // Do not redirect to the app on cookie presence alone — expired sessions
    // bounce /login ↔ /mission-control and leave the UI on "Preparing workspace…".
    // LoginClient redirects after a successful /api/me when already signed in.
    return NextResponse.next();
  }
  if (pathname.startsWith("/oauth/")) {
    return NextResponse.next();
  }

  const needsAuth = PROTECTED.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (!needsAuth) {
    return NextResponse.next();
  }

  const session = request.cookies.get(SESSION);
  if (!session?.value) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname === "/" ? "/mission-control" : pathname);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/login",
    "/signup",
    "/mission-control/:path*",
    "/execute/:path*",
    "/signals/:path*",
    "/chat/:path*",
    "/reports/:path*",
    "/teams/:path*",
    "/settings/:path*",
    "/profile/:path*",
  ],
};
