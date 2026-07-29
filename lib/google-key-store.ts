import { env } from "@/lib/env";

export type GoogleConnectionStatus = {
  configured: boolean;
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
  if (env.geminiApiKey) {
    return {
      configured: true,
      source: "env",
      last4: maskLast4(env.geminiApiKey)
    };
  }

  return {
    configured: false,
    source: "none",
    last4: null
  };
}
