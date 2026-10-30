import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const component = fs.readFileSync("components/whatsapp-authentication-notice.tsx", "utf8");
const shell = fs.readFileSync("components/dashboard-shell.tsx", "utf8");

test("dashboard shell mounts the workspace-wide WhatsApp authentication notice", () => {
  assert.match(shell, /<WhatsAppAuthenticationNotice workspaceId=\{agent\.workspaceId\} \/>/);
});

test("authentication notice follows the realtime QR handoff lifecycle", () => {
  assert.match(component, /addEventListener\("whatsapp:connection"/);
  assert.match(component, /event\.connectionStatus === "AUTHENTICATED"/);
  assert.match(component, /QR accepted\. WhatsApp is authenticating…/);
  assert.match(component, /CONNECTED", "READY", "SYNCING_HISTORY/);
  assert.match(component, /AUTH_FAILED", "ERROR", "REAUTH_REQUIRED/);
});

test("authentication notice survives dashboard navigation and verifies the tracked channel", () => {
  assert.match(component, /window\.sessionStorage\.setItem/);
  assert.match(component, /\?channelId=\$\{encodeURIComponent\(trackedChannelId\)\}/);
  assert.match(component, /window\.sessionStorage\.removeItem/);
});
