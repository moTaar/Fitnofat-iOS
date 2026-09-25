import { describe, expect, it, vi } from "vitest";
import { createSplitStorage, isMissingFile, type FileBackend } from "./deviceStorage";

type State = { history: number[]; active: string | null; settings: { theme: string }; other?: number };

function memoryBackend(delayMs = 0) {
  const files = new Map<string, string>();
  const writes: string[] = [];
  const backend: FileBackend = {
    read: async (p) => files.get(p) ?? null,
    write: async (p, d) => {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      writes.push(p);
      files.set(p, d);
    },
    remove: async (p) => {
      files.delete(p);
    },
  };
  return { backend, files, writes };
}

const GROUPS = { history: ["history"], session: ["active", "settings"] } as const;

async function loaded(backend: FileBackend) {
  const storage = createSplitStorage<State>(backend, GROUPS);
  await storage.getItem("s");
  return storage;
}

describe("createSplitStorage", () => {
  it("round-trips state split across group files", async () => {
    const { backend, files } = memoryBackend();
    const storage = await loaded(backend);
    const state: State = { history: [1, 2], active: "w1", settings: { theme: "dark" }, other: 7 };
    storage.setItem("s", { state, version: 0 });
    await storage.flush();

    expect([...files.keys()].sort()).toEqual(["s.history.json", "s.misc.json", "s.session.json"]);
    const fresh = createSplitStorage<State>(backend, GROUPS);
    expect(await fresh.getItem("s")).toEqual({ state, version: 0 });
  });

  it("only rewrites the group whose values changed", async () => {
    const { backend, writes } = memoryBackend();
    const storage = await loaded(backend);
    const history = [1, 2, 3];
    const settings = { theme: "dark" };
    storage.setItem("s", { state: { history, active: null, settings }, version: 0 });
    await storage.flush();
    writes.length = 0;

    // Mid-workout: only `active` changes, so history must not be re-serialised.
    storage.setItem("s", { state: { history, active: "set 1", settings }, version: 0 });
    storage.setItem("s", { state: { history, active: "set 2", settings }, version: 0 });
    await storage.flush();
    expect(writes.every((p) => p === "s.session.json")).toBe(true);
    expect(writes.length).toBeGreaterThan(0);
  });

  it("writes nothing when nothing changed", async () => {
    const { backend, writes } = memoryBackend();
    const storage = await loaded(backend);
    const state: State = { history: [], active: null, settings: { theme: "dark" } };
    storage.setItem("s", { state, version: 0 });
    await storage.flush();
    writes.length = 0;
    storage.setItem("s", { state: { ...state }, version: 0 });
    await storage.flush();
    expect(writes).toEqual([]);
  });

  it("coalesces rapid writes so the newest snapshot always lands last", async () => {
    const { backend, files, writes } = memoryBackend(5);
    const storage = await loaded(backend);
    const history: number[] = [];
    const settings = { theme: "dark" };
    for (let i = 0; i < 20; i++) {
      storage.setItem("s", { state: { history, active: `rep ${i}`, settings }, version: 0 });
    }
    await storage.flush();
    const saved = JSON.parse(files.get("s.session.json")!);
    expect(saved.state.active).toBe("rep 19");
    // One in flight + the latest pending — not twenty writes.
    expect(writes.filter((p) => p === "s.session.json").length).toBeLessThan(5);
  });

  it("ignores writes that arrive before the saved state has been read", async () => {
    const { backend, files } = memoryBackend();
    files.set("s.history.json", JSON.stringify({ state: { history: [9, 8, 7] }, version: 0 }));
    const storage = createSplitStorage<State>(backend, GROUPS);

    // The store's defaults, persisted before hydration, would wipe history.
    storage.setItem("s", { state: { history: [], active: null, settings: { theme: "dark" } }, version: 0 });
    await storage.flush();
    expect(JSON.parse(files.get("s.history.json")!).state.history).toEqual([9, 8, 7]);

    const got = await storage.getItem("s");
    expect(got?.state.history).toEqual([9, 8, 7]);
  });

  it("stays read-only for the session when a read genuinely fails", async () => {
    const { backend, files } = memoryBackend();
    files.set("s.history.json", JSON.stringify({ state: { history: [1] }, version: 0 }));
    const failing: FileBackend = {
      ...backend,
      read: async () => {
        throw new Error("device locked");
      },
    };
    const storage = createSplitStorage<State>(failing, GROUPS);
    await expect(storage.getItem("s")).rejects.toThrow("device locked");
    storage.setItem("s", { state: { history: [], active: null, settings: { theme: "x" } }, version: 0 });
    await storage.flush();
    expect(JSON.parse(files.get("s.history.json")!).state.history).toEqual([1]);
  });

  it("returns null when nothing has been saved yet", async () => {
    const { backend } = memoryBackend();
    const storage = createSplitStorage<State>(backend, GROUPS);
    expect(await storage.getItem("s")).toBeNull();
  });

  it("skips a corrupt group file instead of failing the whole load", async () => {
    const { backend, files } = memoryBackend();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    files.set("s.history.json", "{not json");
    files.set("s.session.json", JSON.stringify({ state: { active: "w" }, version: 0 }));
    const storage = createSplitStorage<State>(backend, GROUPS);
    expect((await storage.getItem("s"))?.state).toEqual({ active: "w" });
    errors.mockRestore();
  });

  it("removeItem deletes every group file and drops pending writes", async () => {
    const { backend, files } = memoryBackend(5);
    const storage = await loaded(backend);
    storage.setItem("s", { state: { history: [1], active: "a", settings: { theme: "d" } }, version: 0 });
    await storage.removeItem("s");
    await storage.flush();
    expect(files.size).toBe(0);
  });

  it("keeps going after a failed write and lands the next snapshot", async () => {
    const { backend, files } = memoryBackend();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let fail = true;
    const flaky: FileBackend = {
      ...backend,
      write: async (p, d) => {
        if (fail) {
          fail = false;
          throw new Error("disk full");
        }
        return backend.write(p, d);
      },
    };
    const storage = await loaded(flaky);
    const settings = { theme: "d" };
    storage.setItem("s", { state: { history: [], active: "a", settings }, version: 0 });
    await storage.flush();
    storage.setItem("s", { state: { history: [], active: "b", settings }, version: 0 });
    await storage.flush();
    expect(JSON.parse(files.get("s.session.json")!).state.active).toBe("b");
    errors.mockRestore();
  });
});

describe("isMissingFile", () => {
  it("recognises the Filesystem plugin's not-found error", () => {
    expect(isMissingFile({ code: "OS-PLUG-FILE-0008", message: "x" })).toBe(true);
    expect(isMissingFile(new Error("'readFile' failed because file at 'a' does not exist."))).toBe(true);
    expect(isMissingFile(new Error("'readFile' failed with: permission denied"))).toBe(false);
  });
});
