import { proposeFromSituation } from "./org-console.js";
import { formatPlanModePrompt } from "../plan-mode.js";

const proposed = proposeFromSituation({
  drafts: [{ id: "d1", vow: "Launch enterprise plan" }],
  plan: {
    decisionId: "d2",
    vow: "Active bet",
    status: "ACTIVE",
    actions: [
      {
        taskId: "t-ready",
        label: "Finish SSO",
        owner: "Rahul",
        status: "PENDING",
        kind: "ready",
        weight: 1,
        incompleteDeps: 0,
        blockedReasons: [],
        clarification: null,
        existingWork: [],
      },
      {
        taskId: "t-block",
        label: "Security review",
        owner: "Arjun",
        status: "BLOCKED",
        kind: "blocked",
        weight: 1,
        incompleteDeps: 1,
        blockedReasons: ["dependency_incomplete:x"],
        clarification: null,
        existingWork: [],
      },
    ],
    counts: {
      total: 2,
      ready: 1,
      inProgress: 0,
      blocked: 1,
      needsClarification: 0,
      done: 0,
      owners: 2,
      dependencies: 1,
      existingWork: 0,
      ownerConflicts: 0,
    },
    owners: [],
    existingWork: [],
    readinessPct: 50,
    recommendedNext: "Resolve blockers before starting more work.",
  },
});

if (!proposed.some((a) => a.type === "commit_decision" && a.decisionId === "d1")) {
  throw new Error("draft commit missing");
}
if (!proposed.some((a) => a.type === "start_task" && a.taskId === "t-ready" && a.gate === "ready")) {
  throw new Error("ready start missing");
}
if (!proposed.some((a) => a.type === "open_clarification" && a.gate === "waiting")) {
  throw new Error("blocked clarify missing");
}
if (proposed.some((a) => a.type === "start_task" && a.taskId === "t-block")) {
  throw new Error("must not auto-start blocked work");
}

const consolePrompt = formatPlanModePrompt(false, true);
if (!consolePrompt.includes("Approve & Execute")) {
  throw new Error("console mode must point at Approve & Execute");
}
if (consolePrompt.includes("Plan mode (this turn — strict)")) {
  throw new Error("console mode must not use clarifying-only plan mode");
}

console.log("org-console.check ok");
