import { lead_logger } from "../src/tools/lead-logger.js";

async function test() {
  console.log("🚀 Logging lead...");
  const result = await lead_logger.execute({ 
    companyName: "Noma Security",
    website: "https://noma.security/",
    founderName: "Niv Fedler",
    email: "niv@noma.security", // Example guess, will refine if possible
    uxScore: 7,
    status: "audited"
  });
  console.log("LOG RESULT:", result);
}

test().catch(console.error);
