"use client";

import Image from "next/image";
import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useRef,
  useState
} from "react";
import {
  formatChoiceTemplateStatement,
  getPublicRemixPromptTemplate,
  pickRandomChoiceResponses,
  pickRandomPublicRemixPromptTemplate,
  resolvePublicRemixPromptSelection,
  type PublicRemixChoiceResponse
} from "@/lib/public-remix-prompts";

type PublicSubmissionFormProps = {
  sessionCode: string;
  disabled?: boolean;
  disabledMessage?: string | null;
};

type TrackedSubmissionStatus = {
  state:
    | "approved"
    | "banned"
    | "blocked"
    | "queued"
    | "rendering"
    | "ready"
    | "live"
    | "played"
    | "provider-blocked"
    | "rejected"
    | "retrying"
    | "submitted";
  title: string;
  detail: string;
  prompt: string;
  referenceImageUrl?: string;
  moderationBlockCount?: number;
  blocksRemaining?: number;
  submittedAt: string;
  updatedAt: string;
};

const terminalStates = new Set<TrackedSubmissionStatus["state"]>([
  "banned",
  "blocked",
  "live",
  "played",
  "provider-blocked",
  "rejected"
]);
const participantDeviceStorageKey = "dream-sequence:participant-device";
const participantNicknameStorageKey = "dream-sequence:participant-nickname";
const maximumReferenceImageBytes = 4 * 1024 * 1024;
const supportedReferenceImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif"
]);

