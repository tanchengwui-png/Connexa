const CONNECTION_PROGRESS_RANK: Record<string, number> = {
  INITIALIZING: 1,
  QR_READY: 2,
  AUTHENTICATED: 3,
  CONNECTED: 4,
  READY: 4,
  SYNCING_HISTORY: 4
};

export function wouldRegressActiveWhatsAppConnection(currentStatus: string, nextStatus: string) {
  const currentRank = CONNECTION_PROGRESS_RANK[currentStatus] ?? 0;
  const nextRank = CONNECTION_PROGRESS_RANK[nextStatus] ?? 0;
  // Explicit disconnect, auth failure, and recovery states remain valid. Only
  // fence delayed preparation/QR snapshots from moving an accepted pairing
  // backward within the active attempt.
  return currentRank >= CONNECTION_PROGRESS_RANK.AUTHENTICATED && nextRank > 0 && nextRank < currentRank;
}

export function isStaleWhatsAppConnectionEvent(input: {
  currentAttemptId: string | null;
  eventAttemptId?: string | null;
  currentSequence: number;
  eventSequence?: number;
  currentQrVersion: number;
  eventQrVersion?: number;
  eventStatus: string;
}) {
  const isCurrentAttempt = Boolean(
    input.eventAttemptId &&
      input.currentAttemptId &&
      input.eventAttemptId === input.currentAttemptId
  );

  if (
    isCurrentAttempt &&
    typeof input.eventSequence === "number" &&
    input.eventSequence <= input.currentSequence
  ) {
    return true;
  }

  return Boolean(
    isCurrentAttempt &&
      input.eventStatus === "QR_READY" &&
      typeof input.eventQrVersion === "number" &&
      input.eventQrVersion < input.currentQrVersion
  );
}
