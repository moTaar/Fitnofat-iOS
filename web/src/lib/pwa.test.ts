// Tests for the "a new version is ready" update flow.
//
// The failure modes here are quiet and user-visible: a Reload button that does
// nothing, or an update that never re-offers itself after being dismissed. Both
// leave people stranded on a stale build with no obvious way forward.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupPWA, useUpdateStore } from "./pwa";
import * as stub from "../test/pwa-register-stub";

const reload = vi.fn();

/** The visibilitychange listener pwa.ts installed during registration. */
function visibilityListener(): () => void {
  const addEventListener = document.addEventListener as unknown as ReturnType<typeof vi.fn>;
  const entry = addEventListener.mock.calls.find(
    (call: unknown[]) => call[0] === "visibilitychange"
  );
  if (!entry) throw new Error("no visibilitychange listener was registered");
  return entry[1] as () => void;
}

beforeEach(() => {
  stub.__reset();
  reload.mockClear();
  useUpdateStore.setState({ ready: false, applying: false, snoozed: false });

  // jsdom isn't enabled for this suite, so stand up the globals pwa.ts touches.
  vi.stubGlobal("window", { location: { reload } });
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("document", {
    visibilityState: "visible",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});

describe("update store state transitions", () => {
  it("starts with nothing to offer", () => {
    const s = useUpdateStore.getState();
    expect(s.ready).toBe(false);
    expect(s.snoozed).toBe(false);
    expect(s.applying).toBe(false);
  });

  it("markReady flags an update as available", () => {
    useUpdateStore.getState().markReady();
    expect(useUpdateStore.getState().ready).toBe(true);
  });

  it("snooze hides the banner without discarding the update", () => {
    useUpdateStore.getState().markReady();
    useUpdateStore.getState().snooze();
    const s = useUpdateStore.getState();
    expect(s.snoozed).toBe(true);
    expect(s.ready).toBe(true);
  });

  it("a newer build re-offers itself after an earlier one was dismissed", () => {
    // Without clearing `snoozed`, dismissing once would silently suppress every
    // future update for the life of the tab.
    useUpdateStore.getState().markReady();
    useUpdateStore.getState().snooze();
    expect(useUpdateStore.getState().snoozed).toBe(true);

    useUpdateStore.getState().markReady();
    expect(useUpdateStore.getState().snoozed).toBe(false);
    expect(useUpdateStore.getState().ready).toBe(true);
  });
});

describe("applying an update", () => {
  it("asks the waiting worker to take over, with a reload", async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    stub.__setUpdateImpl(update);
    setupPWA();

    await useUpdateStore.getState().apply();

    expect(update).toHaveBeenCalledWith(true);
    expect(useUpdateStore.getState().applying).toBe(true);
  });

  it("falls back to a plain reload when the worker can't be messaged", async () => {
    // The button must never be a dead end: if SKIP_WAITING fails, reloading
    // still picks up the new build.
    stub.__setUpdateImpl(async () => {
      throw new Error("no controller");
    });
    setupPWA();

    await useUpdateStore.getState().apply();

    expect(reload).toHaveBeenCalled();
  });

  it("reloads even if the service worker never registered", async () => {
    // Before setupPWA() wires up a real updater, Reload must still do something.
    // Needs a pristine module: an earlier setupPWA() in this file has already
    // replaced the module-level default.
    vi.resetModules();
    const fresh = await import("./pwa");
    await fresh.useUpdateStore.getState().apply();
    expect(reload).toHaveBeenCalled();
  });
});

describe("service worker registration", () => {
  it("registers immediately and wires the refresh callback", () => {
    setupPWA();
    expect(stub.lastOptions?.immediate).toBe(true);
    expect(typeof stub.lastOptions?.onNeedRefresh).toBe("function");
  });

  it("onNeedRefresh surfaces the update to the UI", () => {
    setupPWA();
    expect(useUpdateStore.getState().ready).toBe(false);
    stub.lastOptions?.onNeedRefresh?.();
    expect(useUpdateStore.getState().ready).toBe(true);
  });

  it("checks for a newer build when the tab becomes visible", () => {
    const update = vi.fn().mockResolvedValue(undefined);
    setupPWA();
    stub.lastOptions?.onRegisteredSW?.("/sw.js", { update } as never);

    visibilityListener()();

    expect(update).toHaveBeenCalled();
  });

  it("does not poll for updates while offline", () => {
    const update = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { onLine: false });
    setupPWA();
    stub.lastOptions?.onRegisteredSW?.("/sw.js", { update } as never);

    visibilityListener()();

    expect(update).not.toHaveBeenCalled();
  });

  it("survives a registration that reports no registration object", () => {
    setupPWA();
    expect(() => stub.lastOptions?.onRegisteredSW?.("/sw.js", undefined)).not.toThrow();
  });
});
