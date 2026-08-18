import { z } from "zod";
import {
  defaultVideoModelId,
  getVideoModelDefinition,
  isVideoModelDurationSupported,
  videoModelIds
} from "@/lib/video-models";

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
  allowedMotifs: z.string().trim().max(400, "Allowed motifs must be 400 characters or fewer."),
  bannedTerms: requiredText("Banned terms", 400),
  colorPalette: requiredText("Color palette", 200),
  motionRules: requiredText("Motion rules", 300),
  basePrompt: requiredText("Base prompt", 1200),
  imageReferenceUrl: optionalUrl,
  smsNumber: optionalText,
  venueSafeMode: z.boolean().default(true),
  artistControlEnabled: z.boolean().default(true),
  autoSelectEnabled: z.boolean().default(true),
  videoModel: z.enum(videoModelIds).default(defaultVideoModelId),
  videoDurationSeconds: z
    .number()
    .int("Video length must be a whole number of seconds.")
    .default(getVideoModelDefinition(defaultVideoModelId).defaultDurationSeconds),
  submissionRateLimitEnabled: z.boolean().default(false),
  submissionRateLimitCount: z
    .number()
    .int("Submission limit must be a whole number.")
    .min(1, "Submission limit must be at least 1.")
    .max(20, "Submission limit must be 20 or fewer.")
    .default(3)
}).superRefine((session, context) => {
  if (
    !isVideoModelDurationSupported(
      session.videoModel,
      session.videoDurationSeconds
    )
  ) {
    const model = getVideoModelDefinition(session.videoModel);

    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Video length must be between ${model.minDurationSeconds} and ${model.maxDurationSeconds} seconds for ${model.label}.`,
      path: ["videoDurationSeconds"]
    });
  }
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
  templateId: z
    .string()
    .trim()
    .min(1, "Choose a remix statement.")
    .max(100)
    .regex(/^[a-z0-9-]+$/, "Choose a valid remix statement."),
  responseId: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === ""
        ? undefined
        : value,
    z
      .string()
      .trim()
      .max(120)
      .regex(/^[a-z0-9-]+$/, "Choose a valid remix answer.")
      .optional()
  ),
  senderLabel: z
    .string()
    .trim()
    .min(2, "Choose a nickname with at least 2 characters.")
    .max(24, "Keep your nickname to 24 characters or fewer.")
    .regex(
      /^[\p{L}\p{N}][\p{L}\p{N} _.-]*$/u,
      "Use letters, numbers, spaces, dots, dashes, or underscores in your nickname."
    ),
  participantToken: z.string().trim().min(16).max(200)
});

export const inboundSmsSchema = z.object({
  Body: z.string().min(1),
  From: z.string().min(3),
  To: z.string().min(3),
  MessageSid: z.string().optional()
});

export const controlSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.enum(["pause-selection", "resume-selection", "skip-next", "fallback-remix", "stop-session"])
  }),
  z.object({
    action: z.literal("cue-generation"),
    assetId: z.string().trim().min(1).max(120)
  }),
  z.object({
    action: z.literal("set-qr-overlay"),
    value: z.boolean()
  }),
  z.object({
    action: z.literal("set-wordmark-overlay"),
    value: z.boolean()
  }),
  z.object({
    action: z.literal("set-wordmark-opacity"),
    value: z.number().min(0).max(1)
  }),
  z.object({
    action: z.literal("set-wordmark-size"),
    value: z.number().min(0.3).max(1.5)
  }),
  z.object({
    action: z.literal("set-wordmark-audio-reactive-only"),
    value: z.boolean()
  }),
  z.object({
    action: z.literal("set-progress-overlay"),
    value: z.boolean()
  })
]);
