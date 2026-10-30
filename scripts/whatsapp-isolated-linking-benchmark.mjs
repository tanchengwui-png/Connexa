import {
  chmodSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Client, NoAuth } = require("whatsapp-web.js");
const QRCode = require("qrcode");

const CHROME_101_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_0) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/101.0.4951.67 Safari/537.36";
const EXPECTED_BROWSER_VERSION = "146.0.7680.31";
const GLOBAL_LOCK = "/tmp/connexa-wa-isolated-benchmark.lock";
const VARIANTS = {
  chrome101: { authorizationKey: "C", userAgent: CHROME_101_USER_AGENT },
  native: { authorizationKey: "D", userAgent: false }
};

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) throw new Error(`Unexpected argument: ${item}`);
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) options[key] = true;
    else {
      options[key] = next;
      index += 1;
    }
  }
  return options;
}

function safeMessage(value) {
  return String(value ?? "")
    .replace(/https?:\/\/[^\s)]+/gi, "<url>")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "<number>")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "<redacted>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

function readAuthorization(path, variant) {
  const authorization = JSON.parse(readFileSync(resolve(path), "utf8"));
  const failures = [];
  if (authorization.schemaVersion !== 1) failures.push("schemaVersion must be 1");
  if (!authorization.explicitlyAuthorized) failures.push("explicitlyAuthorized must be true");
  if (!authorization.disposableAccount) failures.push("disposableAccount must be true");
  if (authorization.customerSession !== false) failures.push("customerSession must be false");
  if (!authorization.operatorAvailable || !String(authorization.operator || "").trim()) {
    failures.push("an approved phone operator must be available");
  }
  if (!String(authorization.approvedBy || "").trim()) failures.push("approvedBy is required");
  if (!authorization.expiresAt || Date.parse(authorization.expiresAt) <= Date.now()) {
    failures.push("authorization is missing or expired");
  }
  if (!Array.isArray(authorization.approvedVariants) || !authorization.approvedVariants.includes(variant.authorizationKey)) {
    failures.push(`variant ${variant.authorizationKey} is not approved`);
  }
  if (!Number.isInteger(authorization.approvedFreshPairingAttempts) || authorization.approvedFreshPairingAttempts < 1) {
    failures.push("at least one fresh pairing attempt must be approved");
  }
  const acknowledgement = `AUTHORIZED:${authorization.runId}:${variant.authorizationKey}`;
  if (process.env.CONNEXA_BENCHMARK_ALLOW_FRESH_PAIRING !== acknowledgement) {
    failures.push("fresh-pairing acknowledgement is missing or incorrect");
  }
  if (failures.length) throw new Error(`Benchmark authorization failed: ${failures.join("; ")}`);
  return { runId: String(authorization.runId), authorizationKey: variant.authorizationKey };
}

function acquireLock() {
  try {
    const descriptor = openSync(GLOBAL_LOCK, "wx", 0o600);
    writeFileSync(descriptor, `${process.pid}\n`);
    closeSync(descriptor);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const previousPid = Number.parseInt(readFileSync(GLOBAL_LOCK, "utf8").trim(), 10);
    try {
      process.kill(previousPid, 0);
      throw new Error(`Another isolated benchmark is active with pid ${previousPid}.`);
    } catch (probeError) {
      if (probeError?.code !== "ESRCH") throw probeError;
      rmSync(GLOBAL_LOCK, { force: true });
      return acquireLock();
    }
  }
}

function writeJsonAtomic(path, value) {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

function elapsed(from, to) {
  return from && to ? Math.max(0, Date.parse(to) - Date.parse(from)) : null;
}

const options = parseArgs(process.argv.slice(2));
const variant = VARIANTS[options.variant];
if (!variant || !options.authorization || !options["output-dir"]) {
  throw new Error(
    "Usage: --variant chrome101|native --authorization <file> --output-dir <directory> [--timeout-ms 300000]"
  );
}

const authorization = readAuthorization(options.authorization, variant);
const executablePath = resolve(
  options.browser || process.env.WHATSAPP_WEB_EXECUTABLE_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || ""
);
const browserVersion = spawnSync(executablePath, ["--version"], { encoding: "utf8", timeout: 5_000 });
if (browserVersion.status !== 0 || !browserVersion.stdout.includes(EXPECTED_BROWSER_VERSION)) {
  throw new Error(`Expected Chrome ${EXPECTED_BROWSER_VERSION}; configured browser did not match.`);
}

acquireLock();
const outputDirectory = resolve(options["output-dir"]);
mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
chmodSync(outputDirectory, 0o700);
const statusPath = resolve(outputDirectory, "status.json");
const resultPath = resolve(outputDirectory, "result.json");
const qrPath = resolve(outputDirectory, "qr.png");
const browserProfile = await mkdtemp(`${tmpdir()}/connexa-wa-benchmark-`);
const startedAt = new Date().toISOString();
const state = {
  schemaVersion: 1,
  runId: authorization.runId,
  variant: options.variant,
  authorizationKey: authorization.authorizationKey,
  browserVersion: browserVersion.stdout.trim(),
  userAgentMode: options.variant === "chrome101" ? "chrome101-override" : "native-browser",
  state: "starting",
  startedAt,
  qrAt: null,
  phoneConfirmedAt: null,
  phoneConfirmationSource: null,
  authenticatedAt: null,
  readyAt: null,
  disconnectedAt: null,
  disconnectReason: null,
  socketStates: [],
  initializationStages: [],
  bootstrapStages: [],
  diagnostics: []
};

function snapshot() {
  return {
    ...state,
    durations: {
      initializeToQrMs: elapsed(state.startedAt, state.qrAt),
      qrToPhoneConfirmationMs: elapsed(state.qrAt, state.phoneConfirmedAt),
      phoneConfirmationToAuthenticatedMs: elapsed(state.phoneConfirmedAt, state.authenticatedAt),
      authenticatedToReadyMs: elapsed(state.authenticatedAt, state.readyAt),
      initializeToReadyMs: elapsed(state.startedAt, state.readyAt)
    }
  };
}

function persistStatus() {
  writeJsonAtomic(statusPath, snapshot());
}

function recordDiagnostic(kind, detail) {
  state.diagnostics.push({ at: new Date().toISOString(), kind, detail: safeMessage(detail) });
  state.diagnostics = state.diagnostics.slice(-40);
  persistStatus();
}

function markPhoneConfirmation(source) {
  if (state.phoneConfirmedAt) return;
  state.phoneConfirmedAt = new Date().toISOString();
  state.phoneConfirmationSource = source;
  state.state = "phone-confirmed";
  persistStatus();
}

const client = new Client({
  authStrategy: new NoAuth(),
  qrMaxRetries: 0,
  userAgent: variant.userAgent,
  puppeteer: {
    headless: true,
    executablePath,
    userDataDir: browserProfile,
    protocolTimeout: 120_000,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--mute-audio"
    ]
  }
});

