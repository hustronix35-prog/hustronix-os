import { Suspense } from "react";
import { ExecuteClient } from "./ExecuteClient";

function ExecuteFallback() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-sm text-hx-muted">
      Loading execution board…
    </div>
  );
}

export default function ExecutePage() {
  return (
    <Suspense fallback={<ExecuteFallback />}>
      <ExecuteClient />
    </Suspense>
  );
}
