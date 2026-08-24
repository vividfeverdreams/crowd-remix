import { Buffer } from "node:buffer";
import {
  defaultVideoModelId,
  getVideoModelDefinition,
  isVideoModelDurationSupported,
  isVideoModelId,
  type VideoModelId
} from "@/lib/video-models";
import { videoProviderPromptCharacterBudget } from "@/lib/video-prompt-budget";

const runwayApiBaseUrl = "https://api.dev.runwayml.com/v1";
const runwayApiVersion = "2024-11-06";
const runwayRequestTimeoutMs = 45_000;
const runwayPromptMaxLength = videoProviderPromptCharacterBudget;
const runwayTaskIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type RunwayVideoDuration = number;

export type RunwayRenderStrategy =
  | "runway_text_to_video"
  | "runway_image_to_video"
  | "runway_video_to_video";

export type RunwayTaskStatus =
  | "PENDING"
  | "THROTTLED"
  | "RUNNING"
  | "CANCELLED"
  | "FAILED"
  | "SUCCEEDED";

export type RunwayTask = {
  id: string;
  createdAt: string;
  status: RunwayTaskStatus;
  estimatedCost?: {
    credits: number;
  };
  cost?: {
    credits: number;
  };
  progress?: number;
  output?: string[];
  failure?: string;
  failureCode?: string;
};

export type StartRunwayVideoRenderInput = {
  mode: "seed" | "remix";
  prompt: string;
  sourceVideoUrl?: string | null;
  imageReferenceUrl?: string | null;
  openingFrameImageUrl?: string | null;
  remixReferenceImageUrl?: string | null;
  apiKey: string;
  durationSeconds?: number | null;
  model?: string | null;
  signal?: AbortSignal;
};

export type StartedRunwayVideoRender = {
  requestId: string;
  strategy: RunwayRenderStrategy;
};

type RunwayErrorOperation =
  | "validation"
  | "start"
  | "retrieve"
  | "download"
  | "task";

type RunwayApiErrorInput = {
  status?: number;
  code?: string | null;
  operation?: RunwayErrorOperation;
  retryAfterMs?: number | null;
  cause?: unknown;
};

export class RunwayApiError extends Error {
  code: string | null;
  operation: RunwayErrorOperation;
  retryAfterMs: number | null;
  status: number;

  constructor(message: string, input: RunwayApiErrorInput = {}) {
    super(message, input.cause === undefined ? undefined : { cause: input.cause });
    this.name = "RunwayApiError";
    this.code = input.code ?? null;
    this.operation = input.operation ?? "task";
    this.retryAfterMs = input.retryAfterMs ?? null;
    this.status = input.status ?? 0;
  }
}

export function isRunwayModerationFailureCode(
  code: string | null | undefined
) {
  const normalized = code?.trim().toUpperCase();

  return Boolean(
    normalized &&
      (normalized === "SAFETY" ||
        normalized.startsWith("SAFETY.") ||
        normalized === "INPUT_PREPROCESSING.SAFETY" ||
        normalized.startsWith("INPUT_PREPROCESSING.SAFETY."))
  );
}

export function isRunwayModerationError(error: unknown) {
  if (error instanceof RunwayApiError) {
    return isRunwayModerationFailureCode(error.code);
  }

  if (!isRecord(error)) {
    return false;
  }

  return isRunwayModerationFailureCode(
    typeof error.failureCode === "string" ? error.failureCode : null
  );
}

/**
 * Returns whether a failed retrieval, download, or provider task can be tried
 * again. This is deliberately broader than start-request retry safety.
 */
export function isRetryableRunwayError(error: unknown) {
  if (isRunwayModerationError(error)) {
    return false;
  }

  if (error instanceof RunwayApiError) {
    if (error.operation === "validation") {
      return false;
    }

    if (error.operation === "task") {
      return isRetryableRunwayFailureCode(error.code);
    }

    return isRetryableHttpStatus(error.status) || error.status === 0;
  }

  if (isRecord(error) && error.status === "FAILED") {
    return isRetryableRunwayFailureCode(
      typeof error.failureCode === "string" ? error.failureCode : null
    );
  }

  return error instanceof TypeError;
}

