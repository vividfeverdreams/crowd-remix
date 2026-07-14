import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createDjSession } from "@/lib/session-service";
import { sessionFormSchema } from "@/lib/schemas";

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      {
        error: "You need to log in first."
      },
      {
        status: 401
      }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = sessionFormSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Check the session details and try again.",
        fieldErrors: parsed.error.flatten().fieldErrors
      },
      {
        status: 400
      }
    );
  }

  const session = await createDjSession(user.id, {
    ...parsed.data
  });

  return NextResponse.json({
    id: session.id,
    code: session.code
  });
}
