import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { clearDjSession } from "@/lib/session-service";

type SessionRouteProps = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function DELETE(_request: Request, { params }: SessionRouteProps) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      {
        error: "Unauthorized"
      },
      {
        status: 401
      }
    );
  }

  const { sessionId } = await params;

  try {
    await clearDjSession(sessionId, user.id);
  } catch {
    return NextResponse.json(
      {
        error: "Session not found."
      },
      {
        status: 404
      }
    );
  }

  return NextResponse.json({
    ok: true
  });
}
