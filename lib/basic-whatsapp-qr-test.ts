import QRCode from "qrcode";
import whatsappWebJs from "whatsapp-web.js";
import type { Client as WhatsAppClient } from "whatsapp-web.js";

const { Client, NoAuth } = whatsappWebJs;
const BASIC_WHATSAPP_PROTOCOL_TIMEOUT_MS = Math.max(
  120_000,
  Number.parseInt(process.env.WHATSAPP_PROTOCOL_TIMEOUT_MS ?? "240000", 10) || 240_000
);

// Keep this list identical to WHATSAPP_CHROMIUM_ARGS in lib/whatsapp-web.ts.
// This page is a controlled comparison, not a faster/different browser profile.
const BASIC_WHATSAPP_CHROMIUM_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-networking",
  "--disable-component-extensions-with-background-pages",
  "--disable-default-apps",
  "--disable-extensions",
  "--disable-sync",
  "--disable-breakpad",
  "--disable-crash-reporter",
  "--mute-audio",
  "--password-store=basic",
  "--use-mock-keychain"
];

export type BasicWhatsAppTimelineEvent = {
  at: string;
  event: string;
  detail: string | null;
};

export type BasicWhatsAppDiagnostic = {
  at: string;
  kind: "console" | "page_error" | "request_failed" | "http_error" | "websocket_closed" | "websocket_error" | "navigation";
  detail: string;
};

export type BasicWhatsAppQrStatus = {
  state: "idle" | "resetting" | "starting" | "qr" | "authenticating" | "authenticated" | "connected" | "ready" | "failed" | "disconnected" | "ended";
  message: string;
  qrCodeDataUrl: string | null;
  startedAt: string | null;
  qrAt: string | null;
  qrDisappearedAt: string | null;
  scanDetectedAt: string | null;
  authenticatedAt: string | null;
  connectedAt: string | null;
  readyAt: string | null;
  socketState: string | null;
  hasSynced: boolean | null;
  whatsappWebVersion: string | null;
  chromiumVersion: string | null;
  browserUserAgent: string | null;
  timeline: BasicWhatsAppTimelineEvent[];
  diagnostics: BasicWhatsAppDiagnostic[];
  updatedAt: string;
  error: string | null;
};

type BasicCdpSession = {
  send(method: string): Promise<unknown>;
  on(event: string, listener: (payload: Record<string, unknown>) => void): void;
  detach(): Promise<void>;
};

type BasicPuppeteerPage = {
  evaluate<T>(callback: () => T): Promise<T>;
  mainFrame(): unknown;
  createCDPSession(): Promise<BasicCdpSession>;
  on(event: string, listener: (...args: any[]) => void): void;
};

type BasicRuntime = {
  client: WhatsAppClient | null;
  instrumentedPage: BasicPuppeteerPage | null;
  cdpSession: BasicCdpSession | null;
  connectionMonitor: ReturnType<typeof setInterval> | null;
  lastSocketState: string | null;
  generation: number;
  status: BasicWhatsAppQrStatus;
};

declare global {
  // eslint-disable-next-line no-var
  var basicWhatsAppQrTestRuntimes: Map<string, BasicRuntime> | undefined;
  // eslint-disable-next-line no-var
  var basicWhatsAppQrTestOperations: Map<string, Promise<void>> | undefined;
  // eslint-disable-next-line no-var
  var basicWhatsAppQrTestGeneration: number | undefined;
}

const runtimes = global.basicWhatsAppQrTestRuntimes ?? new Map<string, BasicRuntime>();
const operations = global.basicWhatsAppQrTestOperations ?? new Map<string, Promise<void>>();
if (!global.basicWhatsAppQrTestRuntimes) global.basicWhatsAppQrTestRuntimes = runtimes;
if (!global.basicWhatsAppQrTestOperations) global.basicWhatsAppQrTestOperations = operations;
if (global.basicWhatsAppQrTestGeneration === undefined) global.basicWhatsAppQrTestGeneration = 0;

function now() {
  return new Date().toISOString();
}

function emptyStatus(state: BasicWhatsAppQrStatus["state"], message: string): BasicWhatsAppQrStatus {
  return {
    state,
    message,
    qrCodeDataUrl: null,
    startedAt: null,
    qrAt: null,
    qrDisappearedAt: null,
    scanDetectedAt: null,
    authenticatedAt: null,
    connectedAt: null,
    readyAt: null,
    socketState: null,
    hasSynced: null,
    whatsappWebVersion: null,
    chromiumVersion: null,
    browserUserAgent: null,
    timeline: [],
    diagnostics: [],
    updatedAt: now(),
    error: null
  };
}