/**
 * A network timeout while starting a task is ambiguous: Runway may have
 * accepted it before the connection failed. Only explicit provider responses
 * that are safe to resubmit qualify here.
 */
export function isSafeToRetryRunwayStartError(error: unknown) {
  return (
    error instanceof RunwayApiError &&
    error.operation === "start" &&
    [429, 502, 503, 504].includes(error.status) &&
    !isRunwayModerationError(error)
  );
}

export async function startRunwayVideoRender(
  input: StartRunwayVideoRenderInput
): Promise<StartedRunwayVideoRender> {
  const apiKey = requireApiKey(input.apiKey);
  const promptText = requirePrompt(input.prompt);
  const model = requireModel(input.model);
  const duration = requireDuration(model, input.durationSeconds);
  const signal = input.signal ?? AbortSignal.timeout(runwayRequestTimeoutMs);
  let endpoint: "text_to_video" | "image_to_video" | "video_to_video";
  let strategy: RunwayRenderStrategy;
  let body: Record<string, unknown>;

  if (input.mode === "remix") {
    const sourceVideoUri = requireAssetUri(
      input.sourceVideoUrl,
      "source video"
    );
    const referenceUris = [
      optionalAssetUri(
        input.openingFrameImageUrl,
        "opening-frame image"
      ),
      optionalAssetUri(
        input.remixReferenceImageUrl,
        "crowd reference image"
      )
    ].filter((uri): uri is string => uri !== null);

    endpoint = "video_to_video";
    strategy = "runway_video_to_video";
    body = buildVideoToVideoBody({
      model,
      sourceVideoUri,
      promptText,
      duration,
      referenceUris
    });
  } else {
    const promptImage = optionalAssetUri(
      input.imageReferenceUrl,
      "image reference"
    );

    endpoint = promptImage ? "image_to_video" : "text_to_video";
    strategy = promptImage
      ? "runway_image_to_video"
      : "runway_text_to_video";
    body = buildSeedVideoBody({
      model,
      promptText,
      promptImage,
      duration
    });
  }

  const response = await fetchRunway(
    `${runwayApiBaseUrl}/${endpoint}`,
    apiKey,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal
    },
    "start"
  );
  const payload = await readJsonResponse(response, "start");
  const requestId = isRecord(payload) ? payload.id : null;

  if (typeof requestId !== "string" || !runwayTaskIdPattern.test(requestId)) {
    throw new RunwayApiError(
      "Runway started a video render without returning a valid task ID.",
      {
        status: response.status,
        code: "INVALID_RESPONSE",
        operation: "start"
      }
    );
  }

  return {
    requestId,
    strategy
  };
}

function buildSeedVideoBody(input: {
  model: VideoModelId;
  promptText: string;
  promptImage: string | null;
  duration: number;
}): Record<string, unknown> {
  const promptImage = input.promptImage
    ? { promptImage: input.promptImage }
    : {};

  switch (input.model) {
    case "gemini_omni_flash":
      return {
        model: input.model,
        ...promptImage,
        promptText: input.promptText,
        ratio: "1280:720",
        duration: input.duration
      };
    case "seedance2":
    case "seedance2_5":
      return {
        model: input.model,
        ...promptImage,
        promptText: input.promptText,
        ratio: "1280:720",
        duration: input.duration,
        audio: false
      };
    case "hailuo3":
      return {
        model: input.model,
        ...promptImage,
        promptText: input.promptText,
        ratio: "16:9",
        resolution: "768P",
        duration: input.duration
      };
  }
}

