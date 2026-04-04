import { config } from "./config.js";

/**
 * Downloads an audio file from Telegram and transcribes it using Groq's Whisper API.
 * Uses native fetch to avoid pulling in large SDK dependencies.
 */
export async function transcribeAudio(fileUrl: string): Promise<string> {
  // 1. Download the file from Telegram
  const tgResponse = await fetch(fileUrl);
  if (!tgResponse.ok) {
    throw new Error(`Failed to download audio from Telegram: ${tgResponse.statusText}`);
  }
  const audioBlob = await tgResponse.blob();

  // 2. Prepare FormData for Groq API
  const formData = new FormData();
  formData.append("file", audioBlob, "voice.ogg");
  formData.append("model", "whisper-large-v3-turbo");
  formData.append("response_format", "json");

  // 3. Send to Groq for transcription
  const groqResponse = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.groq.apiKey}`,
    },
    body: formData,
  });

  if (!groqResponse.ok) {
    const errorText = await groqResponse.text();
    throw new Error(`Groq transcription failed: ${groqResponse.status} - ${errorText}`);
  }

  const result = (await groqResponse.json()) as { text: string };
  return result.text.trim();
}

/**
 * Converts text to speech using ElevenLabs API
 * Returns an ArrayBuffer containing the mp3 audio data
 */
export async function generateSpeech(text: string): Promise<ArrayBuffer> {
  // Using a good default voice ID (e.g. Rachel, or any built-in ElevenLabs voice ID)
  // Using "Adam" (pNInz6obpgDQGcFmaJgB) which is a default voice available on all free tiers
  const voiceId = "pNInz6obpgDQGcFmaJgB"; 
  
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: {
      "Accept": "audio/mpeg",
      "xi-api-key": config.elevenlabs.apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      text: text,
      model_id: "eleven_multilingual_v2",
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs TTS failed: ${response.status} - ${errorText}`);
  }

  return await response.arrayBuffer();
}
