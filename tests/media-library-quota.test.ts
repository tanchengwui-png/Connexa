import assert from "node:assert/strict";
import test from "node:test";
import { buildMediaStorageExceededMessage, buildMediaUsageSummary } from "../lib/media-library-quota";

test("buildMediaUsageSummary returns bounded percentage and remaining bytes", () => {
  const summary = buildMediaUsageSummary({
    totalAssets: 4,
    imageCount: 1,
    audioCount: 1,
    videoCount: 1,
    documentCount: 1,
    usedStorageBytes: 90,
    storageLimitBytes: 100,
    hasStorageLimitConfigured: true,
    maxFileBytes: 50
  });

  assert.equal(summary.remainingStorageBytes, 10);
  assert.equal(summary.storageUsagePercentage, 90);
  assert.equal(summary.isStorageUnlimited, false);
});

test("buildMediaUsageSummary handles unlimited storage", () => {
  const summary = buildMediaUsageSummary({
    totalAssets: 0,
    imageCount: 0,
    audioCount: 0,
    videoCount: 0,
    documentCount: 0,
    usedStorageBytes: 1024,
    storageLimitBytes: null,
    hasStorageLimitConfigured: false,
    maxFileBytes: 50
  });

  assert.equal(summary.remainingStorageBytes, null);
  assert.equal(summary.storageUsagePercentage, null);
  assert.equal(summary.isStorageUnlimited, true);
});

test("buildMediaStorageExceededMessage includes used limit and requested bytes", () => {
  assert.equal(
    buildMediaStorageExceededMessage({
      usedStorageBytes: 95,
      storageLimitBytes: 100,
      requestedUploadBytes: 10
    }),
    "Upload failed because this workspace does not have enough Media Library storage. Used: 95 of 100. Selected files: 10."
  );
});
