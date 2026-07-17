import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

const repoRoot = process.cwd();
const panelSource = readFileSync(join(repoRoot, "components", "web-qr-setup-panel.tsx"), "utf8");

test("QR setup panel only resets the linked refresh guard on channel or unlinked transitions", () => {
  assert.match(panelSource, /useEffect\(\(\) => \{\s*lastLinkedRefreshKeyRef\.current = null;\s*\}, \[channelId\]\);/s);
  assert.match(
    panelSource,
    /useEffect\(\(\) => \{\s*if \(shouldRefreshParentForLinkedState\) \{\s*return;\s*\}\s*lastLinkedRefreshKeyRef\.current = null;\s*\}, \[shouldRefreshParentForLinkedState\]\);/s
  );
  assert.doesNotMatch(
    panelSource,
    /useEffect\(\(\) => \{[\s\S]*setIsDisconnecting\(false\);\s*lastLinkedRefreshKeyRef\.current = null;[\s\S]*\}, \[channelId, initialValues\]\);/
  );
});

test("QR setup panel still refreshes parent pages only after linked-state transitions", () => {
  assert.match(
    panelSource,
    /const shouldRefreshParentForLinkedState =\s*hasSelectedChannel &&\s*!isRelinkableError &&\s*\(Boolean\(status\.connectedAt\) \|\|\s*Boolean\(status\.phoneNumber\) \|\|\s*\["AUTHENTICATED", "CONNECTED", "READY", "SYNCING_HISTORY"\]\.includes\(status\.connectionStatus\)\);/s
  );
  assert.match(panelSource, /lastLinkedRefreshKeyRef\.current = refreshKey;\s*router\.refresh\(\);/s);
});
