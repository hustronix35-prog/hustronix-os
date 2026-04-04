import { Pinecone } from "@pinecone-database/pinecone";
import "dotenv/config";

async function createIndex() {
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  const indexName = process.env.PINECONE_INDEX || "gravity-claw-memory";
  
  console.log(`🏗️ Creating Pinecone index: ${indexName}...`);
  try {
    await pc.createIndex({
      name: indexName,
      dimension: 3072, // Matches the Gemini embedding dimension we verified
      metric: 'cosine',
      spec: {
        serverless: {
          cloud: 'aws',
          region: 'us-east-1'
        }
      }
    });
    console.log("✅ Index creation initiated. It may take a minute to become ready.");
  } catch (error: any) {
    console.error("❌ Failed to create index:", error.message);
  }
}

createIndex().catch(console.error);
