export type HistorySyncBellState = {
  version: string | null;
  notificationKey: string | null;
  acknowledged: boolean;
  pendingAfter: string | null;
};

export type HistorySyncStatusSnapshot = {
  checkedAt: string;
  isCaughtUp: boolean;
  version: string | null;
};

export const EMPTY_HISTORY_SYNC_BELL_STATE: HistorySyncBellState = {
  version: null,
  notificationKey: null,
  acknowledged: false,
  pendingAfter: null
};

export function parseHistorySyncBellState(value: string | null): HistorySyncBellState {
  if (!value) {
    return { ...EMPTY_HISTORY_SYNC_BELL_STATE };
  }

  try {
    const parsed = JSON.parse(value) as Partial<HistorySyncBellState>;
    return {
      version: typeof parsed.version === "string" ? parsed.version : null,
      notificationKey:
        typeof parsed.notificationKey === "string" ? parsed.notificationKey : null,
      acknowledged: parsed.acknowledged === true,
      pendingAfter: typeof parsed.pendingAfter === "string" ? parsed.pendingAfter : null
    };
  } catch {
    return { ...EMPTY_HISTORY_SYNC_BELL_STATE };
  }
}

export function applyHistorySyncStatus(
  state: HistorySyncBellState,
  status: HistorySyncStatusSnapshot
): { state: HistorySyncBellState; shouldPresent: boolean } {
  if (!status.isCaughtUp || !status.version || !isValidDate(status.checkedAt)) {
    return { state, shouldPresent: false };
  }

  if (state.pendingAfter) {
    if (!isAfter(status.checkedAt, state.pendingAfter)) {
      return { state, shouldPresent: false };
    }

    const notificationKey = `${status.version}:rechecked-after:${state.pendingAfter}`;
    return {
      state: {
        version: status.version,
        notificationKey,
        acknowledged: false,
        pendingAfter: null
      },
      shouldPresent: true
    };
  }

  if (state.version !== status.version) {
    return {
      state: {
        version: status.version,
        notificationKey: status.version,
        acknowledged: false,
        pendingAfter: null
      },
      shouldPresent: true
    };
  }

  return {
    state,
    // Re-present an unread completion after a page navigation or reload. The
    // stable key lets the mounted bell deduplicate ordinary status polling.
    shouldPresent: !state.acknowledged && Boolean(state.notificationKey)
  };
}

export function queueHistorySyncRecheck(
  state: HistorySyncBellState,
  incomingMessageAt: string
): { state: HistorySyncBellState; invalidatedNotificationKey: string | null } {
  if (!isValidDate(incomingMessageAt)) {
    return { state, invalidatedNotificationKey: null };
  }

  if (state.pendingAfter) {
    return {
      state: {
        ...state,
        pendingAfter: laterDate(state.pendingAfter, incomingMessageAt)
      },
      invalidatedNotificationKey: null
    };
  }

  if (state.acknowledged || !state.notificationKey) {
    return { state, invalidatedNotificationKey: null };
  }

  return {
    state: {
      ...state,
      notificationKey: null,
      pendingAfter: incomingMessageAt
    },
    invalidatedNotificationKey: state.notificationKey
  };
}

export function acknowledgeHistorySyncBell(state: HistorySyncBellState) {
  if (!state.notificationKey || state.acknowledged) {
    return state;
  }

  return {
    ...state,
    acknowledged: true
  };
}

export function getHistorySyncNotificationId(notificationKey: string) {
  return `history-sync:${notificationKey}`;
}

function isAfter(left: string, right: string) {
  return new Date(left).getTime() > new Date(right).getTime();
}

function laterDate(left: string, right: string) {
  return isAfter(right, left) ? right : left;
}

function isValidDate(value: string) {
  return !Number.isNaN(new Date(value).getTime());
}
