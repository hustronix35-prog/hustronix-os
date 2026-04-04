import { config } from "./config.js";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import os from "os";

// Initialize OpenAI dedicated solely for Whisper since it requires the OpenAI API
const openai = new OpenAI({
  apiKey: config.llm.openaiKey
});

export async function transcribeAudio(fileUrl: string, fileId: string): Promise<string> {
  const tmpPath = path.join(os.tmpdir(), `${fileId}.ogg`);
  
  try {
    console.log(`🎙️ Downloading voice piece ${fileId} from Telegram...`);
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch audio: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Write buffer to a temp file
    fs.writeFileSync(tmpPath, buffer);
    
    console.log(`🎙️ Transcribing with Whisper API...`);
    // Read the temp file strictly to satisfy OpenAI's File interface requirement
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath),
      model: "whisper-1",
      response_format: "text",
    });

    return transcription.trim();
  } catch (err: any) {
    console.error("Transcription failed:", err);
    throw err;
  } finally {
    // Always clean up the temp file
    if (fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
    }
  }
}

/**
 * Transcribe a raw audio buffer (from WebChat microphone) using Whisper.
 */
export async function transcribeBuffer(audioBuffer: Buffer): Promise<string> {
  const tmpPath = path.join(os.tmpdir(), `webchat_voice_${Date.now()}.webm`);

  try {
    fs.writeFileSync(tmpPath, audioBuffer);
    console.log(`🎙️ Transcribing WebChat voice (${audioBuffer.length} bytes)...`);

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath),
      model: "whisper-1",
      response_format: "text",
    });

    return transcription.trim();
  } catch (err: any) {
    console.error("WebChat transcription failed:", err);
    throw err;
  } finally {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
}

export async function generateSpeech(text: string): Promise<Buffer> {
  try {
    console.log(`🎙️ Synthesizing voice note (${text.length} chars)...`);
    
    // Whisper/TTS-1 max length is 4096.
    const safeText = text.substring(0, 4000);
    
    const mp3 = await openai.audio.speech.create({
      model: "tts-1",
      voice: "nova",
      input: safeText,
      response_format: "mp3"
    });

    const arrayBuffer = await mp3.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err: any) {
    console.error("Text-to-Speech failed:", err);
    throw err;
  }
}
