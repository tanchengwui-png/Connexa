import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const DEFAULT_VARIANTS = "config/whatsapp-performance-variants.json";
const browserVersionCache = new Map();

function getBrowserVersion(browserPath) {
  if (!browserPath) return null;
  if (browserVersionCache.has(browserPath)) return browserVersionCache.get(browserPath);
  const result = spawnSync(browserPath, ["--version"], { encoding: "utf8", timeout: 5000 });
  const version = result.status === 0 ? result.stdout.trim() : null;
  browserVersionCache.set(browserPath, version);
  return version;
}

function parseArgs(argv) {
  const [command = "help", ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index];
    if (!item.startsWith("--")) throw new Error(`Unexpected argument: ${item}`);
    const key = item.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) options[key] = true;
    else {
      options[key] = next;
      index += 1;
    }
  }
  return { command, options };
}

function readJson(file) {
  return JSON.parse(readFileSync(resolve(file), "utf8"));
}

function readKeyValues(text) {
  return Object.fromEntries(
    text
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [key, value, unit] = line.trim().split(/\s+/);
        return [key.replace(/:$/, ""), Number(value) * (unit === "kB" ? 1024 : 1)];
      })
  );
}

async function readHostSnapshot(browserPath = process.env.WHATSAPP_WEB_EXECUTABLE_PATH || process.env.PUPPETEER_EXECUTABLE_PATH) {
  const [memInfoText, vmstatText, loadText, cpuText, processNames] = await Promise.all([
    readFile("/proc/meminfo", "utf8"),
    readFile("/proc/vmstat", "utf8"),
    readFile("/proc/loadavg", "utf8"),
    readFile("/proc/stat", "utf8"),
    readdir("/proc").then((items) => items.filter((item) => /^\d+$/.test(item)))
  ]);
  const mem = readKeyValues(memInfoText);
  const vm = readKeyValues(vmstatText);
  const cpuLine = cpuText.split("\n").find((line) => line.startsWith("cpu "))?.trim().split(/\s+/).slice(1).map(Number) ?? [];
  const chromium = {
    processCount: 0,
    browserOwnerCount: 0,
    rssBytes: 0,
    swapBytes: 0,
    minorPageFaults: 0,
    majorPageFaults: 0,
    cpuUserTicks: 0,
    cpuSystemTicks: 0
  };
  // Read cmdlines in bounded parallel batches. A serial /proc walk can take
  // longer than the sampling interval on Chromium-heavy senders and hide the
  // short resource spikes this monitor is intended to capture.
  for (let offset = 0; offset < processNames.length; offset += 64) {
    const batch = processNames.slice(offset, offset + 64);
    const records = await Promise.all(batch.map(async (pid) => {
      try {
        const processName = (await readFile(`/proc/${pid}/comm`, "utf8")).trim();
        if (!/^(?:chromium|chrome|chrome_crashpad|headless_shell)$/i.test(processName)) return null;
        const [cmdlineBuffer, statusText, statText] = await Promise.all([
          readFile(`/proc/${pid}/cmdline`),
          readFile(`/proc/${pid}/status`, "utf8"),
          readFile(`/proc/${pid}/stat`, "utf8")
        ]);
        return { processName, cmdline: cmdlineBuffer.toString("utf8").replaceAll("\0", " "), statusText, statText };
      } catch {
        // A process may exit between /proc discovery and reads.
        return null;
      }
    }));
    for (const record of records) {
      if (!record) continue;
      const status = readKeyValues(record.statusText);
      const closeParen = record.statText.lastIndexOf(")");
      const fields = record.statText.slice(closeParen + 2).trim().split(/\s+/);
      chromium.processCount += 1;
      if (!record.cmdline.includes("--type=") && record.processName !== "chrome_crashpad") chromium.browserOwnerCount += 1;
      chromium.rssBytes += status.VmRSS || 0;
      chromium.swapBytes += status.VmSwap || 0;
      chromium.minorPageFaults += Number(fields[7] || 0);
      chromium.majorPageFaults += Number(fields[9] || 0);
      chromium.cpuUserTicks += Number(fields[11] || 0);
      chromium.cpuSystemTicks += Number(fields[12] || 0);
    }
  }
  const browserVersion = getBrowserVersion(browserPath);
  const cgroup = {};
  for (const [name, path] of [
    ["memoryCurrentBytes", "/sys/fs/cgroup/memory.current"],
    ["memoryPeakBytes", "/sys/fs/cgroup/memory.peak"],
    ["memorySwapCurrentBytes", "/sys/fs/cgroup/memory.swap.current"]
  ]) {
    try { cgroup[name] = Number((await readFile(path, "utf8")).trim()); } catch { cgroup[name] = null; }
  }
  return {
    at: new Date().toISOString(),
    host: {
      cpuCount: Number(process.env.CONNEXA_BENCHMARK_CPU_COUNT || 0) || (await import("node:os")).cpus().length,
      loadAverage: loadText.trim().split(/\s+/).slice(0, 3).map(Number),
      cpuTicks: cpuLine,
      memoryTotalBytes: mem.MemTotal || 0,
      memoryAvailableBytes: mem.MemAvailable || 0,
      swapTotalBytes: mem.SwapTotal || 0,
      swapFreeBytes: mem.SwapFree || 0,
      swapUsedBytes: Math.max(0, (mem.SwapTotal || 0) - (mem.SwapFree || 0)),
      swapInPages: vm.pswpin || 0,
      swapOutPages: vm.pswpout || 0,
      pageFaults: vm.pgfault || 0,
      majorPageFaults: vm.pgmajfault || 0
    },
    chromium,
    cgroup,
    browser: { executablePath: browserPath || null, version: browserVersion }
  };
}

