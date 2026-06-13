export async function transcribeBuffer(buffer: Buffer): Promise<string> {
    console.log("[Audio] Transcription disabled in hardened V1.0 stub.");
    return "Audio transcription placeholder";
}

export async function transcribeAudio(url: string, fileId: string): Promise<string> {
    console.log("[Audio] Remote transcription disabled in hardened V1.0 stub.");
    return "Voice message placeholder";
}