function buildVideoToVideoBody(input: {
  model: VideoModelId;
  sourceVideoUri: string;
  promptText: string;
  duration: number;
  referenceUris: readonly string[];
}): Record<string, unknown> {
  const references = input.referenceUris.length > 0
    ? {
        references: input.referenceUris.map((uri) => ({ uri }))
      }
    : {};

  switch (input.model) {
    case "gemini_omni_flash":
      return {
        model: input.model,
        videoUri: input.sourceVideoUri,
        promptText: input.promptText,
        ...references
      };
    case "seedance2":
      return {
        model: input.model,
        promptVideo: input.sourceVideoUri,
        promptText: input.promptText,
        duration: input.duration,
        ratio: "1280:720",
        audio: false,
        ...references
      };
    case "seedance2_5":
      return {
        model: input.model,
        promptVideo: input.sourceVideoUri,
        promptText: input.promptText,
        duration: input.duration,
        ratio: "1280:720",
        audio: false,
        mode: "reference",
        ...references
      };
    case "hailuo3":
      return {
        model: input.model,
        promptVideo: input.sourceVideoUri,
        promptText: input.promptText,
        duration: input.duration,
        ratio: "16:9",
        resolution: "768P",
        ...references
      };
  }
}

export async function retrieveRunwayTask(
  taskId: string,
  apiKeyInput: string,
  options: {
    signal?: AbortSignal;
  } = {}
): Promise<RunwayTask> {
  const apiKey = requireApiKey(apiKeyInput);
  const normalizedTaskId = taskId.trim();

  if (!runwayTaskIdPattern.test(normalizedTaskId)) {
    throw validationError(
      "Runway task ID must be a valid UUID.",
      "INVALID_TASK_ID"
    );
  }

  const response = await fetchRunway(
    `${runwayApiBaseUrl}/tasks/${encodeURIComponent(normalizedTaskId)}`,
    apiKey,
    {
      method: "GET",
      signal: options.signal ?? AbortSignal.timeout(runwayRequestTimeoutMs)
    },
    "retrieve"
  );
  const payload = await readJsonResponse(response, "retrieve");

  return parseRunwayTask(payload, response.status);
}

export async function downloadRunwayVideo(
  urlInput: string,
  options: {
    signal?: AbortSignal;
  } = {}
) {
  const url = requireHttpsUrl(urlInput, "Runway output video");
  let response: Response;

  try {
    response = await fetch(url, {
      method: "GET",
      signal: options.signal ?? AbortSignal.timeout(runwayRequestTimeoutMs)
    });
  } catch (error) {
    throw networkError("download", error);
  }

  if (!response.ok) {
    throw await httpError(response, "download", null);
  }

  const contentType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();

  if (
    contentType &&
    !contentType.startsWith("video/") &&
    contentType !== "application/octet-stream" &&
    contentType !== "binary/octet-stream"
  ) {
    throw new RunwayApiError(
      `Runway output returned an unexpected content type (${contentType}).`,
      {
        status: response.status,
        code: "INVALID_VIDEO_RESPONSE",
        operation: "download"
      }
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  if (buffer.length === 0) {
    throw new RunwayApiError("Runway returned an empty video output.", {
      status: response.status,
      code: "EMPTY_VIDEO_RESPONSE",
      operation: "download"
    });
  }

  return buffer;
}

async function fetchRunway(
  url: string,
  apiKey: string,
  init: RequestInit,
  operation: "start" | "retrieve"
) {
  let response: Response;

  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-Runway-Version": runwayApiVersion,
        ...init.headers
      }
    });
  } catch (error) {
    throw networkError(operation, error, apiKey);
  }

  if (!response.ok) {
    throw await httpError(response, operation, apiKey);
  }

  return response;
}

async function readJsonResponse(
  response: Response,
  operation: "start" | "retrieve"
) {
  const text = await response.text();

  if (!text.trim()) {
    throw new RunwayApiError("Runway returned an empty API response.", {
      status: response.status,
      code: "INVALID_RESPONSE",
      operation
    });
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new RunwayApiError("Runway returned a malformed JSON response.", {
      status: response.status,
      code: "INVALID_RESPONSE",
      operation,
      cause: error
    });
  }
}

async function httpError(
  response: Response,
  operation: "start" | "retrieve" | "download",
  apiKey: string | null
) {
  const text = await response.text();
  let payload: unknown = null;

  try {
    payload = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    payload = null;
  }

  const providerMessage = extractProviderMessage(payload) || text.trim();
  const providerCode = extractProviderCode(payload) ?? `HTTP_${response.status}`;
  const message = redactSecret(
    providerMessage || `Runway returned HTTP ${response.status}.`,
    apiKey
  );

  return new RunwayApiError(
    `Runway ${operation} request failed (${response.status}): ${message}`,
    {
      status: response.status,
      code: providerCode,
      operation,
      retryAfterMs: parseRetryAfter(response.headers.get("retry-after"))
    }
  );
}

