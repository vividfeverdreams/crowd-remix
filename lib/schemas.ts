import { z } from "zod";

function requiredText(label: string, maxLength: number) {
  return z
    .string({
      required_error: `${label} is required.`
    })
    .trim()
    .min(1, `${label} is required.`)
    .max(maxLength, `${label} must be ${maxLength} characters or fewer.`);
}

const optionalText = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().max(100).optional()
);

const optionalUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().url("Enter a valid image reference URL.").optional()
);

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

export const sessionFormSchema = z.object({
  name: requiredText("Session name", 100),
  artistName: requiredText("Artist", 100),
  trackName: requiredText("Track", 100),
  creativeBible: requiredText("Creative bible", 600),
  allowedMotifs: requiredText("Allowed motifs", 400),
  bannedTerms: requiredText("Banned terms", 400),
  colorPalette: requiredText("Color palette", 200),
  motionRules: requiredText("Motion rules", 300),
  basePrompt: requiredText("Base prompt", 1200),
  imageReferenceUrl: optionalUrl,
  smsNumber: optionalText,
  venueSafeMode: z.boolean().default(true),
  autoSelectEnabled: z.boolean().default(true)
});

export const publicSubmissionSchema = z.object({
  prompt: z.string().min(4).max(240),
  senderLabel: z.string().max(80).optional()
});

export const inboundSmsSchema = z.object({
  Body: z.string().min(1),
  From: z.string().min(3),
  To: z.string().min(3),
  MessageSid: z.string().optional()
});

export const controlSchema = z.object({
  action: z.enum(["pause-selection", "resume-selection", "skip-next", "fallback-remix", "stop-session"]),
  value: z.boolean().optional()
});
