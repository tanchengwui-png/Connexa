import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { clearStaleChromiumProfileLocks } from "../lib/chromium-profile-lock.ts";

function createProfile() {
  const sessionPath = mkdtempSync(path.join(tmpdir(), "connexa-profile-lock-"));
  const credentialPath = path.join(sessionPath, "Default", "Local Storage", "credentials.db");
  mkdirSync(path.dirname(credentialPath), { recursive: true });
  writeFileSync(credentialPath, "saved-local-auth");
  symlinkSync("sender-host-4242", path.join(sessionPath, "SingletonLock"));
  symlinkSync("/tmp/chromium-socket", path.join(sessionPath, "SingletonSocket"));
  return { sessionPath, credentialPath };
}

test("active Chromium profile ownership preserves every lock and LocalAuth credential", () => {
  const profile = createProfile();
  try {
    const result = clearStaleChromiumProfileLocks(profile.sessionPath, {
      inspectOwner: () => "active"
    });

    assert.equal(result.state, "active");
    assert.equal(result.ownerPid, 4242);
    assert.deepEqual(result.removedPaths, []);
    assert.equal(readFileSync(profile.credentialPath, "utf8"), "saved-local-auth");
    assert.doesNotThrow(() => lstatSync(path.join(profile.sessionPath, "SingletonLock")));
    assert.doesNotThrow(() => lstatSync(path.join(profile.sessionPath, "SingletonSocket")));
  } finally {
    rmSync(profile.sessionPath, { recursive: true, force: true });
  }
});

test("unverifiable lock ownership is non-destructive", () => {
  const profile = createProfile();
  try {
    rmSync(path.join(profile.sessionPath, "SingletonLock"));
    symlinkSync("owner-without-a-pid", path.join(profile.sessionPath, "SingletonLock"));

    const result = clearStaleChromiumProfileLocks(profile.sessionPath);

    assert.equal(result.state, "unverifiable");
    assert.equal(readFileSync(profile.credentialPath, "utf8"), "saved-local-auth");
    assert.doesNotThrow(() => lstatSync(path.join(profile.sessionPath, "SingletonLock")));
  } finally {
    rmSync(profile.sessionPath, { recursive: true, force: true });
  }
});

test("proven stale ownership clears only known top-level lock markers", () => {
  const profile = createProfile();
  const nestedLock = path.join(profile.sessionPath, "Default", "SingletonLock");
  writeFileSync(nestedLock, "application-data");
  try {
    const result = clearStaleChromiumProfileLocks(profile.sessionPath, {
      inspectOwner: () => "stale"
    });

    assert.equal(result.state, "stale-cleared");
    assert.equal(result.removedPaths.length, 2);
    assert.equal(existsSync(path.join(profile.sessionPath, "SingletonLock")), false);
    assert.equal(existsSync(path.join(profile.sessionPath, "SingletonSocket")), false);
    assert.equal(readFileSync(profile.credentialPath, "utf8"), "saved-local-auth");
    assert.equal(readFileSync(nestedLock, "utf8"), "application-data");
  } finally {
    rmSync(profile.sessionPath, { recursive: true, force: true });
  }
});

test("repeated active lock failures never erase the saved profile", () => {
  const profile = createProfile();
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = clearStaleChromiumProfileLocks(profile.sessionPath, {
        inspectOwner: () => "active"
      });
      assert.equal(result.state, "active");
    }

    assert.equal(readFileSync(profile.credentialPath, "utf8"), "saved-local-auth");
    assert.doesNotThrow(() => lstatSync(path.join(profile.sessionPath, "SingletonLock")));
  } finally {
    rmSync(profile.sessionPath, { recursive: true, force: true });
  }
});

test("runtime lock recovery reports intervention without a full-profile deletion path", () => {
  const source = readFileSync(path.join(process.cwd(), "lib", "whatsapp-web.ts"), "utf8");

  assert.match(source, /clearStaleChromiumProfileLocks/);
  assert.match(source, /WHATSAPP_CHROMIUM_PROFILE_LOCK_REQUIRES_INTERVENTION/);
  assert.doesNotMatch(source, /clearChromiumSessionProfile/);
  assert.doesNotMatch(source, /initialize:returned-with-fresh-session/);
});

test("Docker restarts retain the LocalAuth directory on the persistent host mount", () => {
  const runtimeSource = readFileSync(path.join(process.cwd(), "lib", "whatsapp-web.ts"), "utf8");
  const composeSource = readFileSync(path.join(process.cwd(), "docker-compose.stg.yml"), "utf8");

  assert.match(runtimeSource, /path\.join\(process\.cwd\(\), "\.wwebjs_auth"\)/);
  assert.match(composeSource, /\.\/data\/wwebjs_auth:\/app\/\.wwebjs_auth/);
});
