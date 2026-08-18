export const videoModelIds = [
  "gemini_omni_flash",
  "seedance2",
  "seedance2_5",
  "hailuo3"
] as const;

export type VideoModelId = (typeof videoModelIds)[number];

export type VideoModelDefinition = {
  id: VideoModelId;
  label: string;
  description: string;
  minDurationSeconds: number;
  maxDurationSeconds: number;
  defaultDurationSeconds: number;
};

export const defaultVideoModelId: VideoModelId = "gemini_omni_flash";

export const videoModelDefinitions: readonly VideoModelDefinition[] = [
  {
    id: "gemini_omni_flash",
    label: "Gemini Omni Flash",
    description: "Fast, flexible generation for responsive live remixes.",
    minDurationSeconds: 3,
    maxDurationSeconds: 10,
    defaultDurationSeconds: 8
  },
  {
    id: "seedance2",
    label: "Seedance 2.0",
    description: "Cinematic motion with strong prompt adherence.",
    minDurationSeconds: 4,
    maxDurationSeconds: 15,
    defaultDurationSeconds: 8
  },
  {
    id: "seedance2_5",
    label: "Seedance 2.5",
    description: "Longer clips with enhanced visual consistency.",
    minDurationSeconds: 4,
    maxDurationSeconds: 30,
    defaultDurationSeconds: 8
  },
  {
    id: "hailuo3",
    label: "Hailuo 3.0 (H3)",
    description: "Expressive motion with polished cinematic detail.",
    minDurationSeconds: 5,
    maxDurationSeconds: 15,
    defaultDurationSeconds: 8
  }
];

const videoModelDefinitionsById = new Map(
  videoModelDefinitions.map((definition) => [definition.id, definition])
);

export function isVideoModelId(value: unknown): value is VideoModelId {
  return (
    typeof value === "string" &&
    (videoModelIds as readonly string[]).includes(value)
  );
}

export function normalizeVideoModelId(value: unknown): VideoModelId {
  return isVideoModelId(value) ? value : defaultVideoModelId;
}

export function getVideoModelDefinition(
  videoModel: VideoModelId
): VideoModelDefinition;
export function getVideoModelDefinition(
  videoModel: unknown
): VideoModelDefinition | undefined;
export function getVideoModelDefinition(
  videoModel: unknown
): VideoModelDefinition | undefined {
  return isVideoModelId(videoModel)
    ? videoModelDefinitionsById.get(videoModel)
    : undefined;
}

export function getVideoDurationOptions(
  videoModel: VideoModelId
): readonly number[] {
  const definition = getVideoModelDefinition(videoModel);

  return Array.from(
    {
      length:
        definition.maxDurationSeconds -
        definition.minDurationSeconds +
        1
    },
    (_, index) => definition.minDurationSeconds + index
  );
}

export function isVideoModelDurationSupported(
  videoModel: unknown,
  durationSeconds: unknown
): durationSeconds is number {
  const definition = getVideoModelDefinition(videoModel);

  return (
    definition !== undefined &&
    typeof durationSeconds === "number" &&
    Number.isInteger(durationSeconds) &&
    durationSeconds >= definition.minDurationSeconds &&
    durationSeconds <= definition.maxDurationSeconds
  );
}

export function getVideoDurationForModelChange(
  videoModel: VideoModelId,
  currentDurationSeconds: unknown
): number {
  if (isVideoModelDurationSupported(videoModel, currentDurationSeconds)) {
    return currentDurationSeconds;
  }

  return getVideoModelDefinition(videoModel).defaultDurationSeconds;
}

export function normalizeVideoDurationSecondsForModel(
  videoModel: unknown,
  durationSeconds: unknown
): number {
  return getVideoDurationForModelChange(
    normalizeVideoModelId(videoModel),
    durationSeconds
  );
}

// These aliases support both common model/duration naming styles.
export const getVideoDurationOptionsForModel = getVideoDurationOptions;
export const isVideoDurationSupportedForModel =
  isVideoModelDurationSupported;
export const resolveVideoDurationForModelChange =
  getVideoDurationForModelChange;
