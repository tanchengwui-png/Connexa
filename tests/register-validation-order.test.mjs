import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const source = readFileSync(join(repoRoot, "components", "register-form.tsx"), "utf8");

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

test("register form validates required controls from top to bottom before billing fields", () => {
  const requiredNames = extractRequiredInputNamesInDomOrder();

  assert.deepEqual(requiredNames.slice(0, 8), [
    "name",
    "email",
    "workspaceName",
    "password",
    "confirmPassword",
    "billing_name",
    "billing_phone_number",
    "billing_address_line_1"
  ]);

  assert.equal(firstInvalidControlName(requiredNames, []), "name");
  assert.equal(firstInvalidControlName(requiredNames, ["name"]), "email");
  assert.equal(
    firstInvalidControlName(requiredNames, ["name", "email", "workspaceName", "password", "confirmPassword"]),
    "billing_name"
  );
});

test("register submit handler uses browser form controls in DOM order", () => {
  const inputNames = extractInputNamesInDomOrder();

  assert.ok(
    inputNames.indexOf("name") < inputNames.indexOf("billing_name"),
    "account fields must remain before billing fields in the DOM"
  );
  assert.match(source, /Array\.from\(form\.elements\)\.find/);
  assert.match(source, /element\.willValidate\s*&&\s*!element\.checkValidity\(\)/);
  assert.match(source, /firstInvalidControl\.focus\(\)/);
  assert.match(source, /firstInvalidControl\.reportValidity\(\)/);
  assert.match(source, /if \(firstInvalidControl\)[\s\S]*?return;/);

  const validationIndex = source.indexOf("const firstInvalidControl = findFirstInvalidFormControl(form);");
  const modalOpenIndex = source.indexOf("setConfirmationOpen(true);");
  assert.ok(validationIndex >= 0 && modalOpenIndex > validationIndex, "confirmation modal must open only after DOM validation");
});

test("register confirmation modal gates workspace creation API", () => {
  assert.match(source, /const \[confirmationOpen, setConfirmationOpen\] = useState\(false\)/);
  assert.match(source, /const \[isCreating, setIsCreating\] = useState\(false\)/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /Create this workspace\?/);
  assert.match(source, /You’re about to create \{confirmationWorkspaceName\}/);
  assert.match(source, />\s*Go back\s*</);
  assert.match(source, /cancelButtonRef\.current\?\.focus\(\)/);
  assert.match(source, /event\.key === "Escape"[\s\S]*?closeConfirmation\(\)/);
  assert.match(source, /submitButtonRef\.current\?\.focus\(\)/);
});

test("register API is called only by the modal confirm action once per submission", () => {
  const submitWorkspaceIndex = source.indexOf("async function submitWorkspace");
  const confirmWorkspaceCreationIndex = source.indexOf("async function confirmWorkspaceCreation");
  const fetchIndex = source.indexOf('fetch("/api/auth/register"');
  const handleSubmitIndex = source.indexOf("function handleSubmit");
  const modalOpenIndex = source.indexOf("setConfirmationOpen(true);");

  assert.ok(submitWorkspaceIndex >= 0 && fetchIndex > submitWorkspaceIndex, "registration fetch must live in submitWorkspace");
  assert.ok(
    confirmWorkspaceCreationIndex >= 0 && confirmWorkspaceCreationIndex > handleSubmitIndex,
    "modal confirmation must be separate from form submit"
  );
  assert.ok(modalOpenIndex > handleSubmitIndex && modalOpenIndex < submitWorkspaceIndex);
  assert.match(source, /if \(isCreatingRef\.current\) return;/);
  assert.match(source, /setIsCreating\(true\);[\s\S]*?await submitWorkspace\(formData\)/);
  assert.match(source, /onClick=\{\(\) => void confirmWorkspaceCreation\(\)\}[\s\S]*?type="button"/);
  assert.doesNotMatch(source, /requestSubmit\(/);
});

test("register confirmation covers the viewport and surfaces submission failures", () => {
  assert.match(source, /import \{ createPortal \} from "react-dom"/);
  assert.match(source, /createPortal\(confirmationDialog, document\.body\)/);
  assert.match(source, /pendingRegistrationRef\.current = formData/);
  assert.doesNotMatch(source, /if \(!form\) return;/);
  assert.match(source, /response\.json\(\)\.catch\(\(\) => null\)/);
  assert.match(source, /className="payment-confirmation-error" role="alert"/);
  assert.match(source, /error \? "Try again" : "Create workspace"/);
});

test("register invalid forms return before opening confirmation or calling API", () => {
  const firstInvalidIndex = source.indexOf("if (firstInvalidControl)");
  const firstInvalidReturnIndex = source.indexOf("return;", firstInvalidIndex);
  const modalOpenIndex = source.indexOf("setConfirmationOpen(true);");
  const fetchIndex = source.indexOf('fetch("/api/auth/register"');

  assert.ok(firstInvalidIndex >= 0);
  assert.ok(firstInvalidReturnIndex > firstInvalidIndex);
  assert.ok(modalOpenIndex > firstInvalidReturnIndex, "invalid native form must not open modal");
  assert.ok(fetchIndex > modalOpenIndex, "invalid native form must not call API");
});
