import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = "/srv/recurvos/staging/connexa/repo";
const workspaceSource = readFileSync(path.join(repoRoot, "components/campaigns-workspace.tsx"), "utf8");
const stylesSource = readFileSync(path.join(repoRoot, "app/globals.css"), "utf8");

test("campaign create keeps its title and all existing workflow actions", () => {
  assert.match(workspaceSource, /mode === "create" \? "Create campaign"/);
  assert.match(workspaceSource, /Back to campaigns/);
  assert.match(workspaceSource, /Save draft/);
  assert.match(workspaceSource, /Continue to review/);
  assert.match(workspaceSource, /Continue to final review/);
  assert.match(workspaceSource, /Back to edit/);
  assert.match(workspaceSource, /Launch campaign/);
  assert.match(workspaceSource, /Schedule campaign/);
});

test("campaign create exposes one three-step workflow and compact readiness UI", () => {
  assert.match(workspaceSource, /className="campaigns-stepper"/);
  assert.match(workspaceSource, /audience: launchableCount > 0 \? "Complete" : "Incomplete"/);
  assert.match(workspaceSource, /compose: hasCampaignContent \? "Complete" : "Incomplete"/);
  assert.match(workspaceSource, /review: isReadyForReview \? "Ready" : "Blocked"/);
  assert.match(workspaceSource, /<span>1<\/span>[\s\S]*?<strong>Audience<\/strong>/);
  assert.match(workspaceSource, /<span>2<\/span>[\s\S]*?<strong>Compose<\/strong>/);
  assert.match(workspaceSource, /<span>3<\/span>[\s\S]*?<strong>Review<\/strong>/);
  assert.match(workspaceSource, /Before continuing/);
  assert.match(workspaceSource, /Go to \{item\.step === "audience" \? "Audience" : "Compose"\}/);
  assert.match(workspaceSource, /Eligibility details/);
  assert.doesNotMatch(workspaceSource, /auth-page-hero-panel-label">Launch status/);
  assert.doesNotMatch(workspaceSource, /className="campaigns-stage-metrics"/);
});

test("audience, compose, schedule, media, and API wiring remain functional", () => {
  assert.match(workspaceSource, /onClick=\{selectVisibleContacts\}/);
  assert.match(workspaceSource, /onClick=\{clearVisibleContacts\}/);
  assert.match(workspaceSource, /toggleContactSelection\(contact\.id\)/);
  assert.match(workspaceSource, /Filter contacts by owner/);
  assert.match(workspaceSource, /Filter contacts by tag/);
  assert.match(workspaceSource, /Choose attachment/);
  assert.match(workspaceSource, /Open template picker/);
  assert.match(workspaceSource, /Insert emoji/);
  assert.match(workspaceSource, /Send immediately/);
  assert.match(workspaceSource, /Schedule for later/);
  assert.match(workspaceSource, /MALAYSIA_TIME_ZONE/);
  assert.match(workspaceSource, /fetch\("\/api\/campaigns\/launch"/);
});

test("campaign create layout is content-driven, contained, and header-aware", () => {
  assert.match(
    stylesSource,
    /campaigns-workspace-create \.campaigns-main-grid[\s\S]*grid-template-columns: minmax\(360px, 1\.15fr\) minmax\(340px, 1fr\) minmax\(300px, 0\.78fr\)/
  );
  assert.match(stylesSource, /campaigns-workspace-create \.campaigns-panel[\s\S]*height: auto/);
  assert.match(stylesSource, /campaigns-workspace-create \.campaigns-panel[\s\S]*grid-auto-rows: max-content/);
  assert.match(stylesSource, /top: calc\(var\(--app-header-height, 7rem\) \+ 12px\)/);
  assert.doesNotMatch(stylesSource, /\.shell-topbar\s*\{\s*--app-header-height:\s*0px/);
  assert.match(stylesSource, /campaigns-review-status-card[\s\S]*min-height: 0[\s\S]*border: 0/);
  assert.match(stylesSource, /@media \(max-width: 820px\)[\s\S]*campaigns-panel\.is-mobile-active/);
});

test("campaign create keeps hero text and disabled actions readable", () => {
  assert.match(stylesSource, /campaigns-create-hero h1[\s\S]*color: var\(--app-text-primary\)[\s\S]*opacity: 1/);
  assert.match(stylesSource, /campaigns-hero-summary dd[\s\S]*color: var\(--app-text-primary\)[\s\S]*opacity: 1/);
  assert.match(stylesSource, /campaigns-workspace-create \.button:disabled[\s\S]*opacity: 1/);
});

test("campaign name has one controlled source and placeholder is not treated as content", () => {
  assert.match(workspaceSource, /onChange=\{\(event\) => setCampaignName\(event\.target\.value\)\}/);
  assert.match(workspaceSource, /placeholder="Enter a campaign name"[\s\S]*value=\{campaignName\}/);
  assert.match(workspaceSource, /<strong>\{campaignName\.trim\(\) \|\| "Untitled campaign"\}<\/strong>/);
  assert.doesNotMatch(workspaceSource, /placeholder="April re-engagement wave"/);
});

test("campaign recipient rows contain long content and avoid duplicate phone identities", () => {
  assert.match(workspaceSource, /const showSecondaryPhone = !isSamePhoneIdentity\(contact\.displayName, contact\.phone\)/);
  assert.match(workspaceSource, /showSecondaryPhone \? <span>\{contact\.phone\}<\/span> : null/);
  assert.match(workspaceSource, /className="campaigns-contact-channel">WhatsApp<\/span>/);
  assert.match(stylesSource, /campaigns-contact-row[\s\S]*grid-template-columns: 24px 44px minmax\(0, 1fr\)/);
  assert.match(stylesSource, /campaigns-contact-copy p[\s\S]*text-overflow: ellipsis[\s\S]*white-space: nowrap/);
  assert.match(stylesSource, /campaigns-contact-list[\s\S]*overflow-x: hidden[\s\S]*overflow-y: auto/);
});
