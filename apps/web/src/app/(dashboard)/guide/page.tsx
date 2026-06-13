import type { Metadata } from "next";
import { GuideClient } from "./GuideClient";

export const metadata: Metadata = {
  title: "Product guide , HUSTRONIX",
  description:
    "Walkthrough of Mission Control, Execute, Signals, Chat, Reports, Teams, and Settings.",
};

export default function GuidePage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <GuideClient />
    </div>
  );
}
