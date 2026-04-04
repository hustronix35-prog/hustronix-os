import { website_audit } from "../src/tools/website-audit.js";

async function test() {
  console.log("🚀 Testing website_audit...");
  const result = await website_audit.execute({ 
    url: "https://noma.security/", 
    companyName: "Noma Security" 
  });
  console.log("RESULT:", JSON.stringify(result, null, 2));
}

test().catch(console.error);