function validateAuthorization(auth, variantKey, variants) {
  const failures = [];
  const target = auth.target || {};
  const peer = auth.messagingPeer || {};
  const label = String(target.accountLabel || "").trim().toLowerCase();
  if (auth.schemaVersion !== 1) failures.push("authorization schemaVersion must be 1");
  if (!auth.explicitlyAuthorized) failures.push("explicitlyAuthorized must be true");
  if (!auth.disposableAccount) failures.push("disposableAccount must be true");
  if (auth.customerSession !== false) failures.push("customerSession must be false");
  if (!auth.operatorAvailable || !String(auth.operator || "").trim()) failures.push("an approved phone operator must be available");
  if (!String(auth.approvedBy || "").trim()) failures.push("approvedBy is required");
  if (!auth.expiresAt || Date.parse(auth.expiresAt) <= Date.now()) failures.push("authorization is missing or expired");
  if (!target.workspaceId || !target.channelId || !target.primaryPhoneE164) failures.push("target workspace, channel, and primary phone are required");
  if (variants.forbiddenAccountLabels.includes(label)) failures.push(`account label ${label} is forbidden`);
  if (!peer.authorized || !peer.phoneE164) failures.push("a second authorized messaging number is required");
  if (peer.phoneE164 && target.primaryPhoneE164 && peer.phoneE164 === target.primaryPhoneE164) failures.push("primary and peer numbers must differ");
  if (!Array.isArray(auth.approvedVariants) || !auth.approvedVariants.includes(variantKey)) failures.push(`variant ${variantKey} is not approved`);
  if (!Number.isInteger(auth.approvedFreshPairingAttempts) || auth.approvedFreshPairingAttempts < variants.minimumCompletedSamples) {
    failures.push(`at least ${variants.minimumCompletedSamples} fresh attempts must be approved`);
  }
  return failures;
}

async function preflight(options) {
  if (!options.variant || !options.authorization) throw new Error("preflight requires --variant and --authorization");
  const variants = readJson(options.config || DEFAULT_VARIANTS);
  const variant = variants.variants[options.variant];
  if (!variant) throw new Error(`Unknown variant: ${options.variant}`);
  const auth = readJson(options.authorization);
  const snapshot = await readHostSnapshot(options.browser || process.env.WHATSAPP_WEB_EXECUTABLE_PATH || process.env.PUPPETEER_EXECUTABLE_PATH);
  const failures = validateAuthorization(auth, options.variant, variants);
  const minimum = variant.dedicatedSender
    ? variants.isolatedMinimumHost
    : {
        cpuCount: variants.isolatedMinimumHost.cpuCount,
        memoryBytes: variant.minimumMemoryBytes,
        availableMemoryBytes: 0,
        maximumSwapUsedBytes: variant.maximumSwapUsedBytes
      };
  if (snapshot.host.cpuCount < minimum.cpuCount) failures.push(`host has ${snapshot.host.cpuCount} CPUs; ${minimum.cpuCount} required`);
  if (snapshot.host.memoryTotalBytes < minimum.memoryBytes) failures.push("host memory is below the variant requirement");
  if (snapshot.host.memoryAvailableBytes < minimum.availableMemoryBytes) failures.push("available memory is below the isolated-host requirement");
  if (snapshot.host.swapUsedBytes > minimum.maximumSwapUsedBytes) failures.push("swap usage exceeds the variant limit");
  if (variant.dedicatedSender && snapshot.chromium.browserOwnerCount > 0) failures.push("dedicated variant requires zero competing Chromium browser owners before the run");
  const major = Number(snapshot.browser.version?.match(/(?:Chromium|Chrome)\s+(\d+)/)?.[1]);
  if (!snapshot.browser.version) failures.push("configured browser executable could not be versioned");
  else if (major !== variant.browserMajor) failures.push(`browser major ${major} does not match required ${variant.browserMajor}`);
  const configuredUa = process.env.WHATSAPP_WEB_USER_AGENT?.trim() || "";
  if (variant.userAgentMode === "library-default" && configuredUa) failures.push("WHATSAPP_WEB_USER_AGENT must be unset for this variant");
  if (variant.userAgentMode === "aligned" && !configuredUa.includes(`Chrome/${variant.browserMajor}.`)) {
    failures.push(`aligned variant requires a Chrome/${variant.browserMajor}.x user-agent`);
  }
  if (process.env.CONNEXA_BENCHMARK_ALLOW_FRESH_PAIRING !== `AUTHORIZED:${auth.runId}:${options.variant}`) {
    failures.push("fresh-pairing acknowledgement environment value is missing or incorrect");
  }
  const result = { ok: failures.length === 0, variant: options.variant, description: variant.description, failures, snapshot };
  if (options.output) writeFileSync(resolve(options.output), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 2;
}

function percentile(values, probability) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(probability * sorted.length) - 1)];
}

