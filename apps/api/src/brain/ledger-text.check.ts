import { formatOutcomes, formatStringList, outcomeHeadline, parseLedgerJson } from "./ledger-text.js";
import { githubBrowse, jiraBrowseUrl, resolveSignalOpenTargets, slackArchiveUrl } from "./signal-open.js";

const outcomesRaw = '[{"metric":"FlowOps permission regression","target":"Resolve with cited evidence"}]';
const outcomes = formatOutcomes(outcomesRaw);
if (outcomes.length !== 1 || outcomes[0].metric !== "FlowOps permission regression") {
  throw new Error(`outcomes ${JSON.stringify(outcomes)}`);
}
if (outcomeHeadline(outcomes, "x").includes("[")) throw new Error("headline still looks like JSON");

const constraints = formatStringList('["Do not re-enable flag for Kaldera without QA sign-off"]');
if (constraints[0] !== "Do not re-enable flag for Kaldera without QA sign-off") {
  throw new Error(`constraints ${JSON.stringify(constraints)}`);
}
if (typeof parseLedgerJson("not-json") !== "string") throw new Error("plain text passthrough");

const jira = jiraBrowseUrl({
  self: "https://acme.atlassian.net/rest/api/3/issue/10001",
  issueKey: "FLOW-12",
});
if (jira !== "https://acme.atlassian.net/browse/FLOW-12") throw new Error(`jira browse ${jira}`);

const gh = githubBrowse({ repo: "acme/os", number: "44", event: "pull_request" }, "github.pull_request.opened");
if (!gh.some((t) => t.url === "https://github.com/acme/os/pull/44")) throw new Error(`gh ${JSON.stringify(gh)}`);

const slack = slackArchiveUrl({ teamId: "T1", channel: "C9", ts: "1710000000.123" });
if (!slack?.includes("/client/T1/C9/")) throw new Error(`slack ${slack}`);

const targets = resolveSignalOpenTargets({
  source: "JIRA",
  source_subtype: "jira:issue_updated",
  content: "[jira:jira:issue_updated] FLOW-12 status=In Progress",
  ingest_meta: JSON.stringify({ issueKey: "FLOW-12", self: "https://acme.atlassian.net/rest/api/3/issue/1" }),
});
if (!targets.some((t) => t.section === "issue" && t.url.endsWith("/browse/FLOW-12"))) {
  throw new Error(`jira targets ${JSON.stringify(targets)}`);
}

console.log("brain/ledger-text.check ok");
