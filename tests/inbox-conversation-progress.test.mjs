import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (...parts) => readFileSync(join(root, ...parts), "utf8");

test("conversation pages include the channel-scoped total", () => {
  const dbConversations = source("lib", "db-conversations.ts");
  const conversations = source("lib", "conversations.ts");

  assert.match(dbConversations, /export async function countConversationRows/);
  assert.match(dbConversations, /COUNT\(\*\)::int AS count/);
  assert.match(dbConversations, /conditions\.push\(`conv\."channelId" = \$\$\{values\.length\}`\)/);
  assert.match(conversations, /countConversationRows\(\{ workspaceId, channelId: input\.channelId \?\? null \}\)/);
  assert.match(conversations, /page: \{[\s\S]*totalCount/);
});

test("the inbox shows loaded progress and automatically requests the next page", () => {
  const queueHeader = source("components", "inbox", "queue-header.tsx");
  const queueWorkbench = source("components", "inbox", "queue-workbench.tsx");

  assert.match(queueHeader, /Showing \$\{loadedCount\} of \$\{totalCount\} conversations/);
  assert.match(queueWorkbench, /new IntersectionObserver/);
  assert.match(queueWorkbench, /entry\?\.isIntersecting/);
  assert.match(queueWorkbench, /onLoadMore\(\)/);
  assert.match(queueWorkbench, /rootMargin: "160px 0px"/);
});