function summarizeMetric(samples, key) {
  const values = samples.map((sample) => sample[key]).filter((value) => Number.isFinite(value));
  return { n: values.length, p50: percentile(values, 0.5), p95: percentile(values, 0.95), min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null };
}

function percentImprovement(baseline, candidate) {
  return Number.isFinite(baseline) && baseline > 0 && Number.isFinite(candidate)
    ? Math.round(((baseline - candidate) / baseline) * 1000) / 10
    : null;
}

function summarize(options) {
  if (!options.input) throw new Error("summarize requires --input");
  const variantsConfig = readJson(options.config || DEFAULT_VARIANTS);
  const input = readJson(options.input);
  const result = { schemaVersion: 1, runId: input.runId, generatedAt: new Date().toISOString(), variants: {}, comparisons: {} };
  for (const key of Object.keys(variantsConfig.variants)) {
    const all = input.variants?.[key] || [];
    const completed = all.filter((sample) => sample.completed === true);
    const failed = all.length - completed.length;
    const reliabilityPass = completed.length > 0 && completed.every((sample) =>
      variantsConfig.requiredReliabilityChecks.every((check) => sample.reliability?.[check] === "pass")
    );
    const stageNames = new Set(completed.flatMap((sample) => Object.keys(sample.stages || {})));
    const resourceNames = new Set(completed.flatMap((sample) => Object.keys(sample.resources || {})));
    result.variants[key] = {
      samples: all.length,
      completed: completed.length,
      failed,
      provisional: completed.length < variantsConfig.minimumCompletedSamples,
      reliabilityPass,
      qrVisibleMs: summarizeMetric(completed, "qrVisibleMs"),
      authenticatedToReadyMs: summarizeMetric(completed, "authenticatedToReadyMs"),
      stages: Object.fromEntries([...stageNames].map((stage) => [stage, summarizeMetric(completed.map((sample) => ({ value: sample.stages?.[stage] })), "value")])),
      resources: Object.fromEntries([...resourceNames].map((resource) => [resource, summarizeMetric(completed.map((sample) => ({ value: sample.resources?.[resource] })), "value")]))
    };
  }
  for (const [candidate, baseline] of [["B", "A"], ["C", "B"], ["D", "C"]]) {
    const base = result.variants[baseline];
    const next = result.variants[candidate];
    result.comparisons[`${candidate}_vs_${baseline}`] = {
      qrP50ImprovementPercent: percentImprovement(base.qrVisibleMs.p50, next.qrVisibleMs.p50),
      qrP95ImprovementPercent: percentImprovement(base.qrVisibleMs.p95, next.qrVisibleMs.p95),
      readyP50ImprovementPercent: percentImprovement(base.authenticatedToReadyMs.p50, next.authenticatedToReadyMs.p50),
      readyP95ImprovementPercent: percentImprovement(base.authenticatedToReadyMs.p95, next.authenticatedToReadyMs.p95),
      eligibleForRecommendation: !next.provisional && next.failed === 0 && next.reliabilityPass
    };
  }
  const output = `${JSON.stringify(result, null, 2)}\n`;
  if (options.output) writeFileSync(resolve(options.output), output);
  else process.stdout.write(output);
}

async function monitor(options) {
  if (!options.output) throw new Error("monitor requires --output");
  const intervalMs = Math.max(250, Number(options["interval-ms"] || 1000));
  const durationMs = Math.max(intervalMs, Number(options["duration-ms"] || 60000));
  const output = resolve(options.output);
  // Version discovery can be slow on a saturated host. Complete it before the
  // sampling window so every requested interval remains observable.
  getBrowserVersion(options.browser || process.env.WHATSAPP_WEB_EXECUTABLE_PATH || process.env.PUPPETEER_EXECUTABLE_PATH);
  const stopAt = Date.now() + durationMs;
  while (Date.now() < stopAt) {
    appendFileSync(output, `${JSON.stringify(await readHostSnapshot(options.browser))}\n`);
    await new Promise((resolveTimer) => setTimeout(resolveTimer, intervalMs));
  }
}

function help() {
  console.log(`Usage:\n  node scripts/whatsapp-performance-benchmark.mjs preflight --variant A --authorization path.json [--browser /path] [--output preflight.json]\n  node scripts/whatsapp-performance-benchmark.mjs monitor --output resources.ndjson [--duration-ms 60000] [--interval-ms 1000]\n  node scripts/whatsapp-performance-benchmark.mjs summarize --input samples.json [--output summary.json]\n\nThe harness never starts, links, unlinks, or destroys a WhatsApp session.`);
}

const { command, options } = parseArgs(process.argv.slice(2));
if (command === "preflight") await preflight(options);
else if (command === "monitor") await monitor(options);
else if (command === "summarize") summarize(options);
else help();
