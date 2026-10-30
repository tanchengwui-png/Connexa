import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PATCH_MARKER = "delete message.__x_id;";
const INSERTION_ANCHOR = "\n        // Bot's won't reply if canonicalUrl is set (linking)";
const QR_REFRESH_VULNERABLE_SOURCE = `                    // refresh qr code
                    window.require('WAWebCmd').Cmd.refreshQR();`;
const QR_REFRESH_PATCHED_SOURCE = `                    // This callback runs in Node through Puppeteer's exposed-function
                    // bridge. Execute the browser-only refresh inside Chromium.
                    await this.pupPage.evaluate(() => {
                        window.require('WAWebCmd').Cmd.refreshQR();
                    });`;
const INITIALIZE_PROFILE_MARKER = "const connexaInitializeStartedAt = Date.now();";
const AUTHENTICATION_PROFILE_MARKER = "'connexa:authentication-stage'";
const BOOTSTRAP_PROFILE_MARKER = "'connexa:bootstrap-stage'";
const BOOTSTRAP_PERFORMANCE_MARKER = "__connexaBootstrapPerformance";
const NAVIGATION_REINJECTION_MARKER = "const connexaScheduleReinjection =";
const NAVIGATION_REINJECTION_GUARD_MARKER = "const connexaReinjectionRequired =";
const NAVIGATION_REINJECTION_WAIT_AND_INJECT = `                    await this.pupPage.waitForFunction(
                        () =>
                            document.readyState === 'complete' &&
                            window.Debug?.VERSION != undefined,
                        { polling: 100, timeout: 10000 },
                    );
                    await this.inject();`;
const NAVIGATION_REINJECTION_GUARDED_WAIT_AND_INJECT = `                    await this.pupPage.waitForFunction(
                        () =>
                            document.readyState === 'complete' &&
                            window.Debug?.VERSION != undefined,
                        { polling: 100, timeout: 10000 },
                    );
                    const connexaReinjectionRequired = await this.pupPage.evaluate(
                        () =>
                            typeof window.AuthStore === 'undefined' ||
                            typeof window.onAppStateHasSyncedEvent !== 'function' ||
                            typeof window.onAuthAppStateChangedEvent !== 'function',
                    );
                    if (!connexaReinjectionRequired) {
                        connexaReinjectionAttempts = 0;
                        this.emit('connexa:reinjection-skipped', {
                            at: new Date().toISOString(),
                            reason: 'bindings-present',
                        });
                        return;
                    }
                    await this.inject();`;
const NAVIGATION_REINJECTION_VULNERABLE_SOURCE = `        this.pupPage.on('framenavigated', async (frame) => {
            if (frame.url().includes('post_logout=1') || this.lastLoggedOut) {
                this.emit(Events.DISCONNECTED, 'LOGOUT');
                await this.authStrategy.logout();
                await this.authStrategy.beforeBrowserInitialized();
                await this.authStrategy.afterBrowserInitialized();
                this.lastLoggedOut = false;
            }
            await this.inject();
        });`;

function replaceRequired(source, anchor, replacement, description) {
  if (!source.includes(anchor)) {
    throw new Error(`Unable to patch whatsapp-web.js ${description} because the expected source was not found.`);
  }
  return source.replace(anchor, replacement);
}

export function patchWhatsAppWebMediaIdCollision(source) {
  if (source.includes(PATCH_MARKER)) {
    return { changed: false, source };
  }

  const hasVulnerableMessageConstruction =
    source.includes("const message = {") &&
    source.includes("id: newMsgKey") &&
    source.includes("...mediaOptions") &&
    source.includes(INSERTION_ANCHOR);

  if (!hasVulnerableMessageConstruction) {
    throw new Error(
      "Unable to patch whatsapp-web.js media sending because the expected sendMessage implementation was not found."
    );
  }

  const patch = [
    "",
    "        // whatsapp-web.js 1.34.7 can leak the media model's private ID into",
    "        // the outgoing message and overwrite its valid MsgKey.",
    `        ${PATCH_MARKER}`,
    ""
  ].join("\n");

  return {
    changed: true,
    source: source.replace(INSERTION_ANCHOR, `${patch}${INSERTION_ANCHOR}`)
  };
}

