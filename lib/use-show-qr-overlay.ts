"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createShowQrOverlayMessage,
  getShowOverlayChannelName,
  getShowQrOverlayStorageKey,
  isShowQrOverlayMessage
} from "@/lib/show-overlay-channel";

export function useShowQrOverlay(sessionId: string) {
  const [visible, setVisibleState] = useState(false);
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    const storageKey = getShowQrOverlayStorageKey(sessionId);

    try {
      setVisibleState(window.localStorage.getItem(storageKey) === "true");
    } catch {
      // Private browsing modes can disable storage while live synchronization still works.
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key === storageKey) {
        setVisibleState(event.newValue === "true");
      }
    };

    window.addEventListener("storage", handleStorage);

    if (!("BroadcastChannel" in window)) {
      return () => {
        window.removeEventListener("storage", handleStorage);
      };
    }

    const channel = new BroadcastChannel(getShowOverlayChannelName(sessionId));
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (!isShowQrOverlayMessage(event.data) || event.data.sessionId !== sessionId) {
        return;
      }

      setVisibleState(event.data.visible);
    };

    return () => {
      window.removeEventListener("storage", handleStorage);
      channel.close();
      channelRef.current = null;
    };
  }, [sessionId]);

  const setVisible = useCallback(
    (nextVisible: boolean) => {
      setVisibleState(nextVisible);

      try {
        window.localStorage.setItem(getShowQrOverlayStorageKey(sessionId), String(nextVisible));
      } catch {
        // The BroadcastChannel path remains available when storage is unavailable.
      }

      try {
        channelRef.current?.postMessage(createShowQrOverlayMessage(sessionId, nextVisible));
      } catch {
        // Closing a pop-out should never interrupt the dashboard control.
      }
    },
    [sessionId]
  );

  return {
    setVisible,
    visible
  };
}
