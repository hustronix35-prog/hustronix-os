import "dotenv/config";

export interface Config {
  telegram: {
    botToken: string;
  };
  llm: {
    provider: "openai" | "google" | "deepseek" | "anthropic" | "ollama" | "groq";
    model: string;
    openaiKey: string;
  };
  gemini: {
    apiKey: string;
    model: string;
  };
  groq: {
    apiKey: string;
  };
  elevenlabs: {
    apiKey: string;
  };
  pinecone: {
    apiKey: string;
    index: string;
  };
  security: {
    allowedUserIds: number[];
  };
  agent: {
    maxIterations: number;
  };
  memory: {
    maxWorkingMessages: number;
    pruneThreshold: number;
  };
  server: {
    port: number;
  };
  email: {
    address: string;
    password: string;
    imapHost: string;
    imapPort: number;
    smtpHost: string;
    smtpPort: number;
    enabled: boolean;
  };
  googleSheets: {
    enabled: boolean;
    sheetId: string;
    serviceAccountPath: string;
  };
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    console.error(`❌ Missing required environment variable: ${key}`);
    console.error(`   Copy .env.example → .env and fill in your values.`);
    process.exit(1);
  }
  return value;
}

function parseUserIds(raw: string): number[] {
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0)
    .map((id) => {
      const num = Number(id);
      if (Number.isNaN(num)) {
        console.error(`❌ Invalid user ID: "${id}" — must be a number.`);
        process.exit(1);
      }
      return num;
    });
}

export const config: Config = {
  telegram: {
    botToken: requireEnv("TELEGRAM_BOT_TOKEN"),
  },
  llm: {
    provider: (process.env.DEFAULT_LLM_PROVIDER as "openai" | "google" | "deepseek" | "anthropic" | "ollama" | "groq") || "google",
    model: process.env.DEFAULT_LLM_MODEL || "gemini-2.0-flash",
    openaiKey: requireEnv("OPENAI_API_KEY"),
  },
  gemini: {
    apiKey: requireEnv("GEMINI_API_KEY"),
    model: process.env["LLM_MODEL"] ?? "gemini-2.0-flash",
  },
  groq: {
    apiKey: requireEnv("GROQ_API_KEY"),
  },
  elevenlabs: {
    apiKey: requireEnv("ELEVENLABS_API_KEY"),
  },
  pinecone: {
    apiKey: requireEnv("PINECONE_API_KEY"),
    index: requireEnv("PINECONE_INDEX"),
  },
  security: {
    allowedUserIds: parseUserIds(requireEnv("ALLOWED_USER_IDS")),
  },
  agent: {
    maxIterations: Number(process.env["MAX_ITERATIONS"] ?? "10"),
  },
  memory: {
    maxWorkingMessages: Number(process.env.MAX_WORKING_MESSAGES) || 20,
    pruneThreshold: Number(process.env.PRUNE_THRESHOLD) || 10,
  },
  server: {
    port: 3001,
  },
  email: {
    address: process.env.EMAIL_ADDRESS || "",
    password: process.env.EMAIL_PASSWORD || "",
    imapHost: process.env.IMAP_HOST || "imap.gmail.com",
    imapPort: Number(process.env.IMAP_PORT) || 993,
    smtpHost: process.env.SMTP_HOST || "smtp.gmail.com",
    smtpPort: Number(process.env.SMTP_PORT) || 465,
    enabled: !!(process.env.EMAIL_ADDRESS && process.env.EMAIL_PASSWORD),
  },
  googleSheets: {
    enabled: !!(process.env.GOOGLE_SHEET_ID && process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
    sheetId: process.env.GOOGLE_SHEET_ID || "",
    serviceAccountPath: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "",
  },
};