function parseRunwayTask(payload: unknown, status: number): RunwayTask {
  if (!isRecord(payload)) {
    throw invalidTaskResponse(status);
  }

  const id = payload.id;
  const createdAt = payload.createdAt;
  // Older SDK prose used the US spelling even though the current wire schema
  // specifies CANCELLED. Normalize it defensively without emitting it ourselves.
  const rawStatus = payload.status === "CANCELED" ? "CANCELLED" : payload.status;

  if (
    typeof id !== "string" ||
    !runwayTaskIdPattern.test(id) ||
    typeof createdAt !== "string" ||
    !createdAt.trim() ||
    !isRunwayTaskStatus(rawStatus)
  ) {
    throw invalidTaskResponse(status);
  }

  const task: RunwayTask = {
    id,
    createdAt,
    status: rawStatus
  };

  if (payload.estimatedCost !== undefined) {
    const credits = extractCredits(payload.estimatedCost);

    if (credits === null) {
      throw invalidTaskResponse(status);
    }

    task.estimatedCost = { credits };
  }

  if (payload.cost !== undefined) {
    const credits = extractCredits(payload.cost);

    if (credits === null) {
      throw invalidTaskResponse(status);
    }

    task.cost = { credits };
  }

  if (rawStatus === "RUNNING") {
    if (
      typeof payload.progress !== "number" ||
      !Number.isFinite(payload.progress) ||
      payload.progress < 0 ||
      payload.progress > 1
    ) {
      throw invalidTaskResponse(status);
    }

    task.progress = payload.progress;
  }

  if (rawStatus === "SUCCEEDED") {
    if (
      !Array.isArray(payload.output) ||
      !payload.output.every(
        (value) => typeof value === "string" && isHttpsUrl(value)
      )
    ) {
      throw invalidTaskResponse(status);
    }

    task.output = payload.output;
  }

  if (rawStatus === "FAILED") {
    if (typeof payload.failure !== "string" || !payload.failure.trim()) {
      throw invalidTaskResponse(status);
    }

    task.failure = payload.failure;

    if (typeof payload.failureCode === "string" && payload.failureCode.trim()) {
      task.failureCode = payload.failureCode;
    }
  }

  return task;
}

function invalidTaskResponse(status: number) {
  return new RunwayApiError("Runway returned an invalid task response.", {
    status,
    code: "INVALID_RESPONSE",
    operation: "retrieve"
  });
}

function extractCredits(value: unknown) {
  if (
    !isRecord(value) ||
    typeof value.credits !== "number" ||
    !Number.isFinite(value.credits)
  ) {
    return null;
  }

  return value.credits;
}

function isRunwayTaskStatus(value: unknown): value is RunwayTaskStatus {
  return (
    typeof value === "string" &&
    [
      "PENDING",
      "THROTTLED",
      "RUNNING",
      "CANCELLED",
      "FAILED",
      "SUCCEEDED"
    ].includes(value)
  );
}

function extractProviderMessage(payload: unknown) {
  if (!isRecord(payload)) {
    return null;
  }

  if (typeof payload.error === "string") {
    return payload.error;
  }

  if (isRecord(payload.error) && typeof payload.error.message === "string") {
    return payload.error.message;
  }

  if (typeof payload.message === "string") {
    return payload.message;
  }

  if (typeof payload.failure === "string") {
    return payload.failure;
  }

  return null;
}

function extractProviderCode(payload: unknown) {
  if (!isRecord(payload)) {
    return null;
  }

  if (typeof payload.code === "string") {
    return payload.code;
  }

  if (typeof payload.failureCode === "string") {
    return payload.failureCode;
  }

  if (isRecord(payload.error) && typeof payload.error.code === "string") {
    return payload.error.code;
  }

  return null;
}

