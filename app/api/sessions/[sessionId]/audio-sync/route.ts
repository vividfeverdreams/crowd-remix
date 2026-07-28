import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isAudioSyncMessage } from "@/lib/audio-sync-channel";
import { publishAudioSyncMessage } from "@/lib/audio-sync-relay";
import {
  createAudioSyncRelayToken,
  parseAudioSyncRelayToken
} from "@/lib/audio-sync-relay-token";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = "iad1";

const relayCookieName = "dream-sequence-audio-relay";
const relayCookieLifetimeSeconds = 60 * 60 * 12;

type AudioSyncRouteProps = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function GET(_request: Request, { params }: AudioSyncRouteProps) {
  const { sessionId } = await params;
  const user = await getRelayUserForSession(sessionId);

  if (!user) {
    console.warn("[audio-sync] relay token refresh rejected", {
      sessionId,
      reason: "unauthenticated-or-session-not-owned"
    });
    return Response.json(
      {
        error: "Sign in again to reconnect live VFX."
      },
      {
        status: 401
      }
    );
  }

  console.info("[audio-sync] relay token refreshed", {
    sessionId
  });
  const relayToken = createAudioSyncRelayToken(sessionId, user.id);
  const response = NextResponse.json(
    {
      relayToken
    },
    {
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
  setRelayCookie(response, sessionId, relayToken);
  return response;
}

export async function POST(request: Request, { params }: AudioSyncRouteProps) {
  const { sessionId } = await params;
  const token = readBearerToken(request.headers.get("authorization"));
  const relayCookie = (await cookies()).get(relayCookieName)?.value;
  let tokenPayload = token ? parseAudioSyncRelayToken(token) : null;
  let recoveredRelayToken: string | null = null;

  if (!tokenPayload && relayCookie) {
    tokenPayload = parseAudioSyncRelayToken(relayCookie);
  }

  if (!tokenPayload || tokenPayload.sessionId !== sessionId) {
    const user = await getRelayUserForSession(sessionId);

    if (user) {
      recoveredRelayToken = createAudioSyncRelayToken(sessionId, user.id);
      tokenPayload = parseAudioSyncRelayToken(recoveredRelayToken);
      console.info("[audio-sync] relay authorization recovered from dashboard session", {
        sessionId
      });
    }
  }

  if (!tokenPayload || tokenPayload.sessionId !== sessionId) {
    console.warn("[audio-sync] relay message rejected", {
      sessionId,
      reason: token ? "invalid-or-expired-token" : "missing-token"
    });
    return Response.json(
      {
        error: "Unauthorized audio relay."
      },
      {
        status: 401
      }
    );
  }

  const message = await request.json().catch(() => null);

  if (!isAudioSyncMessage(message) || message.sessionId !== sessionId) {
    console.warn("[audio-sync] relay message rejected", {
      sessionId,
      reason: "invalid-message"
    });
    return Response.json(
      {
        error: "Invalid audio synchronization message."
      },
      {
        status: 400
      }
    );
  }

  await publishAudioSyncMessage(message);

  const response = new NextResponse(null, {
    status: 204,
    headers: {
      "Cache-Control": "no-store"
    }
  });

  if (recoveredRelayToken) {
    setRelayCookie(response, sessionId, recoveredRelayToken);
  }

  return response;
}

async function getRelayUserForSession(sessionId: string) {
  const user = await getCurrentUser();

  if (!user) {
    return null;
  }

  const session = await db.dJSession.findFirst({
    where: {
      id: sessionId,
      userId: user.id
    },
    select: {
      id: true
    }
  });

  return session ? user : null;
}

function setRelayCookie(response: NextResponse, sessionId: string, relayToken: string) {
  response.cookies.set({
    name: relayCookieName,
    value: relayToken,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: `/api/sessions/${sessionId}/audio-sync`,
    maxAge: relayCookieLifetimeSeconds
  });
}

function readBearerToken(authorization: string | null) {
  const prefix = "Bearer ";
  return authorization?.startsWith(prefix) ? authorization.slice(prefix.length) : null;
}
