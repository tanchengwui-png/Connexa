import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const page = readFileSync(join(process.cwd(), "app", "login", "page.tsx"), "utf8");
const form = readFileSync(join(process.cwd(), "components", "login-form.tsx"), "utf8");
const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

test("login card uses the focused welcome hierarchy", () => {
  assert.match(page, /aria-labelledby="login-heading"/);
  assert.match(page, /<h2 id="login-heading">Welcome Back<\/h2>/);
  assert.doesNotMatch(page, /Let&apos;s Get Started/);
});

test("login form preserves its behavior and exposes accessible feedback", () => {
  assert.match(form, /fetch\("\/api\/auth\/login"/);
  assert.match(form, /href="\/forgot-password"/);
  assert.match(form, /required[\s\S]*type="email"/);
  assert.match(form, /aria-live="polite"[\s\S]*role="alert"/);
  assert.match(form, /className="metrica-login-submit-icon"/);
});

test("login refinements remain scoped to the white card content", () => {
  assert.match(css, /\.metrica-login-card \{[\s\S]*align-content: center;/);
  assert.match(css, /\.metrica-login-form \.control-block \{[\s\S]*gap:/);
  assert.match(css, /\.metrica-login-input-shell:focus-within \{[\s\S]*box-shadow:/);
  assert.match(css, /\.metrica-login-submit-icon \{/);
});
