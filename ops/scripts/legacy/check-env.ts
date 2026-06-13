import { config } from "../../../apps/api/src/config.ts";
console.log("ANTHROPIC_API_KEY present:", !!config.anthropic.apiKey);
console.log("OPENAI_API_KEY present:", !!config.openai.apiKey);
console.log("GEMINI_API_KEY present:", !!config.google.apiKey);
console.log("GROQ_API_KEY present:", !!config.groq.apiKey);
console.log("Active Provider:", config.agent.activeProvider);
console.log(
  "Google OAuth (GOOGLE_CLIENT_ID + GOOGLE_REDIRECT_URI):",
  !!(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_REDIRECT_URI?.trim()),
);
