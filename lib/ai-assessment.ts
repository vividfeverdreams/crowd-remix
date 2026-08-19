import { z } from "zod";
import { env } from "@/lib/env";
import { getOpenAiClient } from "@/lib/openai-client";
import { getEffectiveOpenAiApiKeyForUser } from "@/lib/openai-key-store";
import { clamp, normalizePromptText, splitList } from "@/lib/utils";
import {
  assessedVideoPromptCharacterBudget,
  composeVideoPrompt
} from "@/lib/video-prompt-budget";

const assessmentSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  score: z.number().int().min(0).max(100),
  flags: z.array(z.string()).max(8),
  explanation: z.string().min(1).max(300),
  approvalReason: z.string().min(1).max(240),
  noveltyScore: z.number().int().min(0).max(100),
  cohesionScore: z.number().int().min(0).max(100),
  remixDeltaScore: z.number().int().min(0).max(100),
  winningPrompt: z.string().min(4).max(900)
});

type SessionContext = {
  userId?: string;
  artistName: string;
  trackName: string;
  creativeBible: string;
  allowedMotifs: string;
  bannedTerms: string;
  colorPalette: string;
  motionRules: string;
  basePrompt: string;
  venueSafeMode?: boolean;
  artistControlEnabled?: boolean;
};

type AssessmentInput = {
  submissionText: string;
  session: SessionContext;
  recentWinningPrompts: string[];
};

export type SubmissionAssessment = z.infer<typeof assessmentSchema>;

export const submissionAssessmentInstructions = [
  "You are the crowd prompt safety and remix-ranking engine for a live DJ visual platform.",
  "You must keep every approved prompt within the DJ's visual DNA.",
  "When session.allowedMotifs is empty, motifs are intentionally open-ended: do not reject or lower a score just because an idea uses an unlisted motif.",
  "Reject prompts that are unsafe, spammy, off-theme, ask for real people, public figures, copyrighted characters, copyrighted music references, or anything that is not venue-safe.",
  "For approved prompts, rewrite the input into a single focused remix instruction that creates a visibly new scene while carrying forward the session's visual DNA and seamless-loop continuity.",
  "Honor explicit camera direction in the session motion rules or crowd request. When neither specifies camera behavior, leave it open for movement that serves the requested transformation instead of inventing a restriction.",
  "Return only valid JSON that matches the provided schema."
].join(" ");

const hardBlockedTerms = [
  "nazi",
  "hitler",
  "suicide",
  "kill",
  "murder",
  "porn",
  "nude",
  "blood",
  "gore",
  "cocaine",
  "meth"
];

export async function assessSubmission(input: AssessmentInput): Promise<SubmissionAssessment> {
  if (input.session.artistControlEnabled === false) {
    return rawPromptAssessment(input);
  }

  const apiKey = input.session.userId
    ? await getEffectiveOpenAiApiKeyForUser(input.session.userId)
    : env.openAiApiKey || null;

  if (!apiKey) {
    return heuristicAssessment(input);
  }

  try {
    const client = getOpenAiClient(apiKey);

    if (!client) {
      return heuristicAssessment(input);
    }

    const response = await client.responses.create({
      model: env.openAiTextModel,
      temperature: 0.4,
      instructions: submissionAssessmentInstructions,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify(input)
            }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "submission_assessment",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              decision: {
                type: "string",
                enum: ["approved", "rejected"]
              },
              score: {
                type: "integer"
              },
              flags: {
                type: "array",
                items: {
                  type: "string"
                }
              },
              explanation: {
                type: "string"
              },
              approvalReason: {
                type: "string"
              },
              noveltyScore: {
                type: "integer"
              },
              cohesionScore: {
                type: "integer"
              },
              remixDeltaScore: {
                type: "integer"
              },
              winningPrompt: {
                type: "string"
              }
            },
            required: [
              "decision",
              "score",
              "flags",
              "explanation",
              "approvalReason",
              "noveltyScore",
              "cohesionScore",
              "remixDeltaScore",
              "winningPrompt"
            ]
          }
        }
      }
    });

    return assessmentSchema.parse(JSON.parse(response.output_text));
  } catch {
    return heuristicAssessment(input);
  }
}

