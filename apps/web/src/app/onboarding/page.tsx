import type { Metadata } from "next";
import { OnboardingClient } from "./OnboardingClient";

export const metadata: Metadata = {
  title: "Organization setup , HUSTRONIX",
  description: "First-time workspace onboarding for your organization.",
};

export default function OnboardingPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <OnboardingClient />
    </div>
  );
}
