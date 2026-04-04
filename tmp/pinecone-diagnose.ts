import { Pinecone } from "@pinecone-database/pinecone";
import { embedText } from "../src/llm.js";
import "dotenv/config";

async function diagnose() {
  console.log("🔍 Diagnosing Pinecone Setup...");
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  const indexName = process.env.PINECONE_INDEX!;
  
  try {
    const desc = await pc.describeIndex(indexName);
    console.log("📍 Index Description:", JSON.stringify(desc, null, 2));
    
    const testText = "Test embedding";
    const vector = await embedText(testText);
    console.log("📏 Generated Vector Dimension:", vector.length);
    
    if (desc.dimension !== vector.length) {
      console.warn(`⚠️ DIMENSION MISMATCH: Index expected ${desc.dimension}, but got ${vector.length}`);
    }

    const index = pc.index(indexName);
    console.log("📤 Attempting upsert...");
    await index.upsert([
      {
        id: "test-id-1",
        values: vector,
        metadata: { text: "test" }
      }
    ]);
    console.log("✅ Upsert SUCCESS!");

  } catch (error: any) {
    console.error("❌ Diagnosis FAILED:", error.message);
    if (error.response?.data) {
        console.error("DETAILS:", JSON.stringify(error.response.data, null, 2));
    }
  }
}

diagnose().catch(console.error);
