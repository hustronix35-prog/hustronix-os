import { Suspense } from "react";
import { LoginClient } from "./LoginClient";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <p className="text-center text-sm text-hx-muted">Loading…</p>
      }
    >
      <LoginClient />
    </Suspense>
  );
}
