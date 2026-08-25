import { evaluateActionPolicy } from "./policy.js";
import { generateIntents, matchExistingWork, pickOwnerCandidate } from "./intents.js";
import type { ExecutionPlan } from "../execution-plan.js";

const plan: ExecutionPlan = {
  decisionId: "D184",
  vow: "Enterprise launch Sep 1",
  status: "ACTIVE",
  actions: [
    {
      taskId: "t-sec",
      label: "Enterprise security review",
      owner: "Rahul",
      status: "BLOCKED",
      kind: "blocked",
      weight: 1,
      incompleteDeps: 1,
      blockedReasons: ["Waiting for production access"],
      clarification: null,
      existingWork: [],
    },
    {
      taskId: "t-sso",
      label: "SSO implementation",
      owner: "Rahul",
      status: "PENDING",
      kind: "ready",
      weight: 1,
      incompleteDeps: 0,
      blockedReasons: [],
      clarification: null,
      existingWork: [{ source: "JIRA", externalId: "ENT-422", label: "ENT-422", url: null, taskId: "t-sso" }],
    },
    {
      taskId: "t-sales",
      label: "Sales training for enterprise launch",
      owner: "system",
      status: "PENDING",
      kind: "needs_clarification",
      weight: 1,
      incompleteDeps: 1,
      blockedReasons: [],
      clarification: { trigger: "OWNER_UNCLEAR", questionType: "OWNERSHIP" },
      existingWork: [],
    },
    {
      taskId: "t-legal",
      label: "Contract completion",
      owner: "Neha",
      status: "ACTIVE",
      kind: "in_progress",
      weight: 1,
      incompleteDeps: 1,
      blockedReasons: [],
      clarification: null,
      existingWork: [],
    },
    {
      taskId: "t-access",
      label: "Production access for security review",
      owner: "Ananya",
      status: "BLOCKED",
      kind: "blocked",
      weight: 1,
      incompleteDeps: 0,
      blockedReasons: ["Access request open"],
      clarification: null,
      existingWork: [],
    },
  ],
  counts: {
    total: 5,
    ready: 1,
    inProgress: 1,
    blocked: 2,
    needsClarification: 1,
    done: 0,
    owners: 3,
    dependencies: 3,
    existingWork: 1,
    ownerConflicts: 0,
  },
  owners: [
    { owner: "Rahul", activeWeight: 1, pendingWeight: 1, capacity: 3, conflict: false },
    { owner: "Neha", activeWeight: 1, pendingWeight: 0, capacity: 3, conflict: false },
  ],
  existingWork: [],
  readinessPct: 50,
  recommendedNext: "Resolve blockers before starting more work.",
};

if (evaluateActionPolicy("LINK_EXISTING_WORK").verdict !== "ALLOW") throw new Error("link should auto");
if (evaluateActionPolicy("CREATE_JIRA").verdict !== "REQUIRE_APPROVAL") throw new Error("jira needs approval");
if (evaluateActionPolicy("CREATE_MEETING").verdict !== "REQUIRE_APPROVAL") throw new Error("meeting needs approval");
if (evaluateActionPolicy("ASSIGN_OWNER").verdict !== "REQUIRE_APPROVAL") throw new Error("assign needs approval");
if (evaluateActionPolicy("REVERSE_VOW").verdict !== "DENY") throw new Error("reverse is human");
if (evaluateActionPolicy("START_TASK").verdict !== "REQUIRE_APPROVAL") throw new Error("start is not auto");

const hit = matchExistingWork(
  { signalId: "s1", source: "JIRA", externalId: "ENT-421", content: "Enterprise security review", owner: "Rahul" },
  plan.actions[0],
);
if (!hit.hit) throw new Error("should match security review ticket");

const rec = pickOwnerCandidate("Sales training", "system", [
  { name: "Priya", loadPct: 62, status: "Healthy", team: "Sales" },
  { name: "Rahul", loadPct: 90, status: "At Risk", team: "Engineering" },
], plan.owners);
if (rec?.owner !== "Priya") throw new Error(`expected Priya, got ${rec?.owner}`);

const intents = generateIntents({
  plan,
  unlinkedWork: [
    { signalId: "s1", source: "JIRA", externalId: "ENT-421", content: "Enterprise security review", owner: "Rahul" },
  ],
  people: [
    { name: "Priya", loadPct: 62, status: "Healthy", team: "Sales" },
    { name: "Rahul", loadPct: 82, status: "At Risk", team: "Engineering" },
    { name: "Neha", loadPct: 40, status: "Healthy", team: "Legal" },
  ],
});

if (!intents.some((i) => i.actionType === "LINK_EXISTING_WORK" && i.payload.externalId === "ENT-421")) {
  throw new Error("must reconcile ENT-421 instead of creating a duplicate");
}
if (intents.some((i) => i.actionType === "CREATE_JIRA" && i.executionId === "t-sec")) {
  throw new Error("must not create jira for reconciled security review");
}
if (!intents.some((i) => i.actionType === "CREATE_JIRA" && i.executionId === "t-sales")) {
  throw new Error("missing sales training should produce CREATE_JIRA");
}
if (intents.some((i) => i.actionType === "CREATE_JIRA" && i.executionId === "t-sso")) {
  throw new Error("existing SSO ticket must not be duplicated");
}
if (!intents.some((i) => i.actionType === "ASK_CLARIFICATION" && i.executionId === "t-sec")) {
  throw new Error("blocked work should open clarification");
}
if (!intents.some((i) => i.actionType === "ASSIGN_OWNER" && i.payload.owner === "Priya")) {
  throw new Error("unclear owner should propose assignment");
}
if (!intents.some((i) => i.actionType === "CREATE_MEETING")) {
  throw new Error("three dependent workstreams should propose coordination");
}
if (intents.some((i) => i.actionType === "START_TASK")) {
  throw new Error("orchestrator must not auto-start tasks");
}

console.log("orchestrator.check ok");
