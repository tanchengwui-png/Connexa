import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { evaluateCloudSendGate } from "../lib/whatsapp-cloud/billing-gate.ts";
import { WHATSAPP_PROVIDER_CAPABILITIES, isCloudConnectionStatus } from "../lib/whatsapp-cloud/domain.ts";
import {
  getWhatsAppCloudFeatureFlags,
  isWhatsAppCloudEnabledForWorkspace
} from "../lib/whatsapp-cloud/feature-flags.ts";
import {
  buildMetaWebhookIdempotencyKey,
  sha256,
  verifyMetaWebhookSignature
} from "../lib/whatsapp-cloud/security.ts";

const root = new URL("../", import.meta.url);

test("Cloud API feature flags are fail-closed and support a workspace cohort", () => {
  const disabled = getWhatsAppCloudFeatureFlags({});
  assert.equal(disabled.cloudEnabled, false);
  assert.equal(disabled.coexistenceEnabled, false);
  assert.equal(disabled.billingEnabled, false);
  assert.equal(isWhatsAppCloudEnabledForWorkspace("workspace-a", disabled), false);

  const missingCohort = getWhatsAppCloudFeatureFlags({
    WHATSAPP_CLOUD_ENABLED: "true"
  });
  assert.equal(isWhatsAppCloudEnabledForWorkspace("workspace-a", missingCohort), false);

  const cohort = getWhatsAppCloudFeatureFlags({
    WHATSAPP_CLOUD_ENABLED: "true",
    WHATSAPP_COEXISTENCE_ENABLED: "true",
    WHATSAPP_CLOUD_BILLING_ENABLED: "true",
    WHATSAPP_CLOUD_ALLOWED_WORKSPACE_IDS: "workspace-a, workspace-b"
  });
  assert.equal(isWhatsAppCloudEnabledForWorkspace("workspace-a", cohort), true);
  assert.equal(isWhatsAppCloudEnabledForWorkspace("workspace-c", cohort), false);
});

test("direct Meta webhook signatures authenticate the exact raw bytes", () => {
  const appSecret = "test-app-secret";
  const rawBody = Buffer.from('{"entry":[{"id":"pma-1"}]}');
  const signature = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  assert.equal(verifyMetaWebhookSignature({ appSecret, rawBody, signatureHeader: signature }), true);
  assert.equal(
    verifyMetaWebhookSignature({ appSecret, rawBody: Buffer.concat([rawBody, Buffer.from(" ")]), signatureHeader: signature }),
    false
  );
  assert.equal(verifyMetaWebhookSignature({ appSecret, rawBody, signatureHeader: "sha256=bad" }), false);
});

test("webhook idempotency is bound to provider integration identity and event semantics", () => {
  const common = {
    integrationIdentity: "meta-app-1",
    providerEventId: "wamid.1",
    eventType: "status:delivered",
    occurredAt: "2026-10-20T00:00:00.000Z",
    payloadDigest: sha256("payload")
  };
  assert.equal(buildMetaWebhookIdempotencyKey(common), buildMetaWebhookIdempotencyKey(common));
  assert.notEqual(
    buildMetaWebhookIdempotencyKey(common),
    buildMetaWebhookIdempotencyKey({ ...common, integrationIdentity: "meta-app-2" })
  );
  assert.notEqual(
    buildMetaWebhookIdempotencyKey(common),
    buildMetaWebhookIdempotencyKey({ ...common, eventType: "status:read" })
  );
});

const readyGate = {
  cloudEnabled: true,
  billingEnabled: true,
  subscriptionStatus: "ACTIVE",
  connectionStatus: "ACTIVE",
  fundingRoute: "solution_partner_direct",
  fundingVerified: true,
  reservationStatus: "RESERVED",
  reservationExpired: false,
  reservationWorkspaceId: "workspace-a",
  reservationChannelId: "channel-a",
  hasPricingContext: true,
  workspaceId: "workspace-a",
  channelId: "channel-a"
};

