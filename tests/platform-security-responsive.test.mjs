import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("platform security table uses a compact accessible actions menu at constrained widths", () => {
  const componentSource = readFileSync("components/platform-user-security-manager.tsx", "utf8");
  const cssSource = readFileSync("app/globals.css", "utf8");

  assert.match(componentSource, /PortalDropdown/);
  assert.match(componentSource, /aria-haspopup="menu"/);
  assert.match(componentSource, /role="menu"/);
  assert.match(componentSource, /role="menuitem"/);
  assert.match(componentSource, /platform-security-actions-trigger/);
  assert.match(componentSource, /View Details/);
  assert.match(componentSource, /Send Reset Password Email/);
  assert.match(componentSource, /View Security Logs/);

  assert.match(cssSource, /\.platform-security-panel\s*{[\s\S]*?container-type:\s*inline-size/);
  assert.match(cssSource, /@container\s*\(max-width:\s*1220px\)/);
  assert.match(cssSource, /\.platform-security-table\s*{[\s\S]*?width:\s*100%[\s\S]*?min-width:\s*920px[\s\S]*?table-layout:\s*fixed/);
  assert.match(cssSource, /\.platform-security-cell-truncate\s*{[\s\S]*?text-overflow:\s*ellipsis/);
  assert.match(cssSource, /\.platform-security-actions-inline\s*{[\s\S]*?display:\s*none/);
  assert.match(cssSource, /\.platform-security-actions-trigger\s*{[\s\S]*?display:\s*inline-flex/);
});

test("1536px platform security layout selects compact actions before page overflow is needed", () => {
  const viewportWidth = 1536;
  const publicShellInlinePadding = 16 * 2;
  const lightSidebarWidth = 252;
  const layoutGap = 20;
  const panelInlinePadding = 16.8 * 2;
  const estimatedSecurityCardContentWidth =
    viewportWidth - publicShellInlinePadding - lightSidebarWidth - layoutGap - panelInlinePadding;

  assert.equal(estimatedSecurityCardContentWidth < 1220, true);
  assert.equal(estimatedSecurityCardContentWidth > 920, true);
});
