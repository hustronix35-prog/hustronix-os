import https from "https";
import "dotenv/config";

const host = "gravity-claw-memory-k06yyo6.svc.aped-4627-b74a.pinecone.io";
const apiKey = process.env.PINECONE_API_KEY!;

const data = JSON.stringify({
  vectors: [{
    id: "rest-test-2",
    values: new Array(3072).fill(0.1),
    metadata: { text: "NATIVE HTTPS TEST" }
  }]
});

const options = {
  hostname: host,
  path: "/vectors/upsert",
  method: "POST",
  headers: {
    "Api-Key": apiKey,
    "Content-Type": "application/json",
    "Content-Length": data.length
  }
};

console.log("🌐 Sending request to Pinecone REST API...");

const req = https.request(options, (res) => {
  let body = "";
  res.on("data", (chunk) => body += chunk);
  res.on("end", () => {
    console.log(`📡 Response Status: ${res.statusCode}`);
    console.log(`📡 Response Body: ${body}`);
  });
});

req.on("error", (e) => {
  console.error(`❌ Request Error: ${e.message}`);
});

req.write(data);
req.end();
