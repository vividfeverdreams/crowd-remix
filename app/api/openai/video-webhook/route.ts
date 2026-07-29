import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    {
      error: "OpenAI video webhooks are no longer used. Gemini Omni video jobs are reconciled through the Gemini Interactions API."
    },
    {
      status: 410
    }
  );
}