export function patchWhatsAppWebQrRefreshContext(source) {
  if (source.includes(QR_REFRESH_PATCHED_SOURCE)) {
    return { changed: false, source };
  }

  if (!source.includes(QR_REFRESH_VULNERABLE_SOURCE)) {
    throw new Error(
      "Unable to patch whatsapp-web.js QR refresh because the expected UNPAIRED_IDLE callback was not found."
    );
  }

  return {
    changed: true,
    source: source.replace(QR_REFRESH_VULNERABLE_SOURCE, QR_REFRESH_PATCHED_SOURCE)
  };
}

export function patchWhatsAppWebNavigationReinjection(source) {
  if (source.includes(NAVIGATION_REINJECTION_MARKER)) {
    if (source.includes(NAVIGATION_REINJECTION_GUARD_MARKER)) {
      return { changed: false, source };
    }
    if (!source.includes(NAVIGATION_REINJECTION_WAIT_AND_INJECT)) {
      throw new Error(
        "Unable to guard whatsapp-web.js navigation reinjection because the expected retry block was not found."
      );
    }
    return {
      changed: true,
      source: source.replace(
        NAVIGATION_REINJECTION_WAIT_AND_INJECT,
        NAVIGATION_REINJECTION_GUARDED_WAIT_AND_INJECT
      )
    };
  }

  if (!source.includes(NAVIGATION_REINJECTION_VULNERABLE_SOURCE)) {
    throw new Error(
      "Unable to patch whatsapp-web.js navigation reinjection because the expected frame handler was not found."
    );
  }

  const replacement = `        let connexaReinjectionTimer = null;
        let connexaReinjectionRunning = false;
        let connexaReinjectionAttempts = 0;
        ${NAVIGATION_REINJECTION_MARKER} (delayMs = 250) => {
            if (connexaReinjectionTimer || this.pupPage.isClosed()) return;
            connexaReinjectionTimer = setTimeout(async () => {
                connexaReinjectionTimer = null;
                if (connexaReinjectionRunning || this.pupPage.isClosed()) return;
                connexaReinjectionRunning = true;
                try {
${NAVIGATION_REINJECTION_GUARDED_WAIT_AND_INJECT}
                    connexaReinjectionAttempts = 0;
                    this.emit('connexa:reinjection-ready', {
                        at: new Date().toISOString(),
                    });
                } catch (error) {
                    const message = error instanceof Error
                        ? error.message
                        : String(error);
                    const transient =
                        message.includes('Execution context was destroyed') ||
                        message.includes('Cannot find context with specified id') ||
                        message.includes('Target closed') ||
                        message.includes('detached Frame') ||
                        message.includes('Waiting failed') ||
                        message.includes('auth timeout');
                    if (
                        transient &&
                        !this.pupPage.isClosed() &&
                        connexaReinjectionAttempts < 20
                    ) {
                        connexaReinjectionAttempts += 1;
                        connexaScheduleReinjection(
                            Math.min(2000, 250 * connexaReinjectionAttempts),
                        );
                    } else {
                        this.emit('connexa:reinjection-failure', {
                            at: new Date().toISOString(),
                            message,
                        });
                    }
                } finally {
                    connexaReinjectionRunning = false;
                }
            }, delayMs);
            connexaReinjectionTimer.unref?.();
        };

        this.pupPage.on('framenavigated', async (frame) => {
            if (frame !== this.pupPage.mainFrame()) return;
            if (frame.url().includes('post_logout=1') || this.lastLoggedOut) {
                this.emit(Events.DISCONNECTED, 'LOGOUT');
                await this.authStrategy.logout();
                await this.authStrategy.beforeBrowserInitialized();
                await this.authStrategy.afterBrowserInitialized();
                this.lastLoggedOut = false;
            }
            connexaScheduleReinjection();
        });`;

  return {
    changed: true,
    source: source.replace(NAVIGATION_REINJECTION_VULNERABLE_SOURCE, replacement)
  };
}