let resolveCompletion;
let rejectCompletion;
const completion = new Promise((resolvePromise, rejectPromise) => {
  resolveCompletion = resolvePromise;
  rejectCompletion = rejectPromise;
});

client.on("connexa:initialize-stage", (payload) => {
  state.initializationStages.push({
    stage: String(payload?.stage || "unknown"),
    at: String(payload?.at || new Date().toISOString()),
    elapsedMs: Number.isFinite(payload?.elapsedMs) ? payload.elapsedMs : null,
    stageDurationMs: Number.isFinite(payload?.stageDurationMs) ? payload.stageDurationMs : null
  });
  persistStatus();
});
client.on("connexa:bootstrap-stage", (payload) => {
  state.bootstrapStages.push({
    stage: String(payload?.stage || "unknown"),
    at: String(payload?.at || new Date().toISOString()),
    elapsedMs: Number.isFinite(payload?.elapsedMs) ? payload.elapsedMs : null
  });
  persistStatus();
});
client.on("qr", async (qr) => {
  if (!state.qrAt) state.qrAt = new Date().toISOString();
  state.state = "qr-ready";
  await QRCode.toFile(qrPath, qr, { errorCorrectionLevel: "M", margin: 2, width: 420 });
  chmodSync(qrPath, 0o600);
  persistStatus();
  process.stdout.write(`${JSON.stringify({ event: "qr-ready", at: state.qrAt, qrPath })}\n`);
});
client.on("loading_screen", (percent) => {
  markPhoneConfirmation(`loading_screen:${String(percent)}`);
});
client.on("change_state", (socketState) => {
  const at = new Date().toISOString();
  state.socketStates.push({ at, state: String(socketState) });
  state.socketStates = state.socketStates.slice(-40);
  if (!["OPENING", "UNLAUNCHED", "UNPAIRED", "UNPAIRED_IDLE", "PAIRING"].includes(String(socketState))) {
    markPhoneConfirmation(`socket:${String(socketState)}`);
  }
  persistStatus();
});
client.on("authenticated", () => {
  markPhoneConfirmation("authenticated");
  state.authenticatedAt = state.authenticatedAt || new Date().toISOString();
  state.state = "authenticated";
  persistStatus();
});
client.on("ready", () => {
  state.readyAt = state.readyAt || new Date().toISOString();
  state.state = "ready";
  persistStatus();
  resolveCompletion();
});
client.on("auth_failure", (message) => {
  recordDiagnostic("auth_failure", message);
  rejectCompletion(new Error("WhatsApp authentication failed."));
});
client.on("disconnected", (reason) => {
  state.disconnectedAt = new Date().toISOString();
  state.disconnectReason = safeMessage(reason);
  state.state = "disconnected";
  persistStatus();
  if (!state.readyAt) rejectCompletion(new Error(`Disconnected before ready: ${safeMessage(reason)}`));
});

persistStatus();
const timeoutMs = Math.max(30_000, Number(options["timeout-ms"] || 300_000));
const timeout = setTimeout(() => rejectCompletion(new Error(`Benchmark timed out after ${timeoutMs}ms.`)), timeoutMs);
try {
  void client.initialize().catch(rejectCompletion);
  await completion;
  const finalResult = snapshot();
  writeJsonAtomic(resultPath, finalResult);
  process.stdout.write(`${JSON.stringify({ event: "ready", resultPath, durations: finalResult.durations })}\n`);
} catch (error) {
  state.state = "failed";
  recordDiagnostic("benchmark_failure", error instanceof Error ? error.message : String(error));
  writeJsonAtomic(resultPath, snapshot());
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  await client.destroy().catch(() => undefined);
  rmSync(browserProfile, { recursive: true, force: true });
  rmSync(GLOBAL_LOCK, { force: true });
}
