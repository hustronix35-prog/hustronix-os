import { Pinecone } from "@pinecone-database/pinecone";
import "dotenv/config";

async function listIndexes() {
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  try {
    const response = await pc.listIndexes();
    console.log("AVAILABLE INDEXES:");
    console.log(JSON.stringify(response.indexes, null, 2));
  } catch (error: any) {
    console.error("❌ Failed to list indexes:", error.message);
  }
}

listIndexes().catch(console.error);
