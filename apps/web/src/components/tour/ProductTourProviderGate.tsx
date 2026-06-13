"use client";

import { Suspense, type ReactNode } from "react";
import { ProductTourProvider } from "@/components/tour/ProductTourProvider";

export function ProductTourProviderGate({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={children}>
      <ProductTourProvider>{children}</ProductTourProvider>
    </Suspense>
  );
}