export function patchWhatsAppWebInitializationProfiling(source) {
  if (source.includes(INITIALIZE_PROFILE_MARKER) && source.includes(AUTHENTICATION_PROFILE_MARKER)) {
    return { changed: false, source };
  }

  let patched = source;
  patched = replaceRequired(
    patched,
    "        await this.authStrategy.beforeBrowserInitialized();",
    `        ${INITIALIZE_PROFILE_MARKER}\n        let connexaInitializeStageStartedAt = connexaInitializeStartedAt;\n        const connexaEmitInitializeStage = (stage) => {\n            const now = Date.now();\n            this.emit('connexa:initialize-stage', {\n                stage,\n                at: new Date(now).toISOString(),\n                elapsedMs: now - connexaInitializeStartedAt,\n                stageDurationMs: now - connexaInitializeStageStartedAt,\n            });\n            connexaInitializeStageStartedAt = now;\n        };\n        connexaEmitInitializeStage('initialize:start');\n\n        await this.authStrategy.beforeBrowserInitialized();\n        connexaEmitInitializeStage('auth-before-browser:complete');\n        connexaEmitInitializeStage('browser-launch:start');`,
    "initialize start profiling"
  );
  patched = replaceRequired(
    patched,
    "        if (this.options.proxyAuthentication !== undefined) {",
    `        connexaEmitInitializeStage('browser-available');\n\n        if (this.options.proxyAuthentication !== undefined) {`,
    "browser availability profiling"
  );
  patched = replaceRequired(
    patched,
    "        await this.authStrategy.afterBrowserInitialized();\n        await this.initWebVersionCache();",
    `        await this.authStrategy.afterBrowserInitialized();\n        connexaEmitInitializeStage('auth-after-browser:complete');\n        await this.initWebVersionCache();\n        connexaEmitInitializeStage('web-version-cache:complete');`,
    "post-browser profiling"
  );
  patched = replaceRequired(
    patched,
    "        await page.goto(WhatsWebURL, {",
    `        connexaEmitInitializeStage('navigation:start');\n        await page.goto(WhatsWebURL, {`,
    "navigation start profiling"
  );
  patched = replaceRequired(
    patched,
    "        });\n\n        await this.inject();\n\n        this.pupPage.on('framenavigated'",
    `        });\n        connexaEmitInitializeStage('navigation:complete');\n        connexaEmitInitializeStage('inject:start');\n\n        await this.inject();\n        connexaEmitInitializeStage('inject:complete');\n\n        this.pupPage.on('framenavigated'`,
    "navigation and injection profiling"
  );
  patched = replaceRequired(
    patched,
    "                this.emit(Events.AUTHENTICATED, authEventPayload);",
    `                this.emit(Events.AUTHENTICATED, authEventPayload);\n                this.emit('connexa:authentication-stage', {\n                    stage: 'authenticated',\n                    at: new Date().toISOString(),\n                });`,
    "authenticated stage profiling"
  );
  patched = replaceRequired(
    patched,
    "                    await this.pupPage.evaluate(LoadUtils);",
    `                    await this.pupPage.evaluate(LoadUtils);\n                    this.emit('connexa:authentication-stage', {\n                        stage: 'helpers-injected',\n                        at: new Date().toISOString(),\n                    });`,
    "helper injection profiling"
  );
  patched = replaceRequired(
    patched,
    "                    );\n\n                    this.interface = new InterfaceController(this);",
    `                    );\n                    this.emit('connexa:authentication-stage', {\n                        stage: 'account-metadata',\n                        at: new Date().toISOString(),\n                    });\n\n                    this.interface = new InterfaceController(this);`,
    "account metadata profiling"
  );
  patched = replaceRequired(
    patched,
    "                    await this.attachEventListeners();\n                }\n                /**",
    `                    await this.attachEventListeners();\n                    this.emit('connexa:authentication-stage', {\n                        stage: 'listeners-attached',\n                        at: new Date().toISOString(),\n                    });\n                }\n                this.emit('connexa:authentication-stage', {\n                    stage: 'ready-emitting',\n                    at: new Date().toISOString(),\n                });\n                /**`,
    "listener and ready profiling"
  );

  return { changed: true, source: patched };
}

