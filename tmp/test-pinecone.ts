import { saveSemanticMemory, searchSemanticMemory } from "../src/semantic.js";
import { embedText } from "../src/llm.js";

async function testPinecone() {
  console.log("🌲 Testing Pinecone Semantic Memory...");
  try {
    const testText = "Gravity Claw is a powerful agentic AI OS.";
    
    console.log("🧠 Generating test embedding...");
    const vector = await embedText(testText);
    console.log("📏 Vector Length:", vector?.length);
    
    if (!vector || vector.length === 0) {
      throw new Error("Failed to generate embedding vector.");
    }

    console.log("📤 Saving test memory...");
    await saveSemanticMemory(testText);
    
    console.log("🔍 Searching for test memory...");
    const results = await searchSemanticMemory("What is Gravity Claw?");
    
    console.log("✅ Pinecone Results:", results);
    if (results.some(r => r.includes("Gravity Claw"))) {
      console.log("🎉 Pinecone is WORKING!");
    } else {
      console.log("⚠️ Pinecone returned no matching results.");
    }
  } catch (error: any) {
    console.error("❌ Pinecone Test FAILED:", error.message);
    if (error.response) {
       console.error("DEBUG DATA:", JSON.stringify(error.response.data, null, 2));
    }
  }
}

testPinecone().catch(console.error);
