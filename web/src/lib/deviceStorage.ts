// On-device persistence for the store in the iOS app.
//
// The web build mirrors the store into localStorage, which caps at ~5MB and
// which iOS may evict from a WKWebView under storage pressure. In the app the
// store lives in plain files in the app sandbox instead (Library/, backed up
// with the device, protected by iOS data protection), so the whole training
// archive can stay on the phone and the app doesn't need the network to show
// any of it.
//
// Two properties matter here:
//
//  1. **Split by how often things change.** zustand's persist writes the whole
//     persisted state on every `set`. During a workout that is every rep and
//     every set tick — rewriting years of history each time would be absurd.
//     State is divided into groups, each in its own file, and a group is only
//     re-serialised when one of its top-level values changed identity (the
//     store is immutable, so identity is exactly "changed").
//  2. **Writes are ordered and coalesced per file.** Async writes can finish
//     out of order; a stale snapshot landing last would roll the file back.
//     Each file has one writer: at most one write in flight, and while it runs
//     only the newest pending snapshot is kept.
//
// Health data never reaches this storage — the store's `partialize` allowlist
// omits it, exactly as it does for localStorage on the web.

import type { PersistStorage, StorageValue } from "zustand/middleware";

/** Minimal file API, so tests can substitute an in-memory one. */
export interface FileBackend {
  read(path: string): Promise<string | null>;
  write(path: string, data: string): Promise<void>;
  remove(path: string): Promise<void>;
}

/** Serial, coalescing writer for one file. */
class FileWriter {
  private pending: string | null = null;
  private running: Promise<void> | null = null;

  constructor(
    private backend: FileBackend,
    private path: string
  ) {}

  schedule(data: string) {
    this.pending = data;
    if (!this.running) this.running = this.drain();
  }

  private async drain() {
    try {
      while (this.pending !== null) {
        const data = this.pending;
        this.pending = null;
        try {
          await this.backend.write(this.path, data);
        } catch (err) {
          // Keep running on the in-memory state; the next change retries with
          // a fresh snapshot. Never drop a newer pending write over this one.
          console.error(`[storage] failed to write ${this.path}:`, err);
        }
      }
    } finally {
      this.running = null;
    }
  }

  /** Resolves once everything scheduled so far is on disk (or has failed). */
  async idle() {
    while (this.running) await this.running;
  }

  /** Drop anything not yet written (used when the file is being removed). */
  cancel() {
    this.pending = null;
  }
}

export interface SplitStorage<S> extends PersistStorage<S> {
  /** Wait for every pending write — call when the app is being backgrounded. */
  flush(): Promise<void>;
}

/**
 * A zustand PersistStorage that stores each group of top-level state keys in
 * its own file. Keys not listed in any group go to the "misc" group.
 */
