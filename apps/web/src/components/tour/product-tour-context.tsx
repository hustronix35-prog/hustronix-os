"use client";

import { createContext, useContext } from "react";

export type ProductTourContextValue = {
  ready: boolean;
  isSpotlightActive: boolean;
  welcomeOpen: boolean;
  finishOpen: boolean;
  stepIndex: number;
  stepCount: number;
  skipped: boolean;
  completed: boolean;
  showResumeBanner: boolean;
  openWelcome: () => void;
  startTour: (fromStep?: number) => void;
  resumeTour: () => void;
  skipTour: () => void;
  restartTour: () => Promise<void>;
  dismissWelcome: () => void;
  closeFinish: () => void;
};

export const ProductTourContext = createContext<ProductTourContextValue | null>(null);

export function useProductTour(): ProductTourContextValue {
  const ctx = useContext(ProductTourContext);
  if (!ctx) {
    throw new Error("useProductTour must be used within ProductTourProvider");
  }
  return ctx;
}

export function useProductTourOptional(): ProductTourContextValue | null {
  return useContext(ProductTourContext);
}
