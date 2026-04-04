import { runAgentLoop } from "../src/agent.js";
import { setActiveModel } from "../src/llm.js";
import { clearWorkingMemory } from "../src/memory.js";

async function testResearch() {
  clearWorkingMemory();
  setActiveModel("google", "gemini-2.0-flash");
  const niche = "AI Security startups";
  console.log(`🚀 Testing autonomous research for: ${niche}`);

  const instruction = `RESEARCH TASK: Find exactly 1 NEW early-stage AI Security startup (other than Noma, Seven, Fig, etc). 
  YOU MUST:
  1. Use web_search to find it.
  2. Use website_audit to audit it.
  3. Use lead_logger to log it.
  Confirm once you have logged it.`;

  try {
    const reply = await runAgentLoop(instruction);
    console.log("✅ Success! Agent reply:", reply);
  } catch (err) {
    console.error("❌ Test failed:", err);
  }
}

testResearch();
