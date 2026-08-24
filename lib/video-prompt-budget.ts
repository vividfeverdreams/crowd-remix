export const videoProviderPromptCharacterBudget = 1_000;
export const assessedVideoPromptCharacterBudget = 900;

type ComposeVideoPromptInput = {
  leadingRequirements?: readonly (string | null | undefined)[];
  context: readonly (string | null | undefined)[];
  requirements: readonly (string | null | undefined)[];
  maxLength?: number;
};

type ComposeFinalProviderVideoPromptInput = {
  creativePrompt: string;
  motionRules?: string | null;
  includeArtistMotionRules: boolean;
  venueSafeMode: boolean;
  openingFrameAttached?: boolean;
  crowdReferenceAttached?: boolean;
};

export const providerCameraContinuityRequirement =
  "Preserve creative-prompt camera direction; if none, leave camera behavior unrestricted.";
export const providerArtistCameraPriorityRequirement =
  "Otherwise preserve earlier camera direction; if neither specifies camera, leave it unrestricted.";
export const providerSeamlessLoopRequirement =
  "Reconnect ending to opening seamlessly as a continuous loop.";
export const providerVenueSafetyRequirement =
  "Venue-safe: no real people/public figures, copyrighted characters, logos/readable text, explicit content/graphic violence, or hazardous imagery.";
export const providerOpeningFrameContinuityRequirement =
  "START FRAME: <FIRST_FRAME> is Image 1, the prior video's exact final frame. Use it unchanged as frame 0—same composition, subjects, camera, lighting, color, and motion state—then continue its motion.";
export const providerCrowdReferenceRequirement =
  "Image 2 is crowd-photo guidance <IMAGE_REF_0> only. Nothing later overrides the frame-0 anchor.";

/**
 * Fits provider-bound prompt context around clauses that must survive intact.
 * Leading requirements stay at the start, trailing requirements stay at the
 * end, and only context may be shortened.
 */
export function composeVideoPrompt({
  leadingRequirements = [],
  context,
  requirements,
  maxLength = videoProviderPromptCharacterBudget
}: ComposeVideoPromptInput) {
  if (!Number.isSafeInteger(maxLength) || maxLength < 1) {
    throw new RangeError("Video prompt maxLength must be a positive integer.");
  }

  const leadingRequirementText = joinPromptSegments(leadingRequirements);
  const contextText = joinPromptSegments(context);
  const requirementText = joinPromptSegments(requirements);
  const fixedText = joinPromptSegments([
    leadingRequirementText,
    requirementText
  ]);

  if (fixedText.length > maxLength) {
    throw new RangeError(
      `Required video prompt clauses exceed the ${maxLength}-character budget.`
    );
  }

  if (!fixedText) {
    return truncatePromptContext(contextText, maxLength);
  }

  const separatorCount =
    (leadingRequirementText ? 1 : 0) + (requirementText ? 1 : 0);
  const contextBudget =
    maxLength -
    leadingRequirementText.length -
    requirementText.length -
    separatorCount;

  if (!contextText || contextBudget < 1) {
    return fixedText;
  }

  const retainedContext = truncatePromptContext(contextText, contextBudget);

  return joinPromptSegments([
    leadingRequirementText,
    retainedContext,
    requirementText
  ]);
}

export function composeFinalProviderVideoPrompt({
  creativePrompt,
  motionRules,
  includeArtistMotionRules,
  venueSafeMode,
  openingFrameAttached = false,
  crowdReferenceAttached = false
}: ComposeFinalProviderVideoPromptInput) {
  const normalizedRules = normalizePromptSegment(motionRules ?? "");

  return composeVideoPrompt({
    leadingRequirements: openingFrameAttached
      ? [
          providerOpeningFrameContinuityRequirement,
          crowdReferenceAttached
            ? providerCrowdReferenceRequirement
            : null
        ]
      : [],
    context: [creativePrompt],
    requirements: [
      includeArtistMotionRules && normalizedRules
        ? `Enabled artist motion/camera rules override conflicting earlier directions: ${finishSentence(normalizedRules)}`
        : null,
      includeArtistMotionRules && normalizedRules
        ? providerArtistCameraPriorityRequirement
        : providerCameraContinuityRequirement,
      providerSeamlessLoopRequirement,
      venueSafeMode ? providerVenueSafetyRequirement : null
    ]
  });
}

function joinPromptSegments(segments: readonly (string | null | undefined)[]) {
  return segments
    .map((segment) => normalizePromptSegment(segment ?? ""))
    .filter(Boolean)
    .join(" ");
}

function normalizePromptSegment(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function finishSentence(value: string) {
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

function truncatePromptContext(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  const slicedValue = value.slice(0, maxLength);
  const withoutDanglingSurrogate = /[\uD800-\uDBFF]$/.test(slicedValue)
    ? slicedValue.slice(0, -1)
    : slicedValue;
  const hardLimit = withoutDanglingSurrogate.trimEnd();
  const lastSpace = hardLimit.lastIndexOf(" ");
  const wordBoundaryFloor = Math.floor(maxLength * 0.7);
  const atWordBoundary =
    lastSpace >= wordBoundaryFloor
      ? hardLimit.slice(0, lastSpace)
      : hardLimit;

  return atWordBoundary.replace(/[,:;([{]+$/u, "").trimEnd();
}