export function patchWhatsAppWebBootstrapProfiling(source) {
  if (source.includes(BOOTSTRAP_PROFILE_MARKER) && source.includes(BOOTSTRAP_PERFORMANCE_MARKER)) {
    if (source.includes("connexaPerformanceTimer")) return { changed: false, source };
    let migrated = replaceRequired(
      source,
      `                            queueMicrotask(() => {\n                                void connexaCaptureBootstrapPerformance('qr-received');\n                            });\n`,
      "",
      "defer bootstrap performance capture until after QR delivery"
    );
    migrated = replaceRequired(
      migrated,
      `        queueMicrotask(() => {\n            void connexaCaptureBootstrapPerformance('bootstrap-complete');\n        });`,
      `        const connexaPerformanceTimer = setTimeout(() => {\n            void connexaCaptureBootstrapPerformance('bootstrap-complete');\n        }, 1000);\n        connexaPerformanceTimer.unref?.();`,
      "delayed bootstrap performance capture"
    );
    return { changed: true, source: migrated };
  }

  let patched = source;
  patched = replaceRequired(
    patched,
    "    async inject() {\n        if (",
    `    async inject() {\n        const connexaBootstrapStartedAt = Date.now();\n        const connexaBootstrapId = \`bootstrap-\${connexaBootstrapStartedAt}-\${Math.random().toString(36).slice(2, 8)}\`;\n        let connexaBootstrapStageStartedAt = connexaBootstrapStartedAt;\n        let connexaInitialQrObserved = false;\n        const connexaEmitBootstrapStage = (stage, metadata = undefined) => {\n            const now = Date.now();\n            this.emit('connexa:bootstrap-stage', {\n                bootstrapId: connexaBootstrapId,\n                stage,\n                at: new Date(now).toISOString(),\n                elapsedMs: now - connexaBootstrapStartedAt,\n                stageDurationMs: now - connexaBootstrapStageStartedAt,\n                metadata,\n            });\n            connexaBootstrapStageStartedAt = now;\n        };\n        const connexaCaptureBootstrapPerformance = async (stage) => {\n            try {\n                const snapshot = await this.pupPage.evaluate(() => {\n                    const resources = performance.getEntriesByType('resource');\n                    const scripts = resources.filter((entry) =>\n                        entry.initiatorType === 'script' ||\n                        (entry.initiatorType === 'link' && entry.name.includes('.js'))\n                    );\n                    const navigation = performance.getEntriesByType('navigation')[0];\n                    const longTasks = window.__connexaBootstrapPerformance || {};\n                    const memory = performance.memory;\n                    return {\n                        navigation: navigation\n                            ? {\n                                durationMs: Math.round(navigation.duration),\n                                ttfbMs: Math.round(navigation.responseStart),\n                                domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd),\n                                loadMs: Math.round(navigation.loadEventEnd),\n                                transferBytes: navigation.transferSize || 0,\n                            }\n                            : null,\n                        resources: {\n                            count: resources.length,\n                            zeroTransferCount: resources.filter((entry) => entry.transferSize === 0).length,\n                            transferBytes: resources.reduce((total, entry) => total + (entry.transferSize || 0), 0),\n                            maxDurationMs: Math.round(Math.max(0, ...resources.map((entry) => entry.duration || 0))),\n                        },\n                        scripts: {\n                            count: scripts.length,\n                            zeroTransferCount: scripts.filter((entry) => entry.transferSize === 0).length,\n                            transferBytes: scripts.reduce((total, entry) => total + (entry.transferSize || 0), 0),\n                            maxDurationMs: Math.round(Math.max(0, ...scripts.map((entry) => entry.duration || 0))),\n                        },\n                        longTasks: {\n                            count: Number(longTasks.longTaskCount || 0),\n                            totalDurationMs: Math.round(Number(longTasks.longTaskDurationMs || 0)),\n                            maxDurationMs: Math.round(Number(longTasks.longTaskMaxDurationMs || 0)),\n                        },\n                        jsHeapUsedBytes: memory ? memory.usedJSHeapSize : null,\n                    };\n                });\n                this.emit('connexa:bootstrap-performance', {\n                    bootstrapId: connexaBootstrapId,\n                    stage,\n                    at: new Date().toISOString(),\n                    elapsedMs: Date.now() - connexaBootstrapStartedAt,\n                    snapshot,\n                });\n            } catch (_) {\n                // Diagnostics must never affect authentication or QR generation.\n            }\n        };\n        connexaEmitBootstrapStage('bootstrap:start');\n\n        if (`,
    "bootstrap profiler initialization"
  );
  patched = replaceRequired(
    patched,
    "        if (!res) {\n            throw 'auth timeout';",
    `        connexaEmitBootstrapStage('debug-module:ready', { ready: res });\n        if (!res) {\n            throw 'auth timeout';`,
    "Debug module readiness profiling"
  );
  patched = replaceRequired(
    patched,
    "        await this.setDeviceName(\n            this.options.deviceName,\n            this.options.browserName,\n        );\n        const pairWithPhoneNumber",
    `        await this.setDeviceName(\n            this.options.deviceName,\n            this.options.browserName,\n        );\n        connexaEmitBootstrapStage('device-name:complete');\n        const pairWithPhoneNumber`,
    "device name profiling"
  );
  patched = replaceRequired(
    patched,
    "        const version = await this.getWWebVersion();\n\n        await this.pupPage.evaluate(ExposeAuthStore);",
    `        const version = await this.getWWebVersion();\n        connexaEmitBootstrapStage('web-version:resolved');\n\n        await this.pupPage.evaluate(ExposeAuthStore);\n        connexaEmitBootstrapStage('auth-store:exposed');`,
    "AuthStore profiling"
  );
  patched = replaceRequired(
    patched,
    "        const needAuthentication = await this.pupPage.evaluate(async () => {",
    `        connexaEmitBootstrapStage('websocket-state:wait-start');\n        const needAuthentication = await this.pupPage.evaluate(async () => {`,
    "WebSocket wait start profiling"
  );
  patched = replaceRequired(
    patched,
    "        });\n\n        if (needAuthentication) {\n            const { failed, failureEventPayload, restart } =",
    `        });\n        const connexaSocketState = await this.pupPage\n            .evaluate(() => window.require('WAWebSocketModel').Socket.state)\n            .catch(() => null);\n        connexaEmitBootstrapStage('websocket-state:ready', {\n            state: typeof connexaSocketState === 'string' ? connexaSocketState : null,\n            needAuthentication,\n        });\n\n        if (needAuthentication) {\n            const { failed, failureEventPayload, restart } =`,
    "WebSocket ready profiling"
  );
  patched = replaceRequired(
    patched,
    "                await this.authStrategy.onAuthenticationNeeded();\n\n            if (failed) {",
    `                await this.authStrategy.onAuthenticationNeeded();\n            connexaEmitBootstrapStage('auth-strategy:complete', { failed, restart });\n\n            if (failed) {`,
    "authentication strategy profiling"
  );
  patched = replaceRequired(
    patched,
    "            } else {\n                let qrRetries = 0;",
    `            } else {\n                connexaEmitBootstrapStage('qr-binding:start');\n                let qrRetries = 0;`,
    "QR binding start profiling"
  );
  patched = replaceRequired(
    patched,
    "                        this.emit(Events.QR_RECEIVED, qr);\n                        if (this.options.qrMaxRetries > 0) {",
    `                        this.emit(Events.QR_RECEIVED, qr);\n                        if (!connexaInitialQrObserved) {\n                            connexaInitialQrObserved = true;\n                            connexaEmitBootstrapStage('qr-received');\n                            queueMicrotask(() => {\n                                void connexaCaptureBootstrapPerformance('qr-received');\n                            });\n                        }\n                        if (this.options.qrMaxRetries > 0) {`,
    "raw QR profiling"
  );
  patched = replaceRequired(
    patched,
    "                );\n\n                await this.pupPage.evaluate(async () => {\n                    const registrationInfo =",
    `                );\n                connexaEmitBootstrapStage('qr-binding:complete');\n                connexaEmitBootstrapStage('qr-generation:start');\n\n                await this.pupPage.evaluate(async () => {\n                    const registrationInfo =`,
    "QR generation start profiling"
  );
  patched = replaceRequired(
    patched,
    "                    }); // future QR changes\n                });\n            }\n        }\n\n        await exposeFunctionIfAbsent(",
    `                    }); // future QR changes\n                });\n                connexaEmitBootstrapStage('qr-generation:complete');\n            }\n        }\n\n        connexaEmitBootstrapStage('core-bindings:start');\n        await exposeFunctionIfAbsent(`,
    "QR generation completion profiling"
  );
  patched = replaceRequired(
    patched,
    "        await this.pupPage.evaluate(() => {\n            window\n                .require('WAWebSocketModel')",
    `        connexaEmitBootstrapStage('core-bindings:complete');\n        connexaEmitBootstrapStage('app-state-listeners:start');\n        await this.pupPage.evaluate(() => {\n            window\n                .require('WAWebSocketModel')`,
    "core binding profiling"
  );
  patched = replaceRequired(
    patched,
    "            });\n        });\n    }\n\n    /**\n     * Sets up events and requirements, kicks off authentication request",
    `            });\n        });\n        connexaEmitBootstrapStage('app-state-listeners:complete');\n        connexaEmitBootstrapStage('bootstrap:complete');\n        queueMicrotask(() => {\n            void connexaCaptureBootstrapPerformance('bootstrap-complete');\n        });\n    }\n\n    /**\n     * Sets up events and requirements, kicks off authentication request`,
    "bootstrap completion profiling"
  );
  patched = replaceRequired(
    patched,
    "        this.pupBrowser = browser;\n        this.pupPage = page;\n\n        await this.authStrategy.afterBrowserInitialized();",
    `        this.pupBrowser = browser;\n        this.pupPage = page;\n\n        await page.evaluateOnNewDocument(() => {\n            window.__connexaBootstrapPerformance = {\n                longTaskCount: 0,\n                longTaskDurationMs: 0,\n                longTaskMaxDurationMs: 0,\n            };\n            try {\n                const observer = new PerformanceObserver((list) => {\n                    const state = window.__connexaBootstrapPerformance;\n                    for (const entry of list.getEntries()) {\n                        state.longTaskCount += 1;\n                        state.longTaskDurationMs += entry.duration || 0;\n                        state.longTaskMaxDurationMs = Math.max(\n                            state.longTaskMaxDurationMs,\n                            entry.duration || 0,\n                        );\n                    }\n                });\n                observer.observe({ type: 'longtask', buffered: true });\n            } catch (_) {\n                // Long-task observation is optional and must not affect startup.\n            }\n        });\n        connexaEmitInitializeStage('performance-observer:installed');\n\n        await this.authStrategy.afterBrowserInitialized();`,
    "long-task observer installation"
  );

  // Keep diagnostic browser work off the QR-paint critical path. Resource and
  // long-task entries remain available after bootstrap, so one delayed snapshot
  // is sufficient and avoids racing the application's QR encoder.
  patched = replaceRequired(
    patched,
    `                            queueMicrotask(() => {\n                                void connexaCaptureBootstrapPerformance('qr-received');\n                            });\n`,
    "",
    "defer bootstrap performance capture until after QR delivery"
  );
  patched = replaceRequired(
    patched,
    `        queueMicrotask(() => {\n            void connexaCaptureBootstrapPerformance('bootstrap-complete');\n        });`,
    `        const connexaPerformanceTimer = setTimeout(() => {\n            void connexaCaptureBootstrapPerformance('bootstrap-complete');\n        }, 1000);\n        connexaPerformanceTimer.unref?.();`,
    "delayed bootstrap performance capture"
  );

  return { changed: true, source: patched };
}

