"use client";

import { startTransition, useEffect, useState } from "react";
import type { SessionSnapshot } from "@/lib/snapshot";

export function useSessionSnapshot(initialSnapshot: NonNullable<SessionSnapshot>) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const sessionId = initialSnapshot.session.id;

  useEffect(() => {
    const stream = new EventSource(`/api/sessions/${sessionId}/stream`);

    stream.onmessage = (event) => {
      const payload = JSON.parse(event.data) as NonNullable<SessionSnapshot>;
      startTransition(() => {
        setSnapshot(payload);
      });
    };

    stream.addEventListener("close", () => {
      stream.close();
    });

    return () => {
      stream.close();
    };
  }, [sessionId]);

  return snapshot;
}
