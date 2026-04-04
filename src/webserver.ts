import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import path from "path";
import http from "http";
import { runAgentLoop, pruneWorkingMemoryIfNeeded } from "./agent.js";
import { saveMessage, getWorkingMemory } from "./memory.js";
import { transcribeBuffer } from "./audio.js";
import { config } from "./config.js";

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(process.cwd(), "public")));

// Serve the secure AI workspace
app.use("/workspace", express.static(path.join(process.cwd(), "workspace")));

wss.on("connection", (ws: WebSocket) => {
  // Send history on boot
  const history = getWorkingMemory(50);
  ws.send(JSON.stringify({ 
    type: "history", 
    data: history.map(msg => ({ role: msg.role, content: msg.content }))
  }));

  ws.on("message", async (data: Buffer, isBinary: boolean) => {
    try {
      // ── VOICE (binary audio blob from browser mic) ──
      if (isBinary) {
        console.log(`[WebChat Mic] Received ${data.length} bytes of audio`);
        ws.send(JSON.stringify({ type: "typing", status: true }));
        
        const transcript = await transcribeBuffer(data);
        if (!transcript) {
          ws.send(JSON.stringify({ type: "error", message: "Could not transcribe audio." }));
          return;
        }

        console.log(`[WebChat Mic] Transcribed: "${transcript}"`);
        
        // Echo the transcription back so user can see what was heard
        ws.send(JSON.stringify({ type: "transcript", text: transcript }));
        
        saveMessage("user", transcript);
        const response = await runAgentLoop(transcript);
        saveMessage("assistant", response);
        await pruneWorkingMemoryIfNeeded();
        ws.send(JSON.stringify({ type: "text", text: response }));
        return;
      }

      // ── TEXT (standard JSON message) ──
      const msg = JSON.parse(data.toString());
      if (msg.type === "text") {
        console.log(`[WebChat User] ${msg.text}`);
        saveMessage("user", msg.text);
        ws.send(JSON.stringify({ type: "typing", status: true }));
        const response = await runAgentLoop(msg.text);
        saveMessage("assistant", response);
        await pruneWorkingMemoryIfNeeded();
        ws.send(JSON.stringify({ type: "text", text: response }));
      }
    } catch (err: unknown) {
      console.error("WebSocket message error:", err);
      ws.send(JSON.stringify({ type: "error", message: "Gravity Claw agent loop failed to process the request." }));
    }
  });
});

export function startWebServer() {
  const PORT = config.server.port;
  server.listen(PORT, () => {
    console.log(`🌐 Premium WebChat Interface is live at http://localhost:${PORT}`);
  });
}
