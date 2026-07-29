"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateSessionDraft } from "@/app/dashboard/new/actions";
import { sessionFormSchema, sessionIdeaSchema } from "@/lib/schemas";
import {
  defaultVideoDurationSeconds,
  videoDurationOptions,
  type VideoDurationSeconds
} from "@/lib/video-duration";

const blankForm = {
  name: "",
  artistName: "",
  trackName: "",
  creativeBible: "",
  allowedMotifs: "",
  bannedTerms: "",
  colorPalette: "",
  motionRules: "",
  basePrompt: "",
  imageReferenceUrl: "",
  smsNumber: "",
  venueSafeMode: true,
  artistControlEnabled: true,
  autoSelectEnabled: true,
  videoDurationSeconds: defaultVideoDurationSeconds,
  submissionRateLimitEnabled: false,
  submissionRateLimitCount: 3
};

type FlowStep = "idea" | "details";
type DraftSource = "ai" | "manual";

const inputClassName =
  "w-full rounded-3xl border border-white/10 bg-black/30 px-4 py-3 outline-none transition placeholder:text-white/30 focus:border-plasma";

const videoDurationDescriptions: Record<VideoDurationSeconds, string> = {
  4: "Quick turnover",
  6: "Balanced pacing",
  8: "Longest visual arc"
};

