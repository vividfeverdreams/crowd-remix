"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sessionFormSchema } from "@/lib/schemas";

const initialForm = {
  name: "Neon Echo Launch Set",
  artistName: "Neon Echo",
  trackName: "Skyline Pressure",
  creativeBible:
    "Kinetic abstract architecture, mirrored tunnel depth, humid atmosphere, elegant strobe restraint, no literal characters.",
  allowedMotifs: "laser lattice, liquid chrome, skyline fragments, pulse halos",
  bannedTerms: "violence, gore, nudity, celebrity, cartoon mascot",
  colorPalette: "teal, ember, dusk blue, warm sand",
  motionRules: "slow camera drift, pulse on phrase changes, never become chaotic or shaky",
  basePrompt:
    "A looping wide cinematic abstract concert visual with mirrored architecture, chrome fog, pulse halos, and elegant nightclub motion.",
  imageReferenceUrl: "",
  smsNumber: "",
  venueSafeMode: true,
  autoSelectEnabled: true
};

export function SessionSetupForm() {
  const router = useRouter();
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsed = sessionFormSchema.safeParse(form);

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the session details and try again.");
      return;
    }

    setIsSubmitting(true);

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

      startTransition(() => {
        router.push("/dashboard");
        router.refresh();
      });
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="panel p-6 sm:p-8">
      <div className="grid gap-6 lg:grid-cols-2">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-white/80">Session Name</span>
          <input
            required
            maxLength={100}
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            className="w-full rounded-3xl border border-white/10 bg-black/30 px-4 py-3 outline-none transition focus:border-plasma"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-white/80">Artist</span>
          <input
            required
            maxLength={100}
            value={form.artistName}
            onChange={(event) => setForm((current) => ({ ...current, artistName: event.target.value }))}
            className="w-full rounded-3xl border border-white/10 bg-black/30 px-4 py-3 outline-none transition focus:border-plasma"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-white/80">Track</span>
          <input
            required
            maxLength={100}
            value={form.trackName}
            onChange={(event) => setForm((current) => ({ ...current, trackName: event.target.value }))}
            className="w-full rounded-3xl border border-white/10 bg-black/30 px-4 py-3 outline-none transition focus:border-plasma"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-white/80">Twilio Number (optional)</span>
          <input
            type="tel"
            maxLength={100}
            value={form.smsNumber}
            onChange={(event) => setForm((current) => ({ ...current, smsNumber: event.target.value }))}
            className="w-full rounded-3xl border border-white/10 bg-black/30 px-4 py-3 outline-none transition focus:border-plasma"
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
            className="w-full rounded-3xl border border-white/10 bg-black/30 px-4 py-3 outline-none transition focus:border-plasma"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-white/80">Allowed Motifs</span>
          <textarea
            required
            maxLength={400}
            rows={4}
            value={form.allowedMotifs}
            onChange={(event) => setForm((current) => ({ ...current, allowedMotifs: event.target.value }))}
            className="w-full rounded-3xl border border-white/10 bg-black/30 px-4 py-3 outline-none transition focus:border-plasma"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-white/80">Banned Terms</span>
          <textarea
            required
            maxLength={400}
            rows={4}
            value={form.bannedTerms}
            onChange={(event) => setForm((current) => ({ ...current, bannedTerms: event.target.value }))}
            className="w-full rounded-3xl border border-white/10 bg-black/30 px-4 py-3 outline-none transition focus:border-plasma"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-white/80">Color Palette</span>
          <input
            required
            maxLength={200}
            value={form.colorPalette}
            onChange={(event) => setForm((current) => ({ ...current, colorPalette: event.target.value }))}
            className="w-full rounded-3xl border border-white/10 bg-black/30 px-4 py-3 outline-none transition focus:border-plasma"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-white/80">Motion Rules</span>
          <input
            required
            maxLength={300}
            value={form.motionRules}
            onChange={(event) => setForm((current) => ({ ...current, motionRules: event.target.value }))}
            className="w-full rounded-3xl border border-white/10 bg-black/30 px-4 py-3 outline-none transition focus:border-plasma"
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
            className="w-full rounded-3xl border border-white/10 bg-black/30 px-4 py-3 outline-none transition focus:border-plasma"
          />
        </label>

        <label className="block lg:col-span-2">
          <span className="mb-2 block text-sm font-medium text-white/80">Image Reference URL (optional)</span>
          <input
            type="url"
            value={form.imageReferenceUrl}
            onChange={(event) => setForm((current) => ({ ...current, imageReferenceUrl: event.target.value }))}
            className="w-full rounded-3xl border border-white/10 bg-black/30 px-4 py-3 outline-none transition focus:border-plasma"
            placeholder="https://..."
          />
        </label>
      </div>

      <div className="mt-6 flex flex-wrap gap-4 text-sm text-white/75">
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
          The first live render seeds the show from your base prompt. After that, approved crowd prompts are rewritten into focused Sora remixes.
        </p>

        <button
          type="submit"
          disabled={isSubmitting || isPending}
          className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-ink transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting || isPending ? "Creating..." : "Create Session"}
        </button>
      </div>
    </form>
  );
}
