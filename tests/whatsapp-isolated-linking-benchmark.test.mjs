import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/whatsapp-isolated-linking-benchmark.mjs", "utf8");
const dockerfile = readFileSync("Dockerfile", "utf8");

test("isolated linking benchmark cannot access or persist LocalAuth", () => {
  assert.match(source, /authStrategy: new NoAuth\(\)/);
  assert.doesNotMatch(source, /LocalAuth|wwebjs_auth|WHATSAPP_AUTH_DATA_PATH/);
  assert.match(source, /mkdtemp\(`\$\{tmpdir\(\)\}\/connexa-wa-benchmark-/);
  assert.match(source, /rmSync\(browserProfile, \{ recursive: true, force: true \}\)/);
});

test("isolated linking benchmark fails closed and runs one variant at a time", () => {
  assert.match(source, /disposableAccount must be true/);
  assert.match(source, /customerSession must be false/);
  assert.match(source, /CONNEXA_BENCHMARK_ALLOW_FRESH_PAIRING/);
  assert.match(source, /connexa-wa-isolated-benchmark\.lock/);
  assert.match(source, /Another isolated benchmark is active/);
});

test("matched-browser variants compare only the Chrome 101 override", () => {
  assert.match(source, /chrome101: \{ authorizationKey: "C", userAgent: CHROME_101_USER_AGENT \}/);
  assert.match(source, /native: \{ authorizationKey: "D", userAgent: false \}/);
  assert.match(source, /EXPECTED_BROWSER_VERSION = "146\.0\.7680\.31"/);
  assert.match(dockerfile, /FROM deps-prod AS chrome-for-testing/);
  assert.match(dockerfile, /FROM runtime-browser AS sender[\s\S]*COPY --from=chrome-for-testing \/opt\/puppeteer \/opt\/puppeteer/);
  assert.match(dockerfile, /FROM sender AS whatsapp-benchmark/);
  assert.match(dockerfile, /FROM runtime-browser AS web[\s\S]*COPY --from=chrome-for-testing \/opt\/puppeteer \/opt\/puppeteer/);
  assert.match(dockerfile, /chrome\/linux-146\.0\.7680\.31\/chrome-linux64\/chrome/);
});

test("benchmark reports QR, phone confirmation, authentication, and readiness", () => {
  assert.match(source, /initializeToQrMs/);
  assert.match(source, /qrToPhoneConfirmationMs/);
  assert.match(source, /phoneConfirmationToAuthenticatedMs/);
  assert.match(source, /authenticatedToReadyMs/);
  assert.match(source, /client\.on\("loading_screen"/);
  assert.match(source, /client\.on\("authenticated"/);
  assert.match(source, /client\.on\("ready"/);
});
