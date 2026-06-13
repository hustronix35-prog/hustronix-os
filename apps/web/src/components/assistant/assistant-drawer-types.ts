export type AssistantDrawerTab = "assistant" | "tour" | "guide";

export const ASSISTANT_DRAWER_TABS: {
  id: AssistantDrawerTab;
  label: string;
  shortLabel: string;
}[] = [
  { id: "assistant", label: "Chat & help", shortLabel: "Help" },
  { id: "tour", label: "Interactive tour", shortLabel: "Tour" },
  { id: "guide", label: "Full guide", shortLabel: "Guide" },
];
