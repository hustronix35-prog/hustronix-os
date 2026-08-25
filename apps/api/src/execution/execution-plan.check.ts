import { classifyPlanAction, readinessPct, recommendedNext } from "./execution-plan.js";

if (classifyPlanAction({ status: "PENDING", owner: "Rahul", successCondition: "SSO done", incompleteDeps: 0 }) !== "ready") {
  throw new Error("pending+owner+success → ready");
}
if (classifyPlanAction({ status: "ACTIVE", owner: "Rahul", successCondition: "SSO done", incompleteDeps: 0 }) !== "in_progress") {
  throw new Error("active → in_progress");
}
if (classifyPlanAction({ status: "BLOCKED", owner: "Rahul", successCondition: "SSO done", incompleteDeps: 0 }) !== "blocked") {
  throw new Error("blocked status → blocked");
}
if (classifyPlanAction({ status: "PENDING", owner: "system", successCondition: "SSO done", incompleteDeps: 0 }) !== "needs_clarification") {
  throw new Error("system owner → clarify");
}
if (classifyPlanAction({ status: "PENDING", owner: "Rahul", successCondition: null, incompleteDeps: 0 }) !== "needs_clarification") {
  throw new Error("missing success → clarify");
}
if (classifyPlanAction({ status: "PENDING", owner: "Rahul", successCondition: "SSO done", incompleteDeps: 1 }) !== "needs_clarification") {
  throw new Error("incomplete dep → clarify");
}
if (classifyPlanAction({ status: "DONE", owner: "system", successCondition: null, incompleteDeps: 0 }) !== "done") {
  throw new Error("done wins");
}

const counts = {
  total: 6,
  ready: 4,
  inProgress: 0,
  blocked: 1,
  needsClarification: 1,
  done: 0,
  owners: 4,
  dependencies: 2,
  existingWork: 1,
  ownerConflicts: 0,
};
if (readinessPct(counts) !== 67) throw new Error(`readiness ${readinessPct(counts)}`);
if (!recommendedNext(counts).toLowerCase().includes("blocker")) {
  throw new Error(`next ${recommendedNext(counts)}`);
}
if (readinessPct({ ready: 0, inProgress: 0, blocked: 0, needsClarification: 0 }) !== 0) {
  throw new Error("empty readiness");
}
if (!recommendedNext({ ...counts, total: 0 }).toLowerCase().includes("no linked")) {
  throw new Error("empty next");
}

console.log("execution-plan.check ok");
