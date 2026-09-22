// Stand-in for `virtual:pwa-register`, which only exists when vite-plugin-pwa
// is in the build graph. Aliased in for tests (see web/vitest.config.ts) so
// `lib/pwa.ts` can be imported and exercised without the plugin.

type RegisterOptions = {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
  onRegisteredSW?: (swUrl: string, registration?: ServiceWorkerRegistration) => void;
};

/** Captures what the app passed to registerSW, so tests can fire the callbacks. */
export let lastOptions: RegisterOptions | null = null;

/** The updater `registerSW` hands back. Tests swap this to assert or to throw. */
export let updateImpl: (reload?: boolean) => Promise<void> = async () => {};

export function __setUpdateImpl(fn: (reload?: boolean) => Promise<void>) {
  updateImpl = fn;
}

export function __reset() {
  lastOptions = null;
  updateImpl = async () => {};
}

export function registerSW(options: RegisterOptions = {}) {
  lastOptions = options;
  return (reload?: boolean) => updateImpl(reload);
}
