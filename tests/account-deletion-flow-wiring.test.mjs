import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");
const service = read("lib", "account-deletion.ts");
const page = read("app", "account-settings", "billing", "page.tsx");
const component = read("components", "account-billing-manager.tsx");
const migration = read("prisma", "migrations", "20260723143000_explicit_account_deletion_requests", "migration.sql");
const worker = read("app", "api", "internal", "billing", "cleanup", "route.ts");
const whatsappRuntime = read("lib", "whatsapp-web.ts");

test("expiry no longer schedules account deletion and directs the user to plans", () => {
  assert.match(page, /Your subscription has expired\. Please go to the Plans screen to choose a package and renew your subscription\./);
  assert.match(component, /href="#package-management">View Plans/);
  assert.doesNotMatch(page, /Scheduled removal|permanently removed after/);
  assert.doesNotMatch(worker, /cleanupExpiredWorkspaces/);
});

test("explicit confirmation creates one audited, server-timestamped request", () => {
  assert.match(service, /"confirmedAt".*NOW\(\)/s);
  assert.match(service, /FOR UPDATE/);
  assert.match(service, /createUserSecurityAuditLog/);
  assert.match(migration, /DeletionRequest_one_active_action_per_workspace_idx/);
  assert.match(migration, /'delete_all_data', 'delete_account'/);
  assert.match(service, /active\.actionType === "delete_all_data" && active\.status === "completed"/);
  assert.match(service, /SET status = 'confirmed', "completedAt" = NULL/);
});

test("the UI keeps actions separate and confirmation-gated", () => {
  assert.match(component, /Delete All Data/);
  assert.match(component, /Delete Account/);
  assert.match(component, /Confirm Data Deletion/);
  assert.match(component, /Confirm Account Deletion/);
  assert.match(component, /aria-modal="true"/);
  assert.match(component, /disabled=\{pending === deletionAction\}/);
});

test("deleting all data invalidates every linked WhatsApp Web session before data is purged", () => {
  assert.match(service, /await deleteWorkspaceWhatsAppClientSession\(request\.workspaceId\)/);
  assert.match(whatsappRuntime, /await getWorkspaceWhatsAppChannels\(workspaceId\)/);
  assert.match(whatsappRuntime, /teardownRuntimeState\(channel\.id, \{ invalidateSession: true \}\)/);
  assert.match(whatsappRuntime, /await runtime\.client\.logout\(\)\.catch\(\(\) => null\)/);
  assert.match(whatsappRuntime, /await deleteWhatsAppSession\(\{/);
  assert.match(service, /DELETE FROM "Message" WHERE "conversationId" IN/);
  assert.match(service, /DELETE FROM "Conversation" WHERE "workspaceId" = \$1/);
  assert.match(service, /DELETE FROM "WhatsAppMessageEnvelope" WHERE "workspaceId" = \$1/);
  assert.match(service, /DELETE FROM "WhatsAppChannel" WHERE "workspaceId" = \$1/);
});
