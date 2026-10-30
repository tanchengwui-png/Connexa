import {
  lstatSync,
  readFileSync,
  readlinkSync,
  rmSync
} from "fs";
import path from "path";

const CHROMIUM_PROFILE_LOCK_NAMES = [
  "SingletonLock",
  "SingletonSocket",
  "SingletonCookie",
  "lockfile"
] as const;

export type ChromiumProfileOwnerState = "active" | "stale" | "unknown";

export type ChromiumProfileLockResolution = {
  state: "none" | "active" | "unverifiable" | "stale-cleared";
  ownerPid: number | null;
  removedPaths: string[];
};

type ChromiumProfileLockOptions = {
  inspectOwner?: (pid: number, sessionPath: string) => ChromiumProfileOwnerState;
};

function lockMarkerExists(lockPath: string) {
  try {
    lstatSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

function readLockOwnerPid(lockPath: string) {
  try {
    const lockStat = lstatSync(lockPath);
    const ownerText = lockStat.isSymbolicLink()
      ? readlinkSync(lockPath)
      : readFileSync(lockPath, "utf8").trim();
    const match = ownerText.match(/(?:^|[-_])(\d+)$/);
    if (!match) {
      return null;
    }

    const pid = Number.parseInt(match[1], 10);
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function inspectLocalProcessOwner(pid: number, sessionPath: string): ChromiumProfileOwnerState {
  try {
    process.kill(pid, 0);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") {
      return "stale";
    }
    return "unknown";
  }

  try {
    const commandLine = readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ");
    const isChromium = /(?:^|[\/\s-])(chromium|chrome)(?:[\s-]|$)/i.test(commandLine);
    const resolvedSessionPath = path.resolve(sessionPath);
    const ownsProfile = commandLine.includes(`--user-data-dir=${resolvedSessionPath}`);

    return isChromium && ownsProfile ? "active" : "stale";
  } catch {
    return "unknown";
  }
}

/**
 * Clear Chromium's known profile lock markers only after proving that their
 * recorded owner is stale. Unknown ownership is deliberately non-destructive.
 */
export function clearStaleChromiumProfileLocks(
  sessionPath: string,
  options: ChromiumProfileLockOptions = {}
): ChromiumProfileLockResolution {
  const lockPaths = CHROMIUM_PROFILE_LOCK_NAMES
    .map((name) => path.join(sessionPath, name))
    .filter(lockMarkerExists);

  if (!lockPaths.length) {
    return { state: "none", ownerPid: null, removedPaths: [] };
  }

  const ownerLockPath = path.join(sessionPath, "SingletonLock");
  const fallbackLockPath = path.join(sessionPath, "lockfile");
  const ownerPid = lockMarkerExists(ownerLockPath)
    ? readLockOwnerPid(ownerLockPath)
    : lockMarkerExists(fallbackLockPath)
      ? readLockOwnerPid(fallbackLockPath)
      : null;

  if (!ownerPid) {
    return { state: "unverifiable", ownerPid: null, removedPaths: [] };
  }

  const ownerState = (options.inspectOwner ?? inspectLocalProcessOwner)(ownerPid, sessionPath);
  if (ownerState !== "stale") {
    return {
      state: ownerState === "active" ? "active" : "unverifiable",
      ownerPid,
      removedPaths: []
    };
  }

  for (const lockPath of lockPaths) {
    rmSync(lockPath, { force: true, recursive: false });
  }

  return { state: "stale-cleared", ownerPid, removedPaths: lockPaths };
}
