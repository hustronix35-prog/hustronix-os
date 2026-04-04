import { config } from "./config.js";
import { embedText } from "./llm.js";
import { randomUUID } from "crypto";

/**
 * Embeds text and saves it to the Pinecone index.
 */
export async function saveSemanticMemory(text: string): Promise<void> {
  const vector = await embedText(text);
  const host = `${config.pinecone.index}-k06yyo6.svc.aped-4627-b74a.pinecone.io`; // Derived from verification

  const response = await fetch(`https://${host}/vectors/upsert`, {
    method: "POST",
    headers: {
      "Api-Key": config.pinecone.apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      vectors: [{
        id: randomUUID(),
        values: vector,
        metadata: {
          text,
          timestamp: new Date().toISOString()
        }
      }]
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Pinecone Upsert Failed: ${err}`);
  }
}

/**
 * Searches the Pinecone index for semantically similar memories.
 */
export async function searchSemanticMemory(query: string, topK = 5): Promise<string[]> {
  const queryVector = await embedText(query);
  const host = `${config.pinecone.index}-k06yyo6.svc.aped-4627-b74a.pinecone.io`;

  const response = await fetch(`https://${host}/query`, {
    method: "POST",
    headers: {
      "Api-Key": config.pinecone.apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      vector: queryVector,
      topK,
      includeMetadata: true
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Pinecone Query Failed: ${err}`);
  }

  const results: any = await response.json();
  if (!results.matches) return [];

  return results.matches
    .map((match: any) => match.metadata?.text as string)
    .filter((text: string) => text !== undefined);
}
