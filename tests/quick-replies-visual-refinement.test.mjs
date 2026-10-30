import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const page = readFileSync(join(process.cwd(), "app", "quick-replies", "page.tsx"), "utf8");
const list = readFileSync(join(process.cwd(), "components", "quick-reply-list.tsx"), "utf8");
const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

test("quick replies preserves its two primary creation locations and page heading", () => {
  assert.match(page, /headingAs="h1"/);
  assert.match(page, /Keep the shared reply library clean, searchable, and reusable\./);
  assert.match(page, /href="\/quick-replies\/new"/);
  assert.match(list, /quick-replies-context-create[\s\S]*href="\/quick-replies\/new"/);
  assert.equal((list.match(/href="\/quick-replies\/new"/g) ?? []).length, 1);
  assert.match(list, /No quick replies yet\./);
  assert.match(list, /Create your first saved reply to start building the shared library\./);
});

test("quick reply search and category filtering remain interactive", () => {
  assert.match(list, /setSearchValue\(event\.target\.value\)/);
  assert.match(list, /Clear quick reply search/);
  assert.match(list, /aria-pressed=\{selectedCategory === category\}/);
  assert.match(list, /setSelectedCategory\(category\)/);
});

test("quick reply table preserves columns and adds compact readable values", () => {
  assert.match(list, /<th scope="col">Title<\/th>/);
  assert.match(list, /<th scope="col">Preview<\/th>/);
  assert.match(list, /<th scope="col">Category<\/th>/);
  assert.match(list, /<th scope="col">Shortcut<\/th>/);
  assert.match(list, /<th scope="col">Created<\/th>/);
  assert.match(list, /<th scope="col">Updated<\/th>/);
  assert.match(list, /<th scope="col">Actions<\/th>/);
  assert.match(list, /Media · \{item\.mediaAssetIds\.length\}/);
  assert.match(list, /quick-replies-list-preview/);
  assert.match(list, /No reply content/);
  assert.match(list, /quick-replies-shortcut/);
  assert.match(list, /QuickReplyTimestamp value=\{item\.createdAt\}/);
  assert.match(list, /QuickReplyTimestamp value=\{item\.updatedAt\}/);
});

test("quick reply edit and delete actions remain in the actions column", () => {
  assert.match(list, /href=\{`\/quick-replies\/\$\{item\.id\}\/edit`\}/);
  assert.match(list, /aria-label=\{`Edit \$\{item\.title\}`\}/);
  assert.match(list, /aria-label=\{`Delete \$\{item\.title\}`\}/);
  assert.match(list, /onClick=\{\(\) => void deleteReply\(item\)\}/);
  assert.match(list, /title: `Delete “\$\{reply\.title\}”\?`/);
  assert.match(list, /This will remove \$\{reply\.title\} from the shared library/);
});

test("quick reply layout contains table scrolling and removes metric cards", () => {
  assert.match(css, /\.quick-reply-summary,[\s\S]*\.quick-reply-library,[\s\S]*\.quick-reply-toolbar,[\s\S]*\.quick-reply-table-wrapper,[\s\S]*box-sizing: border-box;/);
  assert.match(css, /\.quick-replies-page \.more-page-intro h1 \{[\s\S]*margin: 0;/);
  assert.match(css, /\.quick-replies-page \.quick-replies-overview-stat \{[\s\S]*border: 0;[\s\S]*background: transparent;[\s\S]*box-shadow: none;/);
  assert.match(css, /\.quick-replies-page \.quick-replies-list-table-shell \{[\s\S]*overflow-x: auto;/);
  assert.match(css, /\.quick-replies-page \.quick-replies-list-preview \{[\s\S]*-webkit-line-clamp: 2;/);
});
