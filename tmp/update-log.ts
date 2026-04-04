import { lead_logger } from "../src/tools/lead-logger.js";

async function test() {
  console.log("🚀 Updating lead with correct founder...");
  const result = await lead_logger.execute({ 
    companyName: "Noma Security",
    website: "https://noma.security/",
    founderName: "Niv Braun", // Corrected
    email: "niv@noma.security",
    uxScore: 8,
    status: "drafted"
  });
  console.log("LOG RESULT:", result);
}

test().catch(console.error);
