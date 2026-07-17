import assert from "node:assert/strict";
import test from "node:test";
import { getBrowserPushPermissionState } from "../lib/inbox-browser-notifications-client";

type WindowStub = {
  isSecureContext: boolean;
  location: {
    hostname: string;
  };
};

test("getBrowserPushPermissionState supports secure browsers without PushManager for local desktop notifications", () => {
  const originalWindow = globalThis.window;
  const originalNavigator = globalThis.navigator;
  const originalNotification = globalThis.Notification;
  const originalPushManager = globalThis.PushManager;

  const windowStub: WindowStub = {
    isSecureContext: true,
    location: {
      hostname: "connexa-stg.recurvos.com"
    }
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: windowStub
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      serviceWorker: {}
    }
  });
  Object.defineProperty(globalThis, "Notification", {
    configurable: true,
    value: {
      permission: "default"
    }
  });
  Object.defineProperty(globalThis, "PushManager", {
    configurable: true,
    value: undefined
  });

  try {
    assert.equal(getBrowserPushPermissionState(), "default");
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: originalNavigator
    });
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      value: originalNotification
    });
    Object.defineProperty(globalThis, "PushManager", {
      configurable: true,
      value: originalPushManager
    });
  }
});
