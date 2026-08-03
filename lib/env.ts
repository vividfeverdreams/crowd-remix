export const env = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  authSecret: process.env.AUTH_SECRET ?? "dev-secret-change-me",
  openAiApiKey: process.env.OPENAI_API_KEY ?? "",
  openAiTextModel: process.env.OPENAI_TEXT_MODEL ?? "gpt-5.4-mini",
  runwayApiSecret: process.env.RUNWAYML_API_SECRET ?? "",
  runwayVideoModel: process.env.RUNWAY_VIDEO_MODEL ?? "gemini_omni_flash",
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  geminiVideoModel: process.env.GEMINI_VIDEO_MODEL ?? "gemini-omni-flash-preview",
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN ?? "",
  twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER ?? "",
  sessionCookieName: "dream-sequence-session"
} as const;

export function hasOpenAiCredentials() {
  return Boolean(env.openAiApiKey);
}

export function hasGeminiCredentials() {
  return Boolean(env.geminiApiKey);
}

export function hasRunwayCredentials() {
  return Boolean(env.runwayApiSecret);
}

export function hasTwilioCredentials() {
  return Boolean(env.twilioAccountSid && env.twilioAuthToken);
}