export function SessionSetupForm() {
  const router = useRouter();
  const [step, setStep] = useState<FlowStep>("idea");
  const [draftSource, setDraftSource] = useState<DraftSource>("ai");
  const [idea, setIdea] = useState("");
  const [form, setForm] = useState(blankForm);
  const [ideaError, setIdeaError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allowedMotifsEnabled, setAllowedMotifsEnabled] = useState(true);
  const [isGenerating, startGenerating] = useTransition();
  const [isCreating, startCreating] = useTransition();

  function handleIdeaSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIdeaError(null);

    const parsed = sessionIdeaSchema.safeParse({ idea });

    if (!parsed.success) {
      setIdeaError(parsed.error.issues[0]?.message ?? "Tell us what you want to create first.");
      return;
    }

    startGenerating(async () => {
      try {
        const result = await generateSessionDraft(parsed.data);

        if (!result.success) {
          setIdeaError(result.error);
          return;
        }

        setForm((current) => ({
          ...current,
          ...result.draft
        }));
        setAllowedMotifsEnabled(true);
        setDraftSource("ai");
        setError(null);
        setStep("details");
      } catch {
        setIdeaError("We couldn't reach the AI just now. Try again, or enter the details manually.");
      }
    });
  }

  function enterManually() {
    setForm(blankForm);
    setAllowedMotifsEnabled(true);
    setDraftSource("manual");
    setIdeaError(null);
    setError(null);
    setStep("details");
  }

  function returnToIdea() {
    setError(null);
    setStep("idea");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsed = sessionFormSchema.safeParse({
      ...form,
      allowedMotifs: allowedMotifsEnabled ? form.allowedMotifs : ""
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the session details and try again.");
      return;
    }

    startCreating(async () => {
      try {
        const response = await fetch("/api/sessions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(parsed.data)
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          setError(payload?.error ?? "Could not create the session.");
          return;
        }

        router.push("/dashboard");
        router.refresh();
      } catch {
        setError("Could not reach the server. Check your connection and try again.");
      }
    });
  }

  if (step === "idea") {
    return (
      <form onSubmit={handleIdeaSubmit} className="panel overflow-hidden">
        <div className="border-b border-white/10 px-6 py-5 sm:px-8">
          <StepIndicator activeStep="idea" />
        </div>

        <div className="bg-aurora px-6 py-8 sm:px-8 sm:py-10">
          <div className="max-w-3xl">
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-plasma">Start with the idea</p>
            <h2 className="mt-4 text-2xl font-semibold text-white sm:text-3xl">
              What do you want this live visual session to feel like?
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-white/65 sm:text-base">
              Write it naturally. Mention the artist or track if you know them, plus any mood, colors, imagery, movement, or hard no&apos;s you already have in mind.
            </p>
          </div>

          <div className="mt-7">
            <label className="block">
              <span className="sr-only">Describe your session idea</span>
              <textarea
                autoFocus
                required
                maxLength={1200}
                rows={8}
                value={idea}
                disabled={isGenerating}
                onChange={(event) => setIdea(event.target.value)}
                className={`${inputClassName} min-h-52 resize-y bg-black/45 text-base leading-7 sm:text-lg`}
                placeholder="I want a late-night visual world for my DJ set that feels like driving through a rain-soaked future city. Deep blues and electric amber, reflective glass, slow cinematic movement, and nothing too literal or chaotic..."
              />
            </label>
            <span className="mt-2 block text-right font-mono text-xs text-white/35">{idea.length} / 1200</span>
          </div>

          {ideaError ? (
            <p role="alert" className="mt-5 rounded-3xl border border-ember/20 bg-ember/10 px-4 py-3 text-sm text-ember">
              {ideaError}
            </p>
          ) : null}

          <div className="mt-7 flex flex-wrap items-center gap-4">
            <button
              type="submit"
              disabled={isGenerating}
              className="inline-flex min-w-44 items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-ink transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isGenerating ? (
                <>
                  <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-ink/25 border-t-ink" />
                  Expanding your idea...
                </>
              ) : (
                "Build my session draft"
              )}
            </button>

            <button
              type="button"
              disabled={isGenerating}
              onClick={enterManually}
              className="rounded-full border border-white/15 px-5 py-3 text-sm font-medium text-white/75 transition hover:border-white/30 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Enter details manually
            </button>

            <p className="w-full text-xs leading-5 text-white/40 sm:ml-auto sm:w-auto">
              AI creates a draft. You approve every detail before anything is saved.
            </p>
          </div>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="panel overflow-hidden">
      <div className="border-b border-white/10 px-6 py-5 sm:px-8">
        <StepIndicator activeStep="details" />
      </div>

      <div className="flex flex-wrap items-start justify-between gap-5 border-b border-white/10 bg-white/[0.025] px-6 py-6 sm:px-8">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.28em] text-plasma">
            {draftSource === "ai" ? "AI draft ready" : "Manual setup"}
          </p>
          <h2 className="mt-3 text-2xl font-semibold text-white">
            {draftSource === "ai" ? "Review and shape the details." : "Define the visual DNA."}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">
            {draftSource === "ai"
              ? "The AI expanded your idea into the same session questions as before. Everything below is editable—adjust anything it misunderstood before creating the session."
              : "Complete the same session questions yourself. You can return to the first step at any time and ask AI to build a draft."}
          </p>
        </div>

        <button
          type="button"
          onClick={returnToIdea}
          className="rounded-full border border-white/15 px-5 py-2.5 text-sm font-medium text-white/75 transition hover:border-white/30 hover:bg-white/5"
        >
          Back to your idea
        </button>
      </div>

      <div className="p-6 sm:p-8">
        <div className="grid gap-6 lg:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-white/80">Session Name</span>
            <input
              required
              maxLength={100}
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              className={inputClassName}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-white/80">Artist</span>
            <input
              required
              maxLength={100}
              value={form.artistName}
              onChange={(event) => setForm((current) => ({ ...current, artistName: event.target.value }))}
              className={inputClassName}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-white/80">Track</span>
            <input
              required
              maxLength={100}
              value={form.trackName}
              onChange={(event) => setForm((current) => ({ ...current, trackName: event.target.value }))}
              className={inputClassName}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-white/80">Twilio Number (optional)</span>
            <input
              type="tel"
              maxLength={100}
              value={form.smsNumber}
              onChange={(event) => setForm((current) => ({ ...current, smsNumber: event.target.value }))}
              className={inputClassName}
              placeholder="+15555555555"
            />
          </label>

          <label className="block lg:col-span-2">
            <span className="mb-2 block text-sm font-medium text-white/80">Creative Bible</span>
            <textarea
              required
              maxLength={600}
              rows={4}
              value={form.creativeBible}
              onChange={(event) => setForm((current) => ({ ...current, creativeBible: event.target.value }))}
              className={inputClassName}
            />
          </label>

          <div className="block">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm font-medium text-white/80">Allowed Motifs</span>
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-white/65">
                <input
                  type="checkbox"
                  role="switch"
                  checked={allowedMotifsEnabled}
                  onChange={(event) => setAllowedMotifsEnabled(event.target.checked)}
                />
                {allowedMotifsEnabled ? "On" : "Off"}
              </label>
            </div>
            <textarea
              required={allowedMotifsEnabled}
              maxLength={400}
              rows={4}
              value={form.allowedMotifs}
              onChange={(event) => setForm((current) => ({ ...current, allowedMotifs: event.target.value }))}
              disabled={!allowedMotifsEnabled}
              aria-describedby="allowed-motifs-help"
              className={`${inputClassName} disabled:cursor-not-allowed disabled:border-white/5 disabled:bg-black/15 disabled:text-white/25`}
            />
            <p id="allowed-motifs-help" className="mt-2 text-xs leading-5 text-white/45">
              {allowedMotifsEnabled
                ? "On: crowd ideas are guided toward this motif list."
                : "Off: crowd members can suggest any motif that still fits the session and safety rules."}
            </p>
          </div>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-white/80">Banned Terms</span>
            <textarea
              required
              maxLength={400}
              rows={4}
              value={form.bannedTerms}
              onChange={(event) => setForm((current) => ({ ...current, bannedTerms: event.target.value }))}
              className={inputClassName}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-white/80">Color Palette</span>
            <input
              required
              maxLength={200}
              value={form.colorPalette}
              onChange={(event) => setForm((current) => ({ ...current, colorPalette: event.target.value }))}
              className={inputClassName}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-white/80">Motion Rules</span>
            <input
              required
              maxLength={300}
              value={form.motionRules}
              onChange={(event) => setForm((current) => ({ ...current, motionRules: event.target.value }))}
              className={inputClassName}
            />
          </label>

          <label className="block lg:col-span-2">
            <span className="mb-2 block text-sm font-medium text-white/80">Base Prompt</span>
            <textarea
              required
              maxLength={1200}
              rows={5}
              value={form.basePrompt}
              onChange={(event) => setForm((current) => ({ ...current, basePrompt: event.target.value }))}
              className={inputClassName}
            />
          </label>

          <label className="block lg:col-span-2">
            <span className="mb-2 block text-sm font-medium text-white/80">Image Reference URL (optional)</span>
            <input
              type="url"
              value={form.imageReferenceUrl}
              onChange={(event) => setForm((current) => ({ ...current, imageReferenceUrl: event.target.value }))}
              className={inputClassName}
              placeholder="https://..."
            />
          </label>

          <fieldset className="lg:col-span-2">
            <legend className="text-sm font-medium text-white/80">Video length</legend>
            <p id="video-duration-help" className="mt-2 text-sm leading-6 text-white/50">
              Applies to the opening seed and every crowd remix in this session.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {videoDurationOptions.map((duration) => (
                <label
                  key={duration}
                  className={`cursor-pointer rounded-3xl border px-4 py-4 transition focus-within:ring-2 focus-within:ring-plasma/70 ${
                    form.videoDurationSeconds === duration
                      ? "border-plasma/60 bg-plasma/10"
                      : "border-white/10 bg-black/20 hover:border-white/20"
                  }`}
                >
                  <input
                    type="radio"
                    name="videoDurationSeconds"
                    value={duration}
                    checked={form.videoDurationSeconds === duration}
                    aria-describedby="video-duration-help"
                    onChange={() =>
                      setForm((current) => ({
                        ...current,
                        videoDurationSeconds: duration
                      }))
                    }
                    className="sr-only"
                  />
                  <span className="block text-lg font-semibold text-white">{duration} seconds</span>
                  <span className="mt-1 block text-xs text-white/50">
                    {videoDurationDescriptions[duration]}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="mt-6 rounded-3xl border border-white/10 bg-white/[0.025] p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <p className="font-mono text-xs uppercase tracking-[0.24em] text-plasma">Crowd remix prompting</p>
              <h3 className="mt-2 text-lg font-semibold text-white">Artist control</h3>
              <p id="artist-control-help" className="mt-2 text-sm leading-6 text-white/60">
                {form.artistControlEnabled
                  ? "On: the application moderates, scores, and rewrites crowd ideas using your Creative Bible, motifs, palette, and motion rules."
                  : "Off — Raw Prompt Mode: crowd remix prompts bypass artist direction and AI rewriting, then go to Gemini Omni exactly as written. Your base prompt still seeds the show."}
              </p>
            </div>

            <label className="inline-flex cursor-pointer items-center gap-3 rounded-full border border-white/15 px-4 py-3 text-sm font-medium text-white/80">
              <input
                type="checkbox"
                role="switch"
                aria-describedby="artist-control-help"
                checked={form.artistControlEnabled}
                onChange={(event) =>
                  setForm((current) => ({ ...current, artistControlEnabled: event.target.checked }))
                }
              />
              {form.artistControlEnabled ? "On" : "Off — Raw prompts"}
            </label>
          </div>
        </div>

        <div className="mt-4 rounded-3xl border border-white/10 bg-white/[0.025] p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <p className="font-mono text-xs uppercase tracking-[0.24em] text-plasma">Crowd pacing</p>
              <h3 className="mt-2 text-lg font-semibold text-white">Limit remixes per device</h3>
              <p id="submission-rate-limit-help" className="mt-2 text-sm leading-6 text-white/60">
                {form.submissionRateLimitEnabled
                  ? `Each device can send up to ${form.submissionRateLimitCount} ${form.submissionRateLimitCount === 1 ? "remix" : "remixes"} within any ten-minute period.`
                  : "Off: participants can submit as many remixes as they want. Video-safety moderation lockouts still apply separately."}
              </p>
            </div>

            <label className="inline-flex cursor-pointer items-center gap-3 rounded-full border border-white/15 px-4 py-3 text-sm font-medium text-white/80">
              <input
                type="checkbox"
                role="switch"
                aria-describedby="submission-rate-limit-help"
                checked={form.submissionRateLimitEnabled}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    submissionRateLimitEnabled: event.target.checked
                  }))
                }
              />
              {form.submissionRateLimitEnabled ? "On" : "Off"}
            </label>
          </div>

          <label className="mt-5 block max-w-xs">
            <span className="mb-2 block text-sm font-medium text-white/80">Remixes per device</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={20}
              step={1}
              value={form.submissionRateLimitCount}
              disabled={!form.submissionRateLimitEnabled}
              aria-describedby="submission-rate-limit-help"
              onChange={(event) => {
                const nextValue = event.currentTarget.valueAsNumber;

                if (Number.isInteger(nextValue)) {
                  setForm((current) => ({
                    ...current,
                    submissionRateLimitCount: Math.min(20, Math.max(1, nextValue))
                  }));
                }
              }}
              className={`${inputClassName} disabled:cursor-not-allowed disabled:border-white/5 disabled:bg-black/15 disabled:text-white/25`}
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-4 text-sm text-white/75">
          <label className="inline-flex items-center gap-3 rounded-full border border-white/10 px-4 py-3">
            <input
              type="checkbox"
              checked={form.venueSafeMode}
              onChange={(event) => setForm((current) => ({ ...current, venueSafeMode: event.target.checked }))}
            />
            Venue-safe mode
          </label>

          <label className="inline-flex items-center gap-3 rounded-full border border-white/10 px-4 py-3">
            <input
              type="checkbox"
              checked={form.autoSelectEnabled}
              onChange={(event) => setForm((current) => ({ ...current, autoSelectEnabled: event.target.checked }))}
            />
            Auto-select winning prompts
          </label>
        </div>

        {error ? (
          <p role="alert" className="mt-5 rounded-3xl border border-ember/20 bg-ember/10 px-4 py-3 text-sm text-ember">
            {error}
          </p>
        ) : null}

        <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
          <p className="max-w-2xl text-sm leading-7 text-white/65">
            {form.artistControlEnabled
              ? "The first live render seeds the show from your base prompt. After that, approved crowd prompts are rewritten into focused Gemini Omni video edits."
              : "The first live render still uses your base prompt. After that, crowd remix prompts are sent to Gemini Omni exactly as written, with no artist-direction rewrite."}
          </p>

          <button
            type="submit"
            disabled={isCreating}
            className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-ink transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isCreating ? "Creating..." : "Create Session"}
          </button>
        </div>
      </div>
    </form>
  );
}

function StepIndicator({ activeStep }: { activeStep: FlowStep }) {
  return (
    <ol aria-label="Session setup progress" className="flex items-center gap-3 text-xs font-medium uppercase tracking-[0.18em]">
      <li className={activeStep === "idea" ? "text-plasma" : "text-white/45"}>
        <span className="mr-2 font-mono">01</span>
        Describe
      </li>
      <li aria-hidden="true" className="h-px w-8 bg-white/15" />
      <li className={activeStep === "details" ? "text-plasma" : "text-white/35"}>
        <span className="mr-2 font-mono">02</span>
        Review &amp; edit
      </li>
    </ol>
  );
}
