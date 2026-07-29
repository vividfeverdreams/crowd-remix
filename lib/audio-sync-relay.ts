import { getCache } from "@vercel/functions";
import { isAudioSyncMessage, type AudioSyncMessage } from "@/lib/audio-sync-channel";

const audioSyncCache = getCache({
  namespace: "dream-sequence-audio-sync-v2"
});

const liveStateTtlSeconds = 5;
const eventTtlSeconds = 15;

export type AudioSyncRelaySnapshot = {
  liveState: AudioSyncMessage | null;
  cue: AudioSyncMessage | null;
  take: AudioSyncMessage | null;
};

export async function publishAudioSyncMessage(message: AudioSyncMessage) {
  const kind = getRelayMessageKind(message);

  await audioSyncCache.set(getRelayKey(message.sessionId, kind), message, {
    ttl: kind === "live" ? liveStateTtlSeconds : eventTtlSeconds,
    tags: [`audio-sync:${message.sessionId}`],
    name: `audio-sync-${kind}`
  });
}

export async function getAudioSyncRelaySnapshot(sessionId: string): Promise<AudioSyncRelaySnapshot> {
  const [liveState, cue, take] = await Promise.all([
    audioSyncCache.get(getRelayKey(sessionId, "live")),
    audioSyncCache.get(getRelayKey(sessionId, "cue")),
    audioSyncCache.get(getRelayKey(sessionId, "take"))
  ]);

  return {
    liveState: readRelayMessage(liveState, sessionId),
    cue: readRelayMessage(cue, sessionId),
    take: readRelayMessage(take, sessionId)
  };
}

function getRelayMessageKind(message: AudioSyncMessage) {
  if (message.type === "cue") {
    return "cue";
  }

  if (message.type === "take") {
    return "take";
  }

  return "live";
}

function getRelayKey(sessionId: string, kind: "live" | "cue" | "take") {
  return `${sessionId}:${kind}`;
}

function readRelayMessage(value: unknown, sessionId: string) {
  return isAudioSyncMessage(value) && value.sessionId === sessionId ? value : null;
}
