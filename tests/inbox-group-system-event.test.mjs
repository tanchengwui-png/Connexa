import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("group notifications render as neutral timeline events instead of sent messages", () => {
  const threadPanel = readFileSync(
    join(process.cwd(), "components", "inbox", "thread-panel.tsx"),
    "utf8"
  );
  const inboxMapper = readFileSync(join(process.cwd(), "lib", "inbox.ts"), "utf8");

  assert.match(threadPanel, /if \(message\.isSystemEvent\)/);
  assert.match(threadPanel, /id: `event-message-\$\{message\.id\}`/);
  assert.match(inboxMapper, /isWhatsAppGroupNotificationPayload\(/);
});
