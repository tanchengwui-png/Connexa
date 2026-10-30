import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  patchWhatsAppWebBootstrapProfiling,
  patchWhatsAppWebInitializationProfiling,
  patchWhatsAppWebMediaIdCollision,
  patchWhatsAppWebNavigationReinjection
} from "../scripts/patch-whatsapp-web-media-id.mjs";

const vulnerableSource = `
        const message = {
            id: newMsgKey,
            ...mediaOptions,
        };

        // Bot's won't reply if canonicalUrl is set (linking)
`;

test("removes the private media model id before WhatsApp initializes the outgoing message", () => {
  const result = patchWhatsAppWebMediaIdCollision(vulnerableSource);

  assert.equal(result.changed, true);
  assert.match(result.source, /const message = \{[\s\S]*id: newMsgKey[\s\S]*\.\.\.mediaOptions[\s\S]*delete message\.__x_id;/);
});

test("the whatsapp-web media patch is idempotent", () => {
  const first = patchWhatsAppWebMediaIdCollision(vulnerableSource);
  const second = patchWhatsAppWebMediaIdCollision(first.source);

  assert.equal(second.changed, false);
  assert.equal(second.source, first.source);
});

test("adds behavior-neutral initialization and authentication stage diagnostics", () => {
  const installedClient = readFileSync(
    join(process.cwd(), "node_modules", "whatsapp-web.js", "src", "Client.js"),
    "utf8"
  );
  const result = patchWhatsAppWebInitializationProfiling(installedClient);

  assert.match(result.source, /connexa:initialize-stage/);
  assert.match(result.source, /browser-available/);
  assert.match(result.source, /navigation:complete/);
  assert.match(result.source, /connexa:authentication-stage/);
  assert.match(result.source, /listeners-attached/);

  const second = patchWhatsAppWebInitializationProfiling(result.source);
  assert.equal(second.changed, false);
  assert.equal(second.source, result.source);
});

test("adds aggregate bootstrap diagnostics without capturing URLs or QR material", () => {
  const installedClient = readFileSync(
    join(process.cwd(), "node_modules", "whatsapp-web.js", "src", "Client.js"),
    "utf8"
  );
  const result = patchWhatsAppWebBootstrapProfiling(installedClient);

  assert.match(result.source, /connexa:bootstrap-stage/);
  assert.match(result.source, /debug-module:ready/);
  assert.match(result.source, /auth-store:exposed/);
  assert.match(result.source, /websocket-state:ready/);
  assert.match(result.source, /qr-binding:complete/);
  assert.match(result.source, /qr-generation:complete/);
  assert.match(result.source, /__connexaBootstrapPerformance/);
  assert.match(result.source, /longTaskDurationMs/);
  assert.match(result.source, /connexaPerformanceTimer/);
  assert.doesNotMatch(result.source, /connexaCaptureBootstrapPerformance\('qr-received'\)/);
  assert.doesNotMatch(result.source, /name:\s*entry\.name/);

  const second = patchWhatsAppWebBootstrapProfiling(result.source);
  assert.equal(second.changed, false);
  assert.equal(second.source, result.source);
});

test("retries post-scan main-frame injection when WhatsApp destroys the navigation context", () => {
  const vulnerableNavigation = `        this.pupPage.on('framenavigated', async (frame) => {
            if (frame.url().includes('post_logout=1') || this.lastLoggedOut) {
                this.emit(Events.DISCONNECTED, 'LOGOUT');
                await this.authStrategy.logout();
                await this.authStrategy.beforeBrowserInitialized();
                await this.authStrategy.afterBrowserInitialized();
                this.lastLoggedOut = false;
            }
            await this.inject();
        });`;
  const result = patchWhatsAppWebNavigationReinjection(vulnerableNavigation);

  assert.equal(result.changed, true);
  assert.match(result.source, /frame !== this\.pupPage\.mainFrame\(\)/);
  assert.match(result.source, /connexaScheduleReinjection/);
  assert.match(result.source, /const connexaReinjectionRequired =/);
  assert.match(result.source, /typeof window\.AuthStore === 'undefined'/);
  assert.match(result.source, /connexa:reinjection-skipped/);
  assert.match(result.source, /Execution context was destroyed/);
  assert.match(result.source, /connexaReinjectionAttempts < 20/);
  assert.doesNotMatch(result.source, /\n            await this\.inject\(\);\n        \}\);$/);

  const second = patchWhatsAppWebNavigationReinjection(result.source);
  assert.equal(second.changed, false);
  assert.equal(second.source, result.source);
});

test("upgrades the existing reinjection retry patch with a binding guard", () => {
  const installedClient = readFileSync(
    join(process.cwd(), "node_modules", "whatsapp-web.js", "src", "Client.js"),
    "utf8"
  );
  const result = patchWhatsAppWebNavigationReinjection(installedClient);

  assert.match(result.source, /const connexaReinjectionRequired =/);
  assert.match(result.source, /reason: 'bindings-present'/);

  const second = patchWhatsAppWebNavigationReinjection(result.source);
  assert.equal(second.changed, false);
  assert.equal(second.source, result.source);
});

test("dependency installation and the Docker dependency stage apply the patch", () => {
  const root = process.cwd();
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");

  assert.equal(packageJson.scripts.postinstall, "node scripts/patch-whatsapp-web-media-id.mjs");
  assert.match(dockerfile, /COPY scripts\/patch-whatsapp-web-media-id\.mjs \.\/scripts\/patch-whatsapp-web-media-id\.mjs/);
  assert.match(dockerfile, /RUN npm ci --include=dev/);
});
