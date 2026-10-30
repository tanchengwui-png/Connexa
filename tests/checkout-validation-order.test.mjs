import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const source = readFileSync(join(repoRoot, "components", "checkout-form.tsx"), "utf8");

function extractInputNamesInDomOrder() {
  return Array.from(source.matchAll(/<input\b[\s\S]*?\/>/g))
    .map((match) => match[0].match(/\bname="([^"]+)"/)?.[1] ?? null)
    .filter(Boolean);
}

function extractRequiredInputNamesInDomOrder() {
  return Array.from(source.matchAll(/<input\b[\s\S]*?\/>/g))
    .filter((match) => /\srequired(?:\s|>)/.test(match[0]))
    .map((match) => match[0].match(/\bname="([^"]+)"/)?.[1] ?? null)
    .filter(Boolean);
}

function firstInvalidControlName(requiredNames, completedNames) {
  const completed = new Set(completedNames);
  return requiredNames.find((name) => !completed.has(name)) ?? null;
}

test("checkout form validates required controls from top to bottom before billing fields", () => {
  const requiredNames = extractRequiredInputNamesInDomOrder();

  assert.deepEqual(requiredNames.slice(0, 8), [
    "name",
    "email",
    "workspace_name",
    "password",
    "confirm_password",
    "billing_name",
    "billing_phone_number",
    "billing_address_line_1"
  ]);

  assert.equal(firstInvalidControlName(requiredNames, []), "name");
  assert.equal(firstInvalidControlName(requiredNames, ["name"]), "email");
  assert.equal(
    firstInvalidControlName(requiredNames, ["name", "email", "workspace_name", "password", "confirm_password"]),
    "billing_name"
  );
});

test("checkout submit handler uses browser form controls before public checkout API", () => {
  const inputNames = extractInputNamesInDomOrder();

  assert.ok(
    inputNames.indexOf("name") < inputNames.indexOf("billing_name"),
    "account fields must remain before billing fields in the DOM"
  );
  assert.match(source, /findFirstInvalidFormControl\(form\)/);
  assert.match(source, /firstInvalidControl\.focus\(\)/);
  assert.match(source, /firstInvalidControl\.reportValidity\(\)/);
  assert.match(source, /if \(firstInvalidControl\)[\s\S]*?return;/);

  const validationIndex = source.indexOf("const firstInvalidControl = findFirstInvalidFormControl(form);");
  const modalOpenIndex = source.indexOf("setConfirmationOpen(true);");
  assert.ok(validationIndex >= 0 && modalOpenIndex > validationIndex, "confirmation modal must open only after DOM validation");
});

test("checkout confirmation modal gates public checkout API", () => {
  assert.match(source, /const \[confirmationOpen, setConfirmationOpen\] = useState\(false\)/);
  assert.match(source, /const \[isCreating, setIsCreating\] = useState\(false\)/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /Continue to payment\?/);
  assert.match(source, /You’re about to create \{confirmationWorkspaceName\} and continue to Billplz payment/);
  assert.match(source, />\s*Go back\s*</);
  assert.match(source, /cancelButtonRef\.current\?\.focus\(\)/);
  assert.match(source, /event\.key === "Escape"[\s\S]*?closeConfirmation\(\)/);
  assert.match(source, /submitButtonRef\.current\?\.focus\(\)/);
});

test("checkout API is called only by the modal confirm action once per submission", () => {
  const submitCheckoutIndex = source.indexOf("async function submitCheckout");
  const confirmCheckoutIndex = source.indexOf("async function confirmCheckout");
  const fetchIndex = source.indexOf('fetch("/api/public/checkout"');
  const handleSubmitIndex = source.indexOf("function handleSubmit");
  const modalOpenIndex = source.indexOf("setConfirmationOpen(true);");

  assert.ok(submitCheckoutIndex >= 0 && fetchIndex > submitCheckoutIndex, "checkout fetch must live in submitCheckout");
  assert.ok(
    confirmCheckoutIndex >= 0 && confirmCheckoutIndex > handleSubmitIndex,
    "modal confirmation must be separate from form submit"
  );
  assert.ok(modalOpenIndex > handleSubmitIndex && modalOpenIndex < submitCheckoutIndex);
  assert.match(source, /if \(isCreating\) return;/);
  assert.match(source, /setIsCreating\(true\);[\s\S]*?await submitCheckout\(new FormData\(form\)\)/);
  assert.match(source, /onClick=\{confirmCheckout\}[\s\S]*?type="button"/);
  assert.doesNotMatch(source, /requestSubmit\(/);
});

test("checkout invalid forms return before opening confirmation or calling API", () => {
  const firstInvalidIndex = source.indexOf("if (firstInvalidControl)");
  const firstInvalidReturnIndex = source.indexOf("return;", firstInvalidIndex);
  const modalOpenIndex = source.indexOf("setConfirmationOpen(true);");
  const fetchIndex = source.indexOf('fetch("/api/public/checkout"');

  assert.ok(firstInvalidIndex >= 0);
  assert.ok(firstInvalidReturnIndex > firstInvalidIndex);
  assert.ok(modalOpenIndex > firstInvalidReturnIndex, "invalid native form must not open modal");
  assert.ok(fetchIndex > modalOpenIndex, "invalid native form must not call API");
});
