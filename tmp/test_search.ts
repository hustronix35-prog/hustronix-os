import { handler } from "./src/tools/web-search.js";

async function test() {
  console.log("Testing Web Search...");
  const result = await handler({ query: "current weather in Kanpur" });
  console.log("Search Result Received:");
  console.log(result.substring(0, 500) + "...");
}

test().catch(console.error);
