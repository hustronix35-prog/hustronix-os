import { Pinecone } from "@pinecone-database/pinecone";
import "dotenv/config";

async function inspect() {
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  const index = pc.index(process.env.PINECONE_INDEX!);
  
  console.log("🔎 Upsert Function:", index.upsert.toString());
  
  // Try v2 syntax wrap
  console.log("🧪 Trying v2 syntax...");
  try {
    await index.upsert({
      vectors: [{
        id: "test-v2",
        values: new Array(3072).fill(0.1),
        metadata: { text: "test" }
      }]
    } as any);
    console.log("✅ v2 Syntax Worked!");
  } catch (e: any) {
    console.log("❌ v2 Syntax Failed:", e.message);
  }

  // Try v4 syntax (plain array)
  console.log("🧪 Trying v4 syntax...");
  try {
    await index.upsert([{
      id: "test-v4",
      values: new Array(3072).fill(0.1),
      metadata: { text: "test" }
    }] as any);
    console.log("✅ v4 Syntax Worked!");
  } catch (e: any) {
    console.log("❌ v4 Syntax Failed:", e.message);
  }
}

inspect().catch(console.error);