export function createSplitStorage<S extends Record<string, unknown>>(
  backend: FileBackend,
  groups: Record<string, readonly (keyof S & string)[]>
): SplitStorage<S> {
  const groupOf = new Map<string, string>();
  for (const [group, keys] of Object.entries(groups)) for (const k of keys) groupOf.set(k, group);
  const groupFor = (key: string) => groupOf.get(key) ?? "misc";

  const writers = new Map<string, FileWriter>();
  const writer = (path: string) => {
    let w = writers.get(path);
    if (!w) {
      w = new FileWriter(backend, path);
      writers.set(path, w);
    }
    return w;
  };
  const fileName = (name: string, group: string) => `${name}.${group}.json`;
  const allGroups = () => [...new Set([...Object.keys(groups), "misc"])];

  // Last value written per top-level key, compared by identity.
  const lastWritten = new Map<string, unknown>();
  let lastVersion: number | undefined;
  // Reads are async here, so the store can `set` before its saved state has
  // loaded. Persisting that pre-hydration state would overwrite the files with
  // defaults — an empty history — so writes are ignored until the first read
  // has finished. Nothing is lost: hydration replaces those values anyway.
  let loaded = false;

  return {
    async getItem(name) {
      const parts = await Promise.all(
        allGroups().map(async (g) => {
          // A read that *fails* (as opposed to finding no file) propagates:
          // `loaded` then stays false, so this session runs in memory and can
          // never overwrite the saved files with defaults.
          const raw = await backend.read(fileName(name, g));
          if (!raw) return null;
          try {
            return JSON.parse(raw) as StorageValue<Partial<S>>;
          } catch {
            console.error(`[storage] ${fileName(name, g)} is corrupt — ignoring it.`);
            return null;
          }
        })
      );
      const found = parts.filter((p): p is StorageValue<Partial<S>> => !!p);
      loaded = true;
      if (!found.length) return null;
      const state = Object.assign({}, ...found.map((p) => p.state)) as S;
      // Seed the identity cache so the first set after hydration only rewrites
      // the groups that actually changed.
      for (const [k, v] of Object.entries(state)) lastWritten.set(k, v);
      lastVersion = found[0].version;
      return { state, version: lastVersion };
    },

    setItem(name, value) {
      if (!loaded) return;
      const changed = new Set<string>();
      const versionChanged = value.version !== lastVersion;
      for (const [k, v] of Object.entries(value.state)) {
        if (versionChanged || !lastWritten.has(k) || lastWritten.get(k) !== v) changed.add(groupFor(k));
      }
      // A key that disappeared from the state changes its group too.
      for (const k of lastWritten.keys()) if (!(k in value.state)) changed.add(groupFor(k));
      if (!changed.size) return;

      for (const group of changed) {
        const slice: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value.state)) if (groupFor(k) === group) slice[k] = v;
        writer(fileName(name, group)).schedule(JSON.stringify({ state: slice, version: value.version }));
      }
      lastWritten.clear();
      for (const [k, v] of Object.entries(value.state)) lastWritten.set(k, v);
      lastVersion = value.version;
    },

    async removeItem(name) {
      lastWritten.clear();
      lastVersion = undefined;
      await Promise.all(
        allGroups().map(async (g) => {
          const path = fileName(name, g);
          const w = writers.get(path);
          if (w) {
            w.cancel();
            await w.idle();
          }
          await backend.remove(path).catch(() => {});
        })
      );
    },

    async flush() {
      await Promise.all([...writers.values()].map((w) => w.idle()));
    },
  };
}

/** Filesystem's "no such file" (OS-PLUG-FILE-0008), as opposed to a real failure. */
export function isMissingFile(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (e?.code === "OS-PLUG-FILE-0008") return true;
  return /does not exist|no such file|not found/i.test(e?.message ?? String(err));
}

/** Capacitor Filesystem backend, rooted at Library/fitnofat/ in the app sandbox. */
export async function capacitorFileBackend(): Promise<FileBackend> {
  const { Filesystem, Directory, Encoding } = await import("@capacitor/filesystem");
  const at = (path: string) => ({ path: `fitnofat/${path}`, directory: Directory.Library });
  return {
    async read(path) {
      try {
        const res = await Filesystem.readFile({ ...at(path), encoding: Encoding.UTF8 });
        return typeof res.data === "string" ? res.data : null;
      } catch (err) {
        if (isMissingFile(err)) return null; // not written yet
        throw err;
      }
    },
    async write(path, data) {
      await Filesystem.writeFile({ ...at(path), data, encoding: Encoding.UTF8, recursive: true });
    },
    async remove(path) {
      try {
        await Filesystem.deleteFile(at(path));
      } catch {
        /* already absent */
      }
    },
  };
}

/**
 * Lazily wires the Filesystem backend so the plugin is only loaded inside the
 * native shell. Calls made before it resolves are queued behind it.
 */
export function lazyBackend(load: () => Promise<FileBackend>): FileBackend {
  let ready: Promise<FileBackend> | null = null;
  const get = () => (ready ??= load());
  return {
    read: async (p) => (await get()).read(p),
    write: async (p, d) => (await get()).write(p, d),
    remove: async (p) => (await get()).remove(p),
  };
}