function updateStatus(runtime: BasicRuntime, patch: Partial<BasicWhatsAppQrStatus>) {
  runtime.status = { ...runtime.status, ...patch, updatedAt: now() };
}

function recordTimeline(runtime: BasicRuntime, event: string, detail: string | null = null, at = now()) {
  const previous = runtime.status.timeline.at(-1);
  if (previous?.event === event && previous.detail === detail) return;
  updateStatus(runtime, {
    timeline: [...runtime.status.timeline, { at, event, detail }].slice(-80)
  });
}

function sanitizeDiagnosticDetail(value: unknown) {
  return String(value ?? "")
    .replace(/https?:\/\/[^\s)]+/gi, "<url>")
    .replace(/\b\d{7,}\b/g, "<number>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function recordDiagnostic(runtime: BasicRuntime, kind: BasicWhatsAppDiagnostic["kind"], value: unknown) {
  const detail = sanitizeDiagnosticDetail(value);
  if (!detail) return;
  const previous = runtime.status.diagnostics.at(-1);
  if (previous?.kind === kind && previous.detail === detail) return;
  updateStatus(runtime, {
    diagnostics: [...runtime.status.diagnostics, { at: now(), kind, detail }].slice(-30)
  });
}

function markScanDetected(runtime: BasicRuntime, source: string) {
  if (runtime.status.scanDetectedAt) return runtime.status.scanDetectedAt;
  const detectedAt = now();
  const keepAdvancedState = ["authenticated", "connected", "ready"].includes(runtime.status.state);
  updateStatus(runtime, {
    ...(keepAdvancedState ? {} : {
      state: "authenticating" as const,
      message: "QR accepted. WhatsApp is authenticating and syncing this linked device…"
    }),
    qrCodeDataUrl: null,
    qrDisappearedAt: runtime.status.qrDisappearedAt ?? detectedAt,
    scanDetectedAt: detectedAt,
    error: null
  });
  recordTimeline(runtime, "qr_disappeared", source, detectedAt);
  recordTimeline(runtime, "scan_detected", source, detectedAt);
  return detectedAt;
}

