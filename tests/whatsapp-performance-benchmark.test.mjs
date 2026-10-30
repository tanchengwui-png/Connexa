import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = process.cwd();
const script = join(root, "scripts", "whatsapp-performance-benchmark.mjs");

test("benchmark preflight fails closed for the example authorization", () => {
  const result = spawnSync(
    process.execPath,
    [
      script,
      "preflight",
      "--variant",
      "A",
      "--authorization",
      join(root, "config", "whatsapp-performance-authorization.example.json"),
      "--browser",
      process.execPath
    ],
    { cwd: root, encoding: "utf8" }
  );

  assert.equal(result.status, 2);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, false);
  assert.ok(output.failures.some((failure) => failure.includes("explicitlyAuthorized")));
  assert.ok(output.failures.some((failure) => failure.includes("second authorized messaging number")));
  assert.ok(output.failures.some((failure) => failure.includes("acknowledgement")));
});

test("benchmark summary calculates nearest-rank percentiles and one-variable comparisons", () => {
  const directory = mkdtempSync(join(tmpdir(), "connexa-wa-benchmark-"));
  const input = join(directory, "samples.json");
  const output = join(directory, "summary.json");
  const reliability = Object.fromEntries([
    "qr_refresh",
    "text_outbound",
    "text_inbound",
    "media_outbound",
    "media_inbound",
    "ack_progression",
    "live_listeners",
    "reconnect",
    "session_restore"
  ].map((key) => [key, "pass"]));
  const sample = (attemptId, qrVisibleMs, authenticatedToReadyMs) => ({
    attemptId,
    completed: true,
    qrVisibleMs,
    authenticatedToReadyMs,
    stages: { navigationMs: qrVisibleMs / 2 },
    resources: { peakRssBytes: qrVisibleMs * 1000 },
    reliability
  });
  writeFileSync(input, JSON.stringify({
    schemaVersion: 1,
    runId: "test-run",
    variants: {
      A: Array.from({ length: 10 }, (_, index) => sample(`a-${index}`, 20_000 + index * 100, 10_000 + index * 100)),
      B: Array.from({ length: 10 }, (_, index) => sample(`b-${index}`, 10_000 + index * 100, 5_000 + index * 100)),
      C: [],
      D: []
    }
  }));

  const result = spawnSync(process.execPath, [script, "summarize", "--input", input, "--output", output], {
    cwd: root,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(readFileSync(output, "utf8"));
  assert.equal(summary.variants.A.qrVisibleMs.p50, 20_400);
  assert.equal(summary.variants.A.qrVisibleMs.p95, 20_900);
  assert.equal(summary.variants.B.reliabilityPass, true);
  assert.equal(summary.variants.A.resources.peakRssBytes.p95, 20_900_000);
  assert.equal(summary.comparisons.B_vs_A.eligibleForRecommendation, true);
  assert.ok(summary.comparisons.B_vs_A.qrP50ImprovementPercent > 45);
});