export function patchInstalledWhatsAppWeb(rootDirectory = process.cwd()) {
  const mediaTarget = path.join(
    rootDirectory,
    "node_modules",
    "whatsapp-web.js",
    "src",
    "util",
    "Injected",
    "Utils.js"
  );
  const mediaResult = patchWhatsAppWebMediaIdCollision(readFileSync(mediaTarget, "utf8"));

  if (mediaResult.changed) {
    writeFileSync(mediaTarget, mediaResult.source, "utf8");
    console.log("Patched whatsapp-web.js media message ID collision.");
  } else {
    console.log("whatsapp-web.js media message ID collision patch is already present.");
  }

  const clientTarget = path.join(
    rootDirectory,
    "node_modules",
    "whatsapp-web.js",
    "src",
    "Client.js"
  );
  const qrRefreshResult = patchWhatsAppWebQrRefreshContext(readFileSync(clientTarget, "utf8"));
  const initializationProfileResult = patchWhatsAppWebInitializationProfiling(qrRefreshResult.source);
  const bootstrapProfileResult = patchWhatsAppWebBootstrapProfiling(initializationProfileResult.source);
  const navigationReinjectionResult = patchWhatsAppWebNavigationReinjection(bootstrapProfileResult.source);

  if (
    qrRefreshResult.changed ||
    initializationProfileResult.changed ||
    bootstrapProfileResult.changed ||
    navigationReinjectionResult.changed
  ) {
    writeFileSync(clientTarget, navigationReinjectionResult.source, "utf8");
  }

  if (qrRefreshResult.changed) {
    console.log("Patched whatsapp-web.js UNPAIRED_IDLE QR refresh browser context.");
  } else {
    console.log("whatsapp-web.js UNPAIRED_IDLE QR refresh patch is already present.");
  }

  if (initializationProfileResult.changed) {
    console.log("Patched whatsapp-web.js initialization stage diagnostics.");
  } else {
    console.log("whatsapp-web.js initialization stage diagnostics are already present.");
  }

  if (bootstrapProfileResult.changed) {
    console.log("Patched whatsapp-web.js bootstrap stage diagnostics.");
  } else {
    console.log("whatsapp-web.js bootstrap stage diagnostics are already present.");
  }

  if (navigationReinjectionResult.changed) {
    console.log("Patched whatsapp-web.js post-navigation reinjection recovery.");
  } else {
    console.log("whatsapp-web.js post-navigation reinjection recovery is already present.");
  }

  return (
    mediaResult.changed ||
    qrRefreshResult.changed ||
    initializationProfileResult.changed ||
    bootstrapProfileResult.changed ||
    navigationReinjectionResult.changed
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  patchInstalledWhatsAppWeb();
}
