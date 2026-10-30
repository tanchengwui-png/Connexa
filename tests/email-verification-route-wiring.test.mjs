import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const page = readFileSync(join(repoRoot, "app", "verify-email", "page.tsx"), "utf8");
const route = readFileSync(
  join(repoRoot, "app", "api", "auth", "verify-email", "route.ts"),
  "utf8"
);

test("email verification delegates token consumption and cookie writes to a route handler", () => {
  assert.match(page, /redirect\(`\/api\/auth\/verify-email\?token=/);
  assert.doesNotMatch(page, /createSession|clearSession|verifyEmailToken/);

  assert.match(route, /export async function GET/);
  assert.match(route, /await verifyEmailToken\(token\)/);
  assert.match(route, /await createSession\(\{/);
  assert.doesNotMatch(route, /await clearSession\(\)/);
});

test("email verification redirects to bounded success and error states without exposing tokens", () => {
  for (const status of ["success", "expired", "invalid", "failed"]) {
    assert.match(route, new RegExp(`buildVerificationRedirect\\(\\"${status}\\"\\)`));
  }

  assert.match(page, /verificationStatus === "success"/);
  assert.match(page, /VERIFICATION_ERRORS/);
  assert.doesNotMatch(route, /searchParams\.set\([^,]+,\s*token\)/);
});
