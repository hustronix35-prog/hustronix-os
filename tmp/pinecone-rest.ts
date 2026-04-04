import axios from "axios";
import "dotenv/config";

async function restUpsert() {
  const host = "gravity-claw-memory-k06yyo6.svc.aped-4627-b74a.pinecone.io";
  const apiKey = process.env.PINECONE_API_KEY!;
  
  console.log(`🌐 Calling REST API: https://${host}/vectors/upsert`);
  
  try {
    const response = await axios.post(`https://${host}/vectors/upsert`, {
      vectors: [{
        id: "rest-test-1",
        values: new Array(3072).fill(0.1),
        metadata: { text: "REST API TEST" }
      }]
    }, {
      headers: {
        "Api-Key": apiKey,
        "Content-Type": "application/json"
      }
    });
    
    console.log("✅ REST Upsert Result:", response.data);
  } catch (error: any) {
    console.error("❌ REST Upsert Failed:", error.message);
    if (error.response?.data) {
      console.error("DETAILS:", JSON.stringify(error.response.data, null, 2));
    }
  }
}

restUpsert().catch(console.error);
