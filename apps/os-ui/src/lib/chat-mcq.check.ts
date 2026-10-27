import { splitChatContentSegments, stripIncompleteMcqFence } from "./chat-mcq.js";

const sample = [
  "**Returning to your earlier question:**",
  "",
  "---",
  "",
  "```hx-mcq",
  JSON.stringify({
    version: "1",
    questions: [
      {
        id: "q1",
        prompt: "What should we clarify first?",
        options: [
          { id: "a", label: "Scope of work" },
          { id: "b", label: "Timeline" },
        ],
      },
    ],
  }),
  "```",
  "",
  "Thanks.",
].join("\n");

const segs = splitChatContentSegments(sample);
if (segs.length !== 3) throw new Error(`expected 3 segments, got ${segs.length}`);
if (segs[0].type !== "markdown" || !segs[0].content.includes("**Returning")) {
  throw new Error("markdown head missing");
}
if (segs[1].type !== "mcq" || segs[1].payload.questions[0].id !== "q1") {
  throw new Error("mcq missing");
}
if (segs[2].type !== "markdown") throw new Error("tail missing");

const partial = stripIncompleteMcqFence("Intro\n\n```hx-mcq\n{\"version\"");
if (!partial.includes("Loading choices") || partial.includes('{"version"')) {
  throw new Error(`incomplete fence not stripped: ${partial}`);
}

console.log("chat-mcq.check ok");