function isCurrent(workspaceId: string, runtime: BasicRuntime) {
  return runtimes.get(workspaceId) === runtime;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms.`)), timeoutMs);
    })
  ]);
}

async function stopClient(runtime: BasicRuntime, logout: boolean) {
  if (runtime.connectionMonitor) {
    clearInterval(runtime.connectionMonitor);
    runtime.connectionMonitor = null;
  }
  if (runtime.cdpSession) {
    await runtime.cdpSession.detach().catch(() => undefined);
    runtime.cdpSession = null;
  }
  runtime.instrumentedPage = null;
  const client = runtime.client;
  runtime.client = null;
  if (!client) return;
  client.removeAllListeners();
  if (logout) {
    await withTimeout(client.logout(), 2_000).catch(() => undefined);
  }
  await withTimeout(client.destroy(), 1_000).catch(() => {
    const browserProcess = (
      client as WhatsAppClient & {
        pupBrowser?: { process?: () => { kill: (signal?: string) => unknown } | null };
      }
    ).pupBrowser?.process?.();
    browserProcess?.kill("SIGKILL");
  });
}

function instrumentPage(runtime: BasicRuntime, page: BasicPuppeteerPage) {
  if (runtime.instrumentedPage === page) return;
  runtime.instrumentedPage = page;

  page.on("console", (message: { type(): string; text(): string }) => {
    const type = message.type();
    if (type !== "error" && type !== "warning") return;
    recordDiagnostic(runtime, "console", `${type}: ${message.text()}`);
  });
  page.on("pageerror", (error: Error) => {
    recordDiagnostic(runtime, "page_error", error.message);
  });
  page.on("requestfailed", (request: {
    failure(): { errorText?: string } | null;
    resourceType(): string;
    url(): string;
  }) => {
    let origin = "unknown origin";
    try {
      origin = new URL(request.url()).origin;
    } catch {}
    recordDiagnostic(runtime, "request_failed", `${request.resourceType()} ${origin}: ${request.failure()?.errorText ?? "failed"}`);
  });
  page.on("response", (response: {
    status(): number;
    request(): { resourceType(): string };
    url(): string;
  }) => {
    if (response.status() < 400) return;
    let origin = "unknown origin";
    try {
      origin = new URL(response.url()).origin;
    } catch {}
    recordDiagnostic(runtime, "http_error", `${response.status()} ${response.request().resourceType()} ${origin}`);
  });
  page.on("framenavigated", (frame: unknown) => {
    if (frame !== page.mainFrame()) return;
    recordDiagnostic(runtime, "navigation", "WhatsApp main frame navigated");
    recordTimeline(runtime, "main_frame_navigation");
  });

  void page.createCDPSession().then(async (session) => {
    if (runtime.instrumentedPage !== page) {
      await session.detach().catch(() => undefined);
      return;
    }
    runtime.cdpSession = session;
    session.on("Network.webSocketClosed", () => {
      recordDiagnostic(runtime, "websocket_closed", "A browser WebSocket closed");
    });
    session.on("Network.webSocketFrameError", (payload) => {
      recordDiagnostic(runtime, "websocket_error", payload.errorMessage ?? "Browser WebSocket frame error");
    });
    await session.send("Network.enable");
  }).catch((error) => {
    recordDiagnostic(runtime, "page_error", `CDP diagnostics unavailable: ${error instanceof Error ? error.message : String(error)}`);
  });
}

function createClient(workspaceId: string) {
  global.basicWhatsAppQrTestGeneration = (global.basicWhatsAppQrTestGeneration ?? 0) + 1;
  const runtime: BasicRuntime = {
    client: null,
    instrumentedPage: null,
    cdpSession: null,
    connectionMonitor: null,
    lastSocketState: null,
    generation: global.basicWhatsAppQrTestGeneration,
    status: {
      ...emptyStatus("starting", "Starting one basic Chromium client…"),
      startedAt: now()
    }
  };
  const executablePath =
    process.env.WHATSAPP_WEB_EXECUTABLE_PATH?.trim() ||
    process.env.PUPPETEER_EXECUTABLE_PATH?.trim() ||
    "/usr/bin/chromium";
  const configuredUserAgent = process.env.WHATSAPP_WEB_USER_AGENT?.trim();
  const userAgent = configuredUserAgent?.toLowerCase() === "native"
    // whatsapp-web.js treats a falsy value as "do not override Chromium's UA",
    // although its public TypeScript declaration currently only permits strings.
    ? (false as unknown as string)
    : configuredUserAgent || undefined;
  const client = new Client({
    qrMaxRetries: 0,
    authStrategy: new NoAuth(),
    ...(userAgent === undefined ? {} : { userAgent }),
    puppeteer: {
      headless: true,
      protocolTimeout: BASIC_WHATSAPP_PROTOCOL_TIMEOUT_MS,
      executablePath,
      args: BASIC_WHATSAPP_CHROMIUM_ARGS
    }
  });
  runtime.client = client;
  runtimes.set(workspaceId, runtime);

  let connectionProbeRunning = false;
  runtime.connectionMonitor = setInterval(() => {
    if (connectionProbeRunning || !isCurrent(workspaceId, runtime) || !runtime.client) return;
    connectionProbeRunning = true;
    const instrumentedClient = runtime.client as WhatsAppClient & {
      pupPage?: BasicPuppeteerPage;
      pupBrowser?: { version(): Promise<string> };
    };
    const page = instrumentedClient.pupPage;
    if (!page) {
      connectionProbeRunning = false;
      return;
    }
    instrumentPage(runtime, page);
    if (!runtime.status.chromiumVersion) {
      void instrumentedClient.pupBrowser?.version().then((chromiumVersion) => {
        if (isCurrent(workspaceId, runtime)) updateStatus(runtime, { chromiumVersion });
      }).catch(() => undefined);
    }
    void page.evaluate(() => {
      if (typeof window.require !== "function") return null;
      let socket: { state?: unknown; hasSynced?: unknown } | null = null;
      try {
        socket = window.require("WAWebSocketModel")?.Socket ?? null;
      } catch {
        return null;
      }
      if (!socket) return null;
      return {
        state: String(socket.state ?? ""),
        hasSynced: Boolean(socket.hasSynced),
        helpersReady: typeof (window as unknown as { WWebJS?: unknown }).WWebJS !== "undefined",
        whatsappWebVersion: String((window as unknown as { Debug?: { VERSION?: unknown } }).Debug?.VERSION ?? ""),
        browserUserAgent: navigator.userAgent
      };
    }).then((snapshot) => {
      if (!snapshot || !isCurrent(workspaceId, runtime)) return;
      updateStatus(runtime, {
        socketState: snapshot.state || runtime.status.socketState,
        hasSynced: snapshot.hasSynced,
        whatsappWebVersion: snapshot.whatsappWebVersion || runtime.status.whatsappWebVersion,
        browserUserAgent: snapshot.browserUserAgent || runtime.status.browserUserAgent
      });
      if (snapshot.state && snapshot.state !== runtime.lastSocketState) {
        runtime.lastSocketState = snapshot.state;
        recordTimeline(runtime, "socket_state", snapshot.state);
        if (
          runtime.status.qrAt &&
          !runtime.status.scanDetectedAt &&
          !["OPENING", "UNLAUNCHED", "UNPAIRED", "UNPAIRED_IDLE"].includes(snapshot.state)
        ) {
          markScanDetected(runtime, `socket:${snapshot.state}`);
        }
      }
      if (snapshot.state !== "CONNECTED") return;
      const connectedAt = runtime.status.connectedAt ?? now();
      if (snapshot.hasSynced && snapshot.helpersReady) {
        const readyAt = runtime.status.readyAt ?? now();
        updateStatus(runtime, {
          state: "ready",
          message: "Connected. Basic login is complete.",
          qrCodeDataUrl: null,
          qrDisappearedAt: runtime.status.qrDisappearedAt ?? connectedAt,
          scanDetectedAt: runtime.status.scanDetectedAt ?? connectedAt,
          connectedAt,
          readyAt,
          error: null
        });
        if (!runtime.status.timeline.some((item) => item.event === "ready")) {
          recordTimeline(runtime, "ready", "socket_probe", readyAt);
        }
        if (runtime.connectionMonitor) clearInterval(runtime.connectionMonitor);
        runtime.connectionMonitor = null;
        return;
      }
      updateStatus(runtime, {
        state: "connected",
        message: "Connected to WhatsApp. Finishing client setup in the background…",
        qrCodeDataUrl: null,
        qrDisappearedAt: runtime.status.qrDisappearedAt ?? connectedAt,
        scanDetectedAt: runtime.status.scanDetectedAt ?? connectedAt,
        connectedAt,
        error: null
      });
    }).catch(() => undefined).finally(() => {
      connectionProbeRunning = false;
    });
  }, 1_000);
  runtime.connectionMonitor.unref?.();

  client.on("qr", (qr: string) => {
    void QRCode.toDataURL(qr, { errorCorrectionLevel: "M", margin: 2, width: 360 }).then((qrCodeDataUrl) => {
      if (!isCurrent(workspaceId, runtime)) return;
      updateStatus(runtime, {
        state: "qr",
        message: "QR ready. Scan it from WhatsApp Linked Devices.",
        qrCodeDataUrl,
        qrAt: now(),
        error: null
      });
      recordTimeline(runtime, "qr_generated");
    }).catch((error) => {
      if (!isCurrent(workspaceId, runtime)) return;
      updateStatus(runtime, {
        state: "failed",
        message: "Could not render the QR code.",
        error: error instanceof Error ? error.message : "QR rendering failed."
      });
    });
  });

  client.on("authenticated", () => {
    if (!isCurrent(workspaceId, runtime)) return;
    const scanDetectedAt = markScanDetected(runtime, "authenticated");
    if (["connected", "ready"].includes(runtime.status.state)) {
      const authenticatedAt = runtime.status.authenticatedAt ?? now();
      updateStatus(runtime, { authenticatedAt });
      recordTimeline(runtime, "authenticated", null, authenticatedAt);
      return;
    }
    const authenticatedAt = now();
    updateStatus(runtime, {
      state: "authenticated",
      message: "Connected. WhatsApp accepted the session; final client setup continues in the background.",
      qrCodeDataUrl: null,
      qrDisappearedAt: runtime.status.qrDisappearedAt ?? scanDetectedAt,
      scanDetectedAt: runtime.status.scanDetectedAt ?? scanDetectedAt,
      authenticatedAt,
      error: null
    });
    recordTimeline(runtime, "authenticated", null, authenticatedAt);
  });

  client.on("loading_screen", (percent: number | string) => {
    if (!isCurrent(workspaceId, runtime) || ["connected", "ready"].includes(runtime.status.state)) return;
    const numericPercent = typeof percent === "number" ? percent : Number(percent);
    const progress = Number.isFinite(numericPercent) ? ` (${Math.max(0, Math.min(100, Math.round(numericPercent)))}%)` : "";
    const detectedAt = markScanDetected(runtime, "loading_screen");
    updateStatus(runtime, {
      state: "authenticating",
      message: `QR accepted. Authenticating now${progress}…`,
      qrCodeDataUrl: null,
      qrDisappearedAt: runtime.status.qrDisappearedAt ?? detectedAt,
      scanDetectedAt: runtime.status.scanDetectedAt ?? detectedAt,
      error: null
    });
    if (!runtime.status.timeline.some((item) => item.event === "loading_screen")) {
      recordTimeline(runtime, "loading_screen", progress ? progress.slice(2, -1) : null);
    }
  });

  client.on("ready", () => {
    if (!isCurrent(workspaceId, runtime)) return;
    const readyAt = now();
    updateStatus(runtime, {
      state: "ready",
      message: "Connected. Basic login is complete.",
      qrCodeDataUrl: null,
      connectedAt: runtime.status.connectedAt ?? now(),
      readyAt,
      error: null
    });
    recordTimeline(runtime, "ready", null, readyAt);
  });

  client.on("auth_failure", (message: string) => {
    if (!isCurrent(workspaceId, runtime)) return;
    updateStatus(runtime, {
      state: "failed",
      message: "WhatsApp authentication failed.",
      qrCodeDataUrl: null,
      error: message || "Authentication failed."
    });
  });

  client.on("disconnected", (reason: string) => {
    if (!isCurrent(workspaceId, runtime)) return;
    updateStatus(runtime, {
      state: "disconnected",
      message: "The basic WhatsApp test client disconnected.",
      qrCodeDataUrl: null,
      error: reason || null
    });
  });

  void client.initialize().catch((error) => {
    if (!isCurrent(workspaceId, runtime)) return;
    updateStatus(runtime, {
      state: "failed",
      message: "Chromium could not start the basic WhatsApp test.",
      error: error instanceof Error ? error.message : "Initialization failed."
    });
  });
}

function queueOperation(workspaceId: string, operation: () => Promise<void>) {
  if (operations.has(workspaceId)) return;
  const promise = operation().finally(() => {
    if (operations.get(workspaceId) === promise) operations.delete(workspaceId);
  });
  operations.set(workspaceId, promise);
}

export function startBasicWhatsAppQrTest(workspaceId: string, reset = false) {
  const current = runtimes.get(workspaceId);
  if (!reset && current && !["failed", "disconnected", "ended"].includes(current.status.state)) {
    return getBasicWhatsAppQrTestStatus(workspaceId);
  }

  const placeholder: BasicRuntime = {
    client: null,
    instrumentedPage: null,
    cdpSession: null,
    connectionMonitor: null,
    lastSocketState: null,
    generation: (global.basicWhatsAppQrTestGeneration ?? 0) + 1,
    status: emptyStatus("resetting", reset ? "Ending the previous test session…" : "Starting basic QR test…")
  };
  runtimes.set(workspaceId, placeholder);
  queueOperation(workspaceId, async () => {
    if (current) {
      await stopClient(current, true);
    }
    if (runtimes.get(workspaceId) !== placeholder) return;
    createClient(workspaceId);
  });
  return getBasicWhatsAppQrTestStatus(workspaceId);
}

export function endBasicWhatsAppQrTest(workspaceId: string) {
  const current = runtimes.get(workspaceId);
  const placeholder: BasicRuntime = {
    client: null,
    instrumentedPage: null,
    cdpSession: null,
    connectionMonitor: null,
    lastSocketState: null,
    generation: (global.basicWhatsAppQrTestGeneration ?? 0) + 1,
    status: emptyStatus("ended", "Test session ended. The next start will create a new client.")
  };
  runtimes.set(workspaceId, placeholder);
  queueOperation(workspaceId, async () => {
    if (current) await stopClient(current, true);
  });
  return placeholder.status;
}

export function getBasicWhatsAppQrTestStatus(workspaceId: string): BasicWhatsAppQrStatus {
  return runtimes.get(workspaceId)?.status ?? emptyStatus("idle", "Start the basic QR test when ready.");
}