export function PublicSubmissionForm({
  sessionCode,
  disabled = false,
  disabledMessage = null
}: PublicSubmissionFormProps) {
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [visibleChoiceResponses, setVisibleChoiceResponses] = useState<
    readonly PublicRemixChoiceResponse[]
  >([]);
  const [selectedResponseId, setSelectedResponseId] = useState<string | null>(
    null
  );
  const [nickname, setNickname] = useState("");
  const [participantToken, setParticipantToken] = useState("");
  const [identityReady, setIdentityReady] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [referenceImage, setReferenceImage] = useState<File | null>(null);
  const [referenceImagePreviewUrl, setReferenceImagePreviewUrl] = useState<
    string | null
  >(null);
  const [preparingImage, setPreparingImage] = useState(false);
  const [trackedSubmissionId, setTrackedSubmissionId] = useState<string | null>(null);
  const [trackedStatus, setTrackedStatus] = useState<TrackedSubmissionStatus | null>(null);
  const [shuffleAnnouncement, setShuffleAnnouncement] = useState({
    revision: 0,
    message: ""
  });
  const imageInputRef = useRef<HTMLInputElement>(null);
  const imagePreviewUrlRef = useRef<string | null>(null);
  const recentTemplateIdsRef = useRef<string[]>([]);
  const participantBanned = trackedStatus?.state === "banned";
  const activeTemplate = activeTemplateId
    ? getPublicRemixPromptTemplate(activeTemplateId)
    : null;
  const selectedPrompt = (() => {
    if (!activeTemplate) {
      return "";
    }

    if (activeTemplate.kind === "image") {
      return activeTemplate.statement;
    }

    if (!selectedResponseId) {
      return "";
    }

    try {
      return resolvePublicRemixPromptSelection(
        activeTemplate.id,
        selectedResponseId
      ).prompt;
    } catch {
      return "";
    }
  })();

  useEffect(() => {
    const savedNickname = readParticipantStorage(participantNicknameStorageKey)?.trim() ?? "";
    const savedToken = readParticipantStorage(participantDeviceStorageKey)?.trim() ?? "";
    const deviceToken = savedToken.length >= 16 ? savedToken : createParticipantDeviceToken();

    writeParticipantStorage(participantDeviceStorageKey, deviceToken);
    setParticipantToken(deviceToken);
    setNickname(savedNickname);
    setIdentityReady(true);
  }, []);

  useEffect(() => {
    if (recentTemplateIdsRef.current.length === 0) {
      showRandomTemplate(null);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (imagePreviewUrlRef.current) {
        URL.revokeObjectURL(imagePreviewUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!trackedSubmissionId || !trackedStatus || terminalStates.has(trackedStatus.state)) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshTrackedStatus(trackedSubmissionId);
    }, 4000);

    return () => {
      window.clearInterval(interval);
    };
  }, [trackedSubmissionId, trackedStatus]);

  function showRandomTemplate(currentTemplateId: string | null) {
    const nextTemplate =
      pickRandomPublicRemixPromptTemplate(
        currentTemplateId,
        Math.random,
        recentTemplateIdsRef.current
      );

    if (!nextTemplate) {
      return;
    }

    recentTemplateIdsRef.current = [
      ...recentTemplateIdsRef.current.slice(-1),
      nextTemplate.id
    ];
    setActiveTemplateId(nextTemplate.id);
    setSelectedResponseId(null);
    setVisibleChoiceResponses(
      nextTemplate.kind === "choice"
        ? pickRandomChoiceResponses(nextTemplate)
        : []
    );
    replaceReferenceImage(null);
    setMessage(null);

    if (currentTemplateId) {
      const announcement =
        nextTemplate.kind === "choice"
          ? "A new fill-in-the-blank statement and four answers are ready."
          : "A new image remix statement is ready.";
      setShuffleAnnouncement((current) => ({
        revision: current.revision + 1,
        message: announcement
      }));
    }
  }

  function shuffleChoiceResponses() {
    if (activeTemplate?.kind !== "choice") {
      return;
    }

    const nextResponses = pickRandomChoiceResponses(
      activeTemplate,
      visibleChoiceResponses.map((response) => response.id)
    );

    setVisibleChoiceResponses(nextResponses);
    setSelectedResponseId(null);
    setMessage(null);
    setShuffleAnnouncement((current) => ({
      revision: current.revision + 1,
      message: "Four new remix answers are ready."
    }));
  }

  async function handleReferenceImageChange(
    event: ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0] ?? null;

    if (!file) {
      replaceReferenceImage(null);
      return;
    }

    if (!supportedReferenceImageTypes.has(file.type)) {
      event.target.value = "";
      replaceReferenceImage(null);
      setMessage("Choose a JPEG, PNG, WebP, or HEIC photo.");
      return;
    }

    setPreparingImage(true);

    try {
      setMessage(
        file.size > maximumReferenceImageBytes ||
          file.type === "image/heic" ||
          file.type === "image/heif"
          ? "Optimizing your photo for the remix…"
          : null
      );
      const preparedFile = await prepareReferenceImage(file);

      replaceReferenceImage(preparedFile);
      setMessage(null);
    } catch {
      event.target.value = "";
      replaceReferenceImage(null);
      setMessage(
        "That photo could not be prepared. Try a different JPEG, PNG, WebP, or HEIC image."
      );
    } finally {
      setPreparingImage(false);
    }
  }

  function replaceReferenceImage(file: File | null) {
    if (imagePreviewUrlRef.current) {
      URL.revokeObjectURL(imagePreviewUrlRef.current);
      imagePreviewUrlRef.current = null;
    }

    const nextPreviewUrl = file ? URL.createObjectURL(file) : null;
    imagePreviewUrlRef.current = nextPreviewUrl;
    setReferenceImage(file);
    setReferenceImagePreviewUrl(nextPreviewUrl);

    if (!file && imageInputRef.current) {
      imageInputRef.current.value = "";
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (disabled) {
      setMessage(disabledMessage ?? "The remix queue is not accepting submissions right now.");
      return;
    }

    if (participantBanned) {
      setMessage("This device is locked out for the rest of this live sequence.");
      return;
    }

    const submittedNickname = nickname.trim();

    if (!submittedNickname) {
      setMessage("Choose a nickname before sending your remix.");
      return;
    }

    if (!activeTemplate) {
      setMessage("Choose a remix statement before sending.");
      return;
    }

    if (activeTemplate.kind === "choice" && !selectedResponseId) {
      setMessage("Choose one of the four remix answers.");
      return;
    }

    if (activeTemplate.kind === "image" && !referenceImage) {
      setMessage("Choose an image for this remix statement.");
      return;
    }

    if (!selectedPrompt) {
      setMessage("Choose a complete remix idea before sending.");
      return;
    }

    const submittedTemplateId = activeTemplate.id;
    const submittedPrompt = selectedPrompt;
    const activeParticipantToken =
      participantToken || createParticipantDeviceToken();

    writeParticipantStorage(participantNicknameStorageKey, submittedNickname);
    writeParticipantStorage(participantDeviceStorageKey, activeParticipantToken);
    setParticipantToken(activeParticipantToken);
    setSubmitting(true);
    setMessage(null);
    setTrackedSubmissionId(null);
    setTrackedStatus(null);

    try {
      const formData = new FormData();
      formData.set("templateId", submittedTemplateId);

      if (activeTemplate.kind === "choice" && selectedResponseId) {
        formData.set("responseId", selectedResponseId);
      }

      formData.set("senderLabel", submittedNickname);
      formData.set("participantToken", activeParticipantToken);

      if (referenceImage) {
        formData.set("referenceImage", referenceImage);
      }

      const response = await fetch(`/api/r/${sessionCode}`, {
        method: "POST",
        body: formData
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            message?: string;
            error?: string;
            status?: string;
            submissionId?: string;
            moderationBlockCount?: number;
            prompt?: string;
          }
        | null;

      if (!response.ok) {
        if (payload?.status === "banned") {
          setTrackedStatus(
            createBannedTrackedStatus(
              payload.prompt ?? submittedPrompt,
              payload
            )
          );
        }

        setMessage(payload?.error ?? payload?.message ?? "Could not submit that remix.");
        return;
      }

      if (payload?.submissionId) {
        setTrackedSubmissionId(payload.submissionId);
        showRandomTemplate(submittedTemplateId);
        await refreshTrackedStatus(
          payload.submissionId,
          payload,
          payload.prompt ?? submittedPrompt
        );
      } else {
        setMessage(payload?.message ?? "Your remix is in the mix.");
      }
    } catch {
      setMessage("Could not reach the remix queue. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function refreshTrackedStatus(
    submissionId: string,
    fallback?: {
      message?: string;
      status?: string;
    } | null,
    fallbackPrompt = ""
  ) {
    try {
      const response = await fetch(`/api/r/${sessionCode}?submissionId=${encodeURIComponent(submissionId)}`);

      if (!response.ok) {
        throw new Error("Could not load the latest remix status.");
      }

      const payload = (await response.json()) as TrackedSubmissionStatus;
      setTrackedStatus(payload);
      setMessage(null);
    } catch {
      if (fallback) {
        setTrackedStatus(
          createFallbackTrackedStatus(fallbackPrompt, fallback)
        );
        setMessage(fallback.message ?? "Your remix is in the mix.");
        return;
      }

      setMessage("We received your remix, but the live tracker could not refresh right now.");
    }
  }

  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-white/45">Shape the next visual</p>
      <p className="mt-3 text-sm leading-7 text-white/68">
        Roll a new statement, then choose one of its answers or add the image it asks for.
      </p>
      <form
        onSubmit={handleSubmit}
        className="mt-5 space-y-4"
        aria-busy={submitting || preparingImage}
      >
        <label className="block">
          <span className="mb-2 block text-base font-medium text-white/88">Your Nickname</span>
          <input
            required
            type="text"
            minLength={2}
            maxLength={24}
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            onBlur={() => {
              const savedNickname = nickname.trim();

              if (savedNickname) {
                writeParticipantStorage(participantNicknameStorageKey, savedNickname);
              }
            }}
            disabled={disabled || participantBanned}
            autoComplete="off"
            className="w-full rounded-full border border-white/10 bg-black/30 px-4 py-3 outline-none transition focus:border-plasma disabled:cursor-not-allowed disabled:opacity-60"
            placeholder="Pick a name for the screen"
          />
        </label>

        <section
          className="rounded-[2rem] border border-white/10 bg-black/20 p-4 sm:p-5"
          aria-labelledby="remix-statement-heading"
        >
          <div className="flex items-center justify-between gap-4">
            <p
              id="remix-statement-heading"
              className="font-mono text-[11px] uppercase tracking-[0.26em] text-white/50"
            >
              Your remix statement
            </p>
            <button
              type="button"
              onClick={() => showRandomTemplate(activeTemplateId)}
              disabled={
                disabled ||
                participantBanned ||
                submitting ||
                preparingImage ||
                !activeTemplate
              }
              aria-label="Shuffle to a different remix statement"
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white/75 outline-none transition hover:border-plasma/45 hover:bg-plasma/[0.08] focus-visible:ring-2 focus-visible:ring-plasma disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span aria-hidden="true" className="text-lg leading-none">
                ⚄
              </span>
              New statement
            </button>
          </div>

          {!activeTemplate ? (
            <p className="mt-5 text-sm text-white/55" role="status">
              Rolling a remix statement…
            </p>
          ) : activeTemplate.kind === "choice" ? (
            <div className="mt-5">
              <p
                id="active-remix-statement"
                className="text-xl font-semibold leading-8 text-white sm:text-2xl"
              >
                <span className="sr-only">
                  {formatChoiceTemplateStatement(activeTemplate, "blank")}
                </span>
                <span aria-hidden="true">
                  {activeTemplate.beforeBlank}
                  <span className="mx-1 inline-block min-w-24 border-b-2 border-plasma px-2 text-center text-plasma">
                    _____
                  </span>
                  {activeTemplate.afterBlank}
                </span>
              </p>

              <div className="mt-6 flex items-center justify-between gap-4">
                <p
                  id="remix-answer-heading"
                  className="text-sm font-medium text-white/75"
                >
                  Choose one answer
                </p>
                <button
                  type="button"
                  onClick={shuffleChoiceResponses}
                  disabled={
                    disabled ||
                    participantBanned ||
                    submitting ||
                    preparingImage
                  }
                  aria-label="Shuffle the four answer choices"
                  className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white/75 outline-none transition hover:border-plasma/45 hover:bg-plasma/[0.08] focus-visible:ring-2 focus-visible:ring-plasma disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span aria-hidden="true" className="text-lg leading-none">
                    ⚄
                  </span>
                  New answers
                </button>
              </div>

              <div
                className="mt-3 grid gap-3 sm:grid-cols-2"
                role="group"
                aria-labelledby="active-remix-statement remix-answer-heading"
              >
                {visibleChoiceResponses.map((response) => {
                  const selected = selectedResponseId === response.id;

                  return (
                    <button
                      key={response.id}
                      type="button"
                      aria-pressed={selected}
                      disabled={
                        disabled ||
                        participantBanned ||
                        submitting ||
                        preparingImage
                      }
                      onClick={() => {
                        setSelectedResponseId(response.id);
                        setMessage(null);
                      }}
                      className={`min-h-14 rounded-2xl border px-4 py-3 text-left text-sm font-medium leading-6 outline-none transition focus-visible:ring-2 focus-visible:ring-plasma disabled:cursor-not-allowed disabled:opacity-55 ${
                        selected
                          ? "border-plasma bg-plasma/15 text-white shadow-[0_0_0_1px_rgba(172,255,47,0.18)]"
                          : "border-white/10 bg-white/[0.035] text-white/75 hover:border-white/25 hover:bg-white/[0.07]"
                      }`}
                    >
                      {response.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="mt-5">
              <p className="text-xl font-semibold leading-8 text-white sm:text-2xl">
                {activeTemplate.statement}
              </p>

              <div className="mt-5">
                <label className="block">
                  <span className="mb-2 block text-base font-medium text-white/88">
                    Image for this remix <span className="text-plasma">(required)</span>
                  </span>
                  <span className="block cursor-pointer rounded-3xl border border-dashed border-white/15 bg-white/[0.03] px-4 py-4 transition hover:border-plasma/45 hover:bg-plasma/[0.05]">
                    <input
                      ref={imageInputRef}
                      required
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                      disabled={
                        disabled ||
                        participantBanned ||
                        submitting ||
                        preparingImage
                      }
                      onChange={handleReferenceImageChange}
                      className="sr-only"
                    />
                    <span className="block text-sm font-semibold text-white/82">
                      Choose from your camera roll or files
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-white/48">
                      JPEG, PNG, WebP, or HEIC. Large camera photos are optimized automatically. Approved photos may appear on the live screen and guide the remix.
                    </span>
                  </span>
                </label>

                {referenceImage && referenceImagePreviewUrl ? (
                  <div className="mt-3 overflow-hidden rounded-3xl border border-white/10 bg-black/30">
                    <div className="relative aspect-[4/3] w-full">
                      <Image
                        src={referenceImagePreviewUrl}
                        alt="Selected remix reference"
                        fill
                        unoptimized
                        sizes="(max-width: 768px) 100vw, 640px"
                        className="object-cover"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-4 px-4 py-3">
                      <p className="min-w-0 truncate text-xs text-white/58">
                        {referenceImage.name}
                      </p>
                      <button
                        type="button"
                        onClick={() => replaceReferenceImage(null)}
                        disabled={submitting || preparingImage}
                        className="shrink-0 rounded-full border border-white/10 px-3 py-1 text-xs text-white/70 outline-none transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-plasma disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}

          <p className="sr-only" role="status" aria-live="polite">
            <span key={shuffleAnnouncement.revision}>
              {shuffleAnnouncement.message}
            </span>
          </p>
        </section>

        <button
          type="submit"
          disabled={
            submitting ||
            preparingImage ||
            disabled ||
            participantBanned ||
            !identityReady ||
            !activeTemplate ||
            (activeTemplate.kind === "choice" && !selectedResponseId) ||
            (activeTemplate.kind === "image" && !referenceImage)
          }
          className="w-full rounded-full bg-white px-6 py-3 text-sm font-semibold text-ink transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {disabled
            ? "Queue Offline"
            : participantBanned
              ? "Device Locked For This Sequence"
              : preparingImage
                ? "Preparing Photo..."
              : submitting
                ? "Sending..."
                : "Send Visual Idea"}
        </button>

        {message ? (
          <p
            className="rounded-3xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/80"
            role="status"
            aria-live="polite"
          >
            {message}
          </p>
        ) : null}

        {trackedStatus ? (
          <div className="rounded-4xl border border-white/10 bg-black/20 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-white/45">Latest Remix Status</p>
              <span className={`rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.24em] ${getStatusChipClassName(trackedStatus.state)}`}>
                {trackedStatus.state}
              </span>
            </div>

            <p className="mt-4 text-lg font-semibold text-white">{trackedStatus.title}</p>
            <p className="mt-3 text-sm leading-7 text-white/72">{trackedStatus.detail}</p>

            <div className="mt-4 flex flex-wrap gap-2">
              {renderSubmissionSteps(trackedStatus.state).map((step) => (
                <span
                  key={step.label}
                  className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.24em] ${
                    step.active
                      ? "border-plasma/45 bg-plasma/12 text-plasma"
                      : "border-white/10 bg-white/[0.03] text-white/42"
                  }`}
                >
                  {step.label}
                </span>
              ))}
            </div>

            <div className="mt-4 rounded-3xl border border-white/8 bg-white/[0.03] px-4 py-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-white/45">Submitted Prompt</p>
              {trackedStatus.referenceImageUrl ? (
                <div className="relative mt-3 aspect-[4/3] overflow-hidden rounded-2xl">
                  <Image
                    src={trackedStatus.referenceImageUrl}
                    alt="Approved remix reference"
                    fill
                    unoptimized
                    sizes="(max-width: 768px) 100vw, 640px"
                    className="object-cover"
                  />
                </div>
              ) : null}
              <p className="mt-2 text-sm leading-6 text-white/75">{trackedStatus.prompt}</p>
            </div>
          </div>
        ) : null}
      </form>
    </div>
  );
}

function createFallbackTrackedStatus(
  prompt: string,
  fallback?: {
    message?: string;
    status?: string;
  } | null
): TrackedSubmissionStatus {
  if (fallback?.status === "rejected") {
    return {
      state: "rejected",
      title: "Not approved for the queue",
      detail: fallback.message ?? "The venue-safe filter rejected this remix.",
      prompt,
      submittedAt: "",
      updatedAt: ""
    };
  }

  return {
    state: "approved",
    title: "Received by the queue",
    detail: fallback?.message ?? "Your remix is in the mix.",
    prompt,
    submittedAt: "",
    updatedAt: ""
  };
}

function createBannedTrackedStatus(
  prompt: string,
  payload?: {
    error?: string;
    message?: string;
    moderationBlockCount?: number;
  } | null
): TrackedSubmissionStatus {
  return {
    state: "banned",
    title: "Device locked for this sequence",
    detail:
      payload?.error ??
      payload?.message ??
      "Three blocked reference images have locked this device out until the live sequence ends.",
    prompt,
    moderationBlockCount: payload?.moderationBlockCount ?? 3,
    blocksRemaining: 0,
    submittedAt: "",
    updatedAt: ""
  };
}

function renderSubmissionSteps(state: TrackedSubmissionStatus["state"]) {
  const activeIndex = (() => {
    switch (state) {
      case "submitted":
        return 0;
      case "approved":
      case "retrying":
      case "blocked":
      case "banned":
      case "provider-blocked":
      case "rejected":
        return 1;
      case "queued":
        return 2;
      case "rendering":
        return 3;
      case "ready":
        return 4;
      case "live":
      case "played":
        return 5;
      default:
        return 0;
    }
  })();

  return ["Received", "Approved", "Queued", "Rendering", "Ready", "Live"].map((label, index) => ({
    label,
    active: index <= activeIndex
  }));
}

function getStatusChipClassName(state: TrackedSubmissionStatus["state"]) {
  switch (state) {
    case "live":
      return "border border-plasma/45 bg-plasma/12 text-plasma";
    case "ready":
    case "rendering":
    case "queued":
    case "approved":
    case "retrying":
    case "submitted":
      return "border border-white/10 bg-white/[0.03] text-white/72";
    case "played":
      return "border border-white/10 bg-white/[0.03] text-white/55";
    case "rejected":
    case "blocked":
    case "banned":
    case "provider-blocked":
      return "border border-ember/35 bg-ember/12 text-ember";
    default:
      return "border border-white/10 bg-white/[0.03] text-white/72";
  }
}

async function prepareReferenceImage(file: File) {
  if (
    file.size <= maximumReferenceImageBytes &&
    ["image/jpeg", "image/png", "image/webp"].includes(file.type)
  ) {
    return file;
  }

  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await loadBrowserImage(objectUrl);
    let converted = await renderReferenceImage(image, 1920, 0.82);

    if (converted.size > maximumReferenceImageBytes) {
      converted = await renderReferenceImage(image, 1280, 0.72);
    }

    if (converted.size > maximumReferenceImageBytes) {
      throw new Error("The optimized image is still too large.");
    }

    const baseName =
      file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "-") ||
      "remix-reference";

    return new File([converted], `${baseName}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now()
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadBrowserImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not decode image."));
    image.src = source;
  });
}

function renderReferenceImage(
  image: HTMLImageElement,
  maximumEdge: number,
  quality: number
) {
  const scale = Math.min(
    1,
    maximumEdge / Math.max(image.naturalWidth, image.naturalHeight)
  );
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Image conversion is unavailable.");
  }

  context.fillStyle = "#000000";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("Could not encode image.")),
      "image/jpeg",
      quality
    );
  });
}

function createParticipantDeviceToken() {
  if (typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  const bytes = new Uint8Array(24);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function readParticipantStorage(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeParticipantStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private browsing can disable storage; the in-memory identity still works for this page load.
  }
}
