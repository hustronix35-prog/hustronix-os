import { Suspense } from "react";
import { SettingsClient } from "./SettingsClient";

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-sm text-hx-muted">Loading settings…</div>
      }
    >
      <SettingsClient />
    </Suspense>
  );
}
