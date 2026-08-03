import { env } from "@/lib/env";

export type GoogleConnectionStatus = {
  configured: boolean;
  provider: "runway" | "gemini" | "demo";
  source: "env" | "none";
  last4: string | null;
};

function maskLast4(apiKey: string | null | undefined) {
  return apiKey ? apiKey.slice(-4) : null;
}

export async function getEffectiveGeminiApiKeyForUser(_userId: string) {
  return env.geminiApiKey || null;
}

export async function getGoogleConnectionStatusForUser(
  _userId: string
): Promise<GoogleConnectionStatus> {
  if (env.runwayApiSecret) {
    return {
      configured: true,
      provider: "runway",
      source: "env",
      last4: maskLast4(env.runwayApiSecret)
    };
  }

  if (env.geminiApiKey) {
    return {
      configured: true,
      provider: "gemini",
      source: "env",
      last4: maskLast4(env.geminiApiKey)
    };
  }

  return {
    configured: false,
    provider: "demo",
    source: "none",
    last4: null
  };
}
