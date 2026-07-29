import { createHmac, timingSafeEqual } from "crypto";
import { env } from "@/lib/env";

type AudioSyncRelayTokenPayload = {
  sessionId: string;
  userId: string;
  exp: number;
};

const relayTokenLifetimeMs = 1000 * 60 * 60 * 12;
const relayTokenPurpose = "dream-sequence:audio-sync-relay";

export function createAudioSyncRelayToken(sessionId: string, userId: string) {
  const payload: AudioSyncRelayTokenPayload = {
    sessionId,
    userId,
    exp: Date.now() + relayTokenLifetimeMs
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signRelayPayload(encoded)}`;
}

export function parseAudioSyncRelayToken(token: string) {
  const [encoded, signature] = token.split(".");

  if (!encoded || !signature) {
    return null;
  }

  const expected = signRelayPayload(encoded);

  if (
    expected.length !== signature.length ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString()) as Partial<AudioSyncRelayTokenPayload>;

    if (
      typeof payload.sessionId !== "string" ||
      typeof payload.userId !== "string" ||
      typeof payload.exp !== "number" ||
      !Number.isFinite(payload.exp) ||
      payload.exp < Date.now()
    ) {
      return null;
    }

    return payload as AudioSyncRelayTokenPayload;
  } catch {
    return null;
  }
}

function signRelayPayload(encodedPayload: string) {
  return createHmac("sha256", env.authSecret)
    .update(`${relayTokenPurpose}:${encodedPayload}`)
    .digest("base64url");
}