export function rawPromptAssessment(input: AssessmentInput): SubmissionAssessment {
  const prompt = input.submissionText.trim();
  const normalized = normalizePromptText(prompt).toLowerCase();
  const flags = new Set<string>();

  if (input.session.venueSafeMode !== false) {
    for (const blocked of hardBlockedTerms) {
      if (normalized.includes(blocked)) {
        flags.add("blocked-term");
      }
    }
  }

  const decision = flags.size === 0 ? "approved" : "rejected";

  return {
    decision,
    score: decision === "approved" ? 100 : 0,
    flags: Array.from(flags),
    explanation:
      decision === "approved"
        ? "Approved without artist-direction scoring or an intake rewrite. The audience's original words stay preserved for attribution; a source-video-aware director may adapt the private render instruction."
        : "Rejected by the venue-safe hard-safety filter before the raw prompt could be sent to the selected video model.",
    approvalReason:
      decision === "approved"
        ? "Raw Prompt Mode: original audience wording preserved without an intake rewrite."
        : "Did not pass the venue-safe hard-safety filter.",
    noveltyScore: decision === "approved" ? 100 : 0,
    cohesionScore: decision === "approved" ? 100 : 0,
    remixDeltaScore: decision === "approved" ? 100 : 0,
    winningPrompt: prompt
  };
}

export function heuristicAssessment(input: AssessmentInput): SubmissionAssessment {
  const normalized = normalizePromptText(input.submissionText).toLowerCase();
  const bannedTerms = splitList(input.session.bannedTerms).map((term) => term.toLowerCase());
  const allowedMotifs = splitList(input.session.allowedMotifs);

  const flags = new Set<string>();
  let decision: "approved" | "rejected" = "approved";

  for (const blocked of [...hardBlockedTerms, ...bannedTerms]) {
    if (blocked && normalized.includes(blocked)) {
      flags.add("blocked-term");
      decision = "rejected";
    }
  }

  if (normalized.length < 6) {
    flags.add("too-short");
    decision = "rejected";
  }

  const recentDuplicate = input.recentWinningPrompts.some((prompt) =>
    prompt.toLowerCase().includes(normalized)
  );

  if (recentDuplicate) {
    flags.add("too-similar");
  }

  const cohesionScore = clamp(
    72 + allowedMotifs.filter((motif) => normalized.includes(motif.toLowerCase())).length * 6,
    25,
    100
  );
  const noveltyScore = clamp(recentDuplicate ? 42 : 74, 0, 100);
  const remixDeltaScore = clamp(normalized.length > 18 ? 81 : 54, 0, 100);
  const score = clamp(Math.round((cohesionScore + noveltyScore + remixDeltaScore) / 3), 0, 100);

  return {
    decision,
    score: decision === "approved" ? score : Math.min(score, 25),
    flags: Array.from(flags),
    explanation:
      decision === "approved"
        ? "Approved by the fallback heuristic scorer as safe and compatible with the set's visual DNA."
        : "Rejected by the fallback heuristic safety checks.",
    approvalReason:
      decision === "approved"
        ? "Keeps the crowd idea inside the artist and track envelope while changing one visible trait."
        : "Does not meet the venue-safe remix filter.",
    noveltyScore,
    cohesionScore,
    remixDeltaScore,
    winningPrompt: composeVideoPrompt({
      context: [
        `Make the crowd request the dominant visible transformation: ${normalizePromptText(input.submissionText)}.`,
        `Remix the active loop for ${input.session.artistName} - ${input.session.trackName}.`,
        `Keep the visual DNA anchored in: ${input.session.creativeBible}.`,
        allowedMotifs.length > 0
          ? `Preferred motifs: ${input.session.allowedMotifs}.`
          : "Motifs are open-ended; honor the crowd idea while preserving the session's visual identity.",
        `Palette: ${input.session.colorPalette}.`,
        "Create a clearly different next scene while carrying forward the visual DNA and palette logic."
      ],
      requirements: [],
      maxLength: assessedVideoPromptCharacterBudget
    })
  };
}