test("Cloud outbound requires paid subscription, verified funding, pricing, and scoped reservation", () => {
  assert.equal(evaluateCloudSendGate(readyGate), null);
  assert.equal(evaluateCloudSendGate({ ...readyGate, cloudEnabled: false }), "WHATSAPP_CLOUD_DISABLED");
  assert.equal(
    evaluateCloudSendGate({ ...readyGate, billingEnabled: false }),
    "WHATSAPP_CLOUD_BILLING_DISABLED"
  );
  assert.equal(
    evaluateCloudSendGate({ ...readyGate, subscriptionStatus: "EXPIRED" }),
    "PAID_SUBSCRIPTION_REQUIRED"
  );
  assert.equal(
    evaluateCloudSendGate({ ...readyGate, connectionStatus: "AWAITING_FUNDING" }),
    "WHATSAPP_CLOUD_CONNECTION_NOT_ACTIVE"
  );
  assert.equal(
    evaluateCloudSendGate({ ...readyGate, fundingRoute: "unconfigured" }),
    "FUNDING_NOT_VERIFIED"
  );
  assert.equal(evaluateCloudSendGate({ ...readyGate, fundingVerified: false }), "FUNDING_NOT_VERIFIED");
  assert.equal(
    evaluateCloudSendGate({ ...readyGate, reservationStatus: null }),
    "CLOUD_USAGE_RESERVATION_REQUIRED"
  );
  assert.equal(
    evaluateCloudSendGate({ ...readyGate, reservationExpired: true }),
    "CLOUD_USAGE_RESERVATION_EXPIRED"
  );
  assert.equal(
    evaluateCloudSendGate({ ...readyGate, hasPricingContext: false }),
    "CLOUD_PRICING_CONTEXT_REQUIRED"
  );
  assert.equal(
    evaluateCloudSendGate({ ...readyGate, reservationWorkspaceId: "workspace-b" }),
    "CLOUD_USAGE_RESERVATION_SCOPE_MISMATCH"
  );
  assert.equal(
    evaluateCloudSendGate({ ...readyGate, reservationChannelId: "channel-b" }),
    "CLOUD_USAGE_RESERVATION_SCOPE_MISMATCH"
  );
});

test("provider capabilities keep all three QR meanings separate", () => {
  assert.equal(WHATSAPP_PROVIDER_CAPABILITIES.web.linkedDeviceQr, true);
  assert.equal(WHATSAPP_PROVIDER_CAPABILITIES.cloud_api.linkedDeviceQr, false);
  assert.equal(WHATSAPP_PROVIDER_CAPABILITIES.cloud_api_coexistence.metaHostedCoexistenceQr, true);
  assert.equal(WHATSAPP_PROVIDER_CAPABILITIES.cloud_api.groups, false);
  assert.equal(isCloudConnectionStatus("awaiting_funding"), true);
});

test("webhook verifies raw body before parsing and routes by PMA plus app identity", () => {
  const source = readFileSync(new URL("app/api/webhooks/whatsapp/route.ts", root), "utf8");
  assert.ok(source.indexOf("verifyMetaWebhookSignature") < source.indexOf("JSON.parse(rawBody)"));
  assert.match(source, /integrationIdentity:\s*input\.integrationIdentity\.trim\(\)/);
  assert.match(source, /messagingAccountId:\s*input\.messagingAccountId\.trim\(\)/);
  assert.doesNotMatch(source, /if \(channel\.appSecret &&/);
});

test("Coexistence path cannot call number registration or silently fall back", () => {
  const source = readFileSync(
    new URL("app/api/integrations/meta/embedded-signup/callback/route.ts", root),
    "utf8"
  );
  const coexistenceBranch = source.slice(
    source.indexOf('if (selection.attempt.mode === "coexistence")'),
    source.indexOf("const platformConfig")
  );
  const [coexistenceSide, standardSide] = coexistenceBranch.split("} else {");
  assert.doesNotMatch(coexistenceSide, /registerMetaCloudPhoneNumber/);
  assert.match(standardSide, /confirmRegistration/);
  assert.match(standardSide, /registerMetaCloudPhoneNumber/);
});

test("schema removes global phone uniqueness and preserves Web session fields", () => {
  const schema = readFileSync(new URL("prisma/schema.prisma", root), "utf8");
  assert.doesNotMatch(schema, /phoneNumberId\s+String\?\s+@unique/);
  assert.match(schema, /sessionClientId\s+String\?\s+@unique/);
  assert.match(schema, /model MetaOnboardingAttempt/);
  assert.match(schema, /model TenantFundingAccount/);
  assert.match(schema, /model UsageCreditReservation/);
});

test("disabled Cloud onboarding never disables the existing WhatsApp Web option", () => {
  const source = readFileSync(
    new URL("components/whatsapp-connection-onboarding.tsx", root),
    "utf8"
  );
  const webCards = source.match(
    /badge=\{connectionOptions\.web\.badge\}[\s\S]*?disabled=\{([^}]*)\}/g
  ) ?? [];
  const apiCards = source.match(
    /badge=\{connectionOptions\.api\.badge\}[\s\S]*?disabled=\{([^}]*)\}/g
  ) ?? [];

  assert.ok(webCards.length >= 2);
  assert.ok(apiCards.length >= 2);
  for (const card of webCards) {
    assert.doesNotMatch(card, /metaEmbeddedSignup/);
  }
  for (const card of apiCards) {
    assert.match(card, /!metaEmbeddedSignup\?\.enabled/);
  }
});
