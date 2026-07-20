"use server";

import { requireUser } from "@/lib/auth";
import { sessionIdeaSchema } from "@/lib/schemas";
import { buildSessionDraft } from "@/lib/session-prefill";

export async function generateSessionDraft(input: unknown) {
  await requireUser();

  const parsed = sessionIdeaSchema.safeParse(input);

  if (!parsed.success) {
    return {
      success: false as const,
      error: parsed.error.issues[0]?.message ?? "Tell us what you want to create first."
    };
  }

  try {
    const draft = await buildSessionDraft(parsed.data.idea);

    return {
      success: true as const,
      draft
    };
  } catch (error) {
    console.error(
      "Session draft generation failed:",
      error instanceof Error ? error.message : "Unknown AI generation error"
    );

    return {
      success: false as const,
      error: "We couldn't build the AI draft just now. Try again, or enter the details manually."
    };
  }
}