function requireApiKey(value: string) {
  const apiKey = value.trim();

  if (!apiKey) {
    throw validationError(
      "A Runway API key is required for video generation.",
      "MISSING_API_KEY"
    );
  }

  return apiKey;
}

function requirePrompt(value: string) {
  const prompt = value.trim();

  if (!prompt) {
    throw validationError(
      "Runway video prompts cannot be empty.",
      "INVALID_PROMPT"
    );
  }

  // JavaScript string length is measured in UTF-16 code units, matching the
  // Runway API's documented prompt-length accounting.
  return prompt.slice(0, runwayPromptMaxLength);
}

function requireModel(value: string | null | undefined): VideoModelId {
  const model = value?.trim() || defaultVideoModelId;

  if (!isVideoModelId(model)) {
    throw validationError(
      `Runway video model ${JSON.stringify(model)} is not supported.`,
      "UNSUPPORTED_MODEL"
    );
  }

  return model;
}

function requireDuration(
  model: VideoModelId,
  value: number | null | undefined
): RunwayVideoDuration {
  const definition = getVideoModelDefinition(model);
  const duration = value ?? definition.defaultDurationSeconds;

  if (!isVideoModelDurationSupported(model, duration)) {
    throw validationError(
      `${definition.label} video duration must be a whole number from ${definition.minDurationSeconds} to ${definition.maxDurationSeconds} seconds.`,
      "INVALID_DURATION"
    );
  }

  return duration;
}

function optionalAssetUri(value: string | null | undefined, label: string) {
  if (!value?.trim()) {
    return null;
  }

  return requireAssetUri(value, label);
}

function requireAssetUri(value: string | null | undefined, label: string) {
  const uri = value?.trim();

  if (!uri) {
    throw validationError(
      `Runway ${label} is required for this video render.`,
      "MISSING_ASSET"
    );
  }

  if (!isHttpsUrl(uri) && !uri.startsWith("runway://")) {
    throw validationError(
      `Runway ${label} must use an HTTPS or runway:// URI.`,
      "INVALID_ASSET_URI"
    );
  }

  return uri;
}

function requireHttpsUrl(value: string, label: string) {
  const url = value.trim();

  if (!isHttpsUrl(url)) {
    throw validationError(`${label} must use an HTTPS URL.`, "INVALID_OUTPUT_URL");
  }

  return url;
}

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function validationError(message: string, code: string) {
  return new RunwayApiError(message, {
    status: 0,
    code,
    operation: "validation"
  });
}

function networkError(
  operation: "start" | "retrieve" | "download",
  cause: unknown,
  apiKey: string | null = null
) {
  const detail =
    cause instanceof Error && cause.message
      ? ` ${redactSecret(cause.message, apiKey)}`
      : "";
  const timedOut = cause instanceof Error && cause.name === "TimeoutError";

  return new RunwayApiError(
    `Runway ${operation} request could not be completed.${detail}`,
    {
      status: 0,
      code: timedOut ? "REQUEST_TIMEOUT" : "NETWORK_ERROR",
      operation,
      cause
    }
  );
}

function isRetryableHttpStatus(status: number) {
  return [408, 409, 425, 429].includes(status) || status >= 500;
}

function isRetryableRunwayFailureCode(code: string | null | undefined) {
  const normalized = code?.trim().toUpperCase();

  if (!normalized) {
    return true;
  }

  return (
    normalized === "INTERNAL" ||
    normalized.startsWith("INTERNAL.") ||
    normalized === "INPUT_PREPROCESSING.INTERNAL" ||
    normalized.startsWith("INPUT_PREPROCESSING.INTERNAL.") ||
    normalized === "THIRD_PARTY.UNAVAILABLE" ||
    normalized.startsWith("THIRD_PARTY.UNAVAILABLE.")
  );
}

function parseRetryAfter(value: string | null) {
  if (!value) {
    return null;
  }

  const seconds = Number(value);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1_000);
  }

  const date = Date.parse(value);

  if (Number.isNaN(date)) {
    return null;
  }

  return Math.max(0, date - Date.now());
}

function redactSecret(value: string, secret: string | null) {
  return secret ? value.replaceAll(secret, "[REDACTED]") : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
