import assert from "node:assert/strict";
import test from "node:test";
import { sendSubscriptionExpiryReminderEmails } from "../lib/billing-management";

const now = new Date("2026-07-06T00:00:00.000Z");

function createCandidate(overrides: Partial<{
  subscriptionId: string;
  workspaceId: string;
  workspaceName: string;
  packageCode: string;
  packageName: string;
  status: string;
  subscribedPrice: string | null;
  currency: string | null;
  billingPeriod: string | null;
  startedAt: Date;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  endedAt: Date | null;
  nextBillingAt: Date | null;
  autoRenew: boolean;
  managerId: string | null;
  managerName: string | null;
  managerEmail: string | null;
  managerStatus: string | null;
}> = {}) {
  return {
    subscriptionId: overrides.subscriptionId ?? "sub_1",
    workspaceId: overrides.workspaceId ?? "ws_1",
    workspaceName: overrides.workspaceName ?? "Connexa Workspace",
    packageCode: overrides.packageCode ?? "starter",
    packageName: overrides.packageName ?? "Starter",
    status: overrides.status ?? "TRIAL",
    subscribedPrice: overrides.subscribedPrice ?? "79.00",
    currency: overrides.currency ?? "MYR",
    billingPeriod: overrides.billingPeriod ?? "MONTHLY",
    startedAt: overrides.startedAt ?? new Date("2026-06-20T00:00:00.000Z"),
    trialStartedAt: overrides.trialStartedAt ?? new Date("2026-06-20T00:00:00.000Z"),
    trialEndsAt: overrides.trialEndsAt ?? new Date("2026-07-07T10:00:00.000Z"),
    endedAt: overrides.endedAt ?? null,
    nextBillingAt: overrides.nextBillingAt ?? new Date("2026-07-07T10:00:00.000Z"),
    autoRenew: overrides.autoRenew ?? true,
    managerId: overrides.managerId ?? "agent_1",
    managerName: overrides.managerName ?? "Aisyah",
    managerEmail: overrides.managerEmail ?? "aisyah@connexa.test",
    managerStatus: overrides.managerStatus ?? "ACTIVE"
  };
}

function createDeps() {
  const reserved = new Set<string>();
  const sentPayloads: Array<{
    panelTitle: string;
    recipientEmail: string;
    summaryLines: string[];
    benefits: string[];
    introLine: string;
  }> = [];

  return {
    sentPayloads,
    deps: {
      reserveEventImpl: async ({ eventKey }: { eventKey: string }) => {
        if (reserved.has(eventKey)) {
          return false;
        }
        reserved.add(eventKey);
        return true;
      },
      markSentImpl: async () => undefined,
      releaseEventImpl: async (eventKey: string) => {
        reserved.delete(eventKey);
      },
      resolvePackageImpl: async (packageKey: "starter" | "professional" | "growth" | "enterprise") => ({
        code: packageKey,
        name:
          packageKey === "professional"
            ? "Professional"
            : packageKey === "growth"
              ? "Growth"
              : packageKey === "enterprise"
                ? "Enterprise"
                : "Starter",
        priceAmount: packageKey === "growth" ? 149 : 79,
        currency: "MYR",
        billingPeriod: "MONTHLY" as const,
        features:
          packageKey === "growth"
            ? ["Automations", "Hot lead indicators", "Operational dashboards"]
            : ["1 shared inbox", "Basic assignments", "Contact tags", "Quick replies"],
        highlights:
          packageKey === "growth"
            ? ["Lead follow-up ready", "Multi-agent workflow", "Operational visibility"]
            : ["1 manager workspace", "Shared inbox basics", "Fast onboarding"]
      }),
      sendReminderEmailImpl: async (payload: {
        candidate: { recipientEmail: string };
        panelTitle: string;
        summaryLines: string[];
        benefits: string[];
        introLine: string;
      }) => {
        sentPayloads.push({
          panelTitle: payload.panelTitle,
          recipientEmail: payload.candidate.recipientEmail,
          summaryLines: payload.summaryLines,
          benefits: payload.benefits,
          introLine: payload.introLine
        });
      }
    }
  };
}

