import assert from "node:assert/strict";
import test from "node:test";
import {
  getHigherWorkspacePackageKeys,
  isWorkspacePackageUpgrade
} from "../lib/workspace-package-upgrades";

test("higher package keys follow the defined upgrade order", () => {
  assert.deepEqual(getHigherWorkspacePackageKeys("starter"), ["professional", "growth", "enterprise"]);
  assert.deepEqual(getHigherWorkspacePackageKeys("professional"), ["growth", "enterprise"]);
  assert.deepEqual(getHigherWorkspacePackageKeys("growth"), ["enterprise"]);
  assert.deepEqual(getHigherWorkspacePackageKeys("enterprise"), []);
});

test("trial uses starter as its baseline package for upgrades", () => {
  assert.deepEqual(getHigherWorkspacePackageKeys("trial"), ["professional", "growth", "enterprise"]);
});

test("upgrade validation rejects same-plan and downgrade requests", () => {
  assert.equal(isWorkspacePackageUpgrade("starter", "starter"), false);
  assert.equal(isWorkspacePackageUpgrade("growth", "professional"), false);
  assert.equal(isWorkspacePackageUpgrade("trial", "professional"), true);
});
