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

export const sessionIdeaSchema = z.object({
  idea: requiredText("Session idea", 1200).refine(
    (value) => value.length >= 4,
    "Tell us a little more about the session you want to create."
  )
});

export const sessionPrefillSchema = z.object({
  name: requiredText("Session name", 100).describe("A concise, distinctive name for this live visual session."),
  artistName: requiredText("Artist", 100).describe(
    "The artist or DJ name from the idea. Use 'Live Artist' if the user did not provide one; never invent a real artist."
  ),
  trackName: requiredText("Track", 100).describe(
    "The track or set name from the idea. Use 'Continuous Mix' if the user did not provide one; never invent a real track."
  ),
  creativeBible: requiredText("Creative bible", 600).describe(
    "A cohesive art-direction paragraph covering the visual world, mood, materials, composition, lighting, and explicit stylistic boundaries."
  ),
  allowedMotifs: requiredText("Allowed motifs", 400).describe(
    "A comma-separated list of concrete visual motifs that crowd remixes may use."
  ),
  bannedTerms: requiredText("Banned terms", 400).describe(
    "A comma-separated list of imagery, subjects, styles, and safety risks that should never appear."
  ),
  colorPalette: requiredText("Color palette", 200).describe(
    "A concise comma-separated palette with evocative, production-usable color names."
  ),
  motionRules: requiredText("Motion rules", 300).describe(
    "Clear rules for camera movement, rhythm, transitions, and what motion should avoid."
  ),
  basePrompt: requiredText("Base prompt", 1200).describe(
    "A polished, standalone prompt for the first looping cinematic concert visual."
  )
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
