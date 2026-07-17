"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getInboxNotificationSoundsMuted,
  initializeInboxNotificationSoundPreference,
  setInboxNotificationSoundsMuted,
  subscribeToInboxNotificationSoundPreference
} from "@/lib/inbox-notification-sound-client";

type UseInboxNotificationSoundPreferenceInput = {
  agentId: string;
  workspaceId: string;
  initialMuted: boolean;
};

export function useInboxNotificationSoundPreference(input: UseInboxNotificationSoundPreferenceInput) {
  const scope = useMemo(
    () => ({
      agentId: input.agentId,
      workspaceId: input.workspaceId
    }),
    [input.agentId, input.workspaceId]
  );
  const [isMuted, setIsMuted] = useState(() =>
    initializeInboxNotificationSoundPreference(scope, input.initialMuted)
  );
  const requestSequenceRef = useRef(0);

  useEffect(() => {
    setIsMuted(initializeInboxNotificationSoundPreference(scope, input.initialMuted));
    return subscribeToInboxNotificationSoundPreference(scope, setIsMuted);
  }, [input.initialMuted, scope]);

  const updateMutedPreference = useCallback(
    async (muted: boolean) => {
      const previousMuted = getInboxNotificationSoundsMuted(scope);
      const requestSequence = ++requestSequenceRef.current;

      setInboxNotificationSoundsMuted(scope, muted);

      try {
        const response = await fetch("/api/inbox/preferences", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            inboxNotificationSoundsMuted: muted
          })
        });

        const payload = (await response.json().catch(() => null)) as
          | {
              error?: string;
              inboxNotificationSoundsMuted?: boolean;
            }
          | null;

        if (!response.ok) {
          throw new Error(payload?.error ?? "Unable to update Inbox notification preference.");
        }

        if (requestSequence === requestSequenceRef.current) {
          setInboxNotificationSoundsMuted(scope, payload?.inboxNotificationSoundsMuted === true);
        }

        return payload?.inboxNotificationSoundsMuted === true;
      } catch (error) {
        if (requestSequence === requestSequenceRef.current) {
          setInboxNotificationSoundsMuted(scope, previousMuted);
        }

        throw error;
      }
    },
    [scope]
  );

  return {
    isMuted,
    updateMutedPreference
  };
}
