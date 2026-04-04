import OpenAI from "openai";
import "dotenv/config";

async function listModels() {
  const client = new OpenAI({
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    apiKey: process.env.GEMINI_API_KEY
  });

  try {
    const models = await client.models.list();
    console.log("AVAILABLE MODELS:");
    console.log(JSON.stringify(models.data.map(m => m.id), null, 2));
  } catch (error: any) {
    console.error("❌ Failed to list models:", error.message);
  }
}

listModels().catch(console.error);