test("eligible free trial user receives one Starter package reminder email 1 day before expiry", async () => {
  const { deps, sentPayloads } = createDeps();

  const result = await sendSubscriptionExpiryReminderEmails({
    now,
    listCandidatesImpl: async () => [createCandidate()],
    ...deps
  });

  assert.equal(result.sentCount, 1);
  assert.equal(sentPayloads.length, 1);
  assert.equal(sentPayloads[0]?.panelTitle, "Here's what you'll get with Starter");
  assert.equal(sentPayloads[0]?.recipientEmail, "aisyah@connexa.test");
  assert.match(sentPayloads[0]?.introLine ?? "", /free trial expires tomorrow/i);
  assert.ok(sentPayloads[0]?.summaryLines.some((line) => line.includes("Starter price: MYR 79.00")));
  assert.ok(sentPayloads[0]?.benefits.includes("1 shared inbox"));
});

test("eligible paid-plan user receives one plan reminder email 1 day before expiry", async () => {
  const { deps, sentPayloads } = createDeps();

  const result = await sendSubscriptionExpiryReminderEmails({
    now,
    listCandidatesImpl: async () => [
      createCandidate({
        subscriptionId: "sub_2",
        packageCode: "growth",
        packageName: "Growth",
        status: "ACTIVE",
        trialEndsAt: null,
        nextBillingAt: new Date("2026-07-07T12:00:00.000Z"),
        subscribedPrice: "149.00",
        autoRenew: true
      })
    ],
    ...deps
  });

  assert.equal(result.sentCount, 1);
  assert.equal(sentPayloads.length, 1);
  assert.equal(sentPayloads[0]?.panelTitle, "Here's what you'll keep with Growth");
  assert.match(sentPayloads[0]?.introLine ?? "", /renews tomorrow/i);
  assert.ok(sentPayloads[0]?.summaryLines.some((line) => line.includes("Current plan price: MYR 149.00")));
  assert.ok(sentPayloads[0]?.benefits.includes("Automations"));
});

test("second job run sends zero duplicate emails", async () => {
  const { deps, sentPayloads } = createDeps();
  const candidates = [createCandidate({ subscriptionId: "sub_3" })];

  const firstRun = await sendSubscriptionExpiryReminderEmails({
    now,
    listCandidatesImpl: async () => candidates,
    ...deps
  });
  const secondRun = await sendSubscriptionExpiryReminderEmails({
    now,
    listCandidatesImpl: async () => candidates,
    ...deps
  });

  assert.equal(firstRun.sentCount, 1);
  assert.equal(secondRun.sentCount, 0);
  assert.equal(secondRun.duplicateCount, 1);
  assert.equal(sentPayloads.length, 1);
});

test("users expiring in more than 1 day get no email", async () => {
  const { deps, sentPayloads } = createDeps();

  const result = await sendSubscriptionExpiryReminderEmails({
    now,
    listCandidatesImpl: async () => [
      createCandidate({
        subscriptionId: "sub_4",
        trialEndsAt: new Date("2026-07-09T10:00:00.000Z"),
        nextBillingAt: new Date("2026-07-09T10:00:00.000Z")
      })
    ],
    ...deps
  });

  assert.equal(result.sentCount, 0);
  assert.equal(result.skippedCount, 1);
  assert.equal(sentPayloads.length, 0);
});

test("already expired users get no email", async () => {
  const { deps, sentPayloads } = createDeps();

  const result = await sendSubscriptionExpiryReminderEmails({
    now,
    listCandidatesImpl: async () => [
      createCandidate({
        subscriptionId: "sub_5",
        trialEndsAt: new Date("2026-07-05T10:00:00.000Z"),
        nextBillingAt: new Date("2026-07-05T10:00:00.000Z")
      })
    ],
    ...deps
  });

  assert.equal(result.sentCount, 0);
  assert.equal(result.skippedCount, 1);
  assert.equal(sentPayloads.length, 0);
});
