// The client's single entry point to the backend, in three parts:
//
//   • Supabase directly (db.ts) — auth and every plain read/write of the
//     user's own rows: profile, routines, history, the health record. This is
//     the bulk of the traffic, and it no longer touches a hosted service.
//   • The data API (server/) — only what needs a secret the phone can't hold:
//     Gemini (program, nutrition, coach, medical desk), YouTube, the shared AI
//     caches and the per-user AI quota.
//   • The accounts service (accounts/) — only what needs the service role or
//     Stripe: creating an account, changing email/password, deleting the
//     account, and billing.
//
// The auth session is owned by supabase-js; this module mirrors it into a
// synchronous `auth` object because the store and the router ask "am I signed
// in?" synchronously. `initAuth()` must resolve before the app renders.

import type { Session as SupabaseSession } from "@supabase/supabase-js";
import type {
  CloudDisclosure, Exercise, ExerciseVideo, FoodLookupResult, HealthIssue, HealthIssueEvent,
  HealthProfile, HealthRecord, HealthRule, MedicalAiStatus, NutritionPlan, Plan, PlanInfo, Program,
  Routine, Subscription, UserProfile, WorkoutSession,
} from "./types";
import { AUTH_STORAGE_KEY, authStorage, supabase, supabaseConfigured } from "./supabase";
import * as db from "./db";
import { ApiError, AuthExpiredError, RateLimitedError, UpgradeRequiredError } from "./errors";
import { APP_URL_SCHEME, isNative } from "./platform";
import { timeoutSignal } from "./timeout";

export { ApiError, AuthExpiredError, RateLimitedError, UpgradeRequiredError };
export type { BootstrapData, WorkoutPage } from "./db";

// Two services, both optional at runtime: with neither reachable the app still
// signs in, trains, logs and syncs — it just can't run the AI features.
const API_BASE = (import.meta.env.VITE_API_URL ?? "http://localhost:8080").replace(/\/$/, "");
const ACCOUNTS_BASE = (import.meta.env.VITE_ACCOUNTS_URL ?? "http://localhost:8090").replace(/\/$/, "");
// Where the PWA used to keep the accounts-service session. Read once so a
// browser that was signed in before the switch to supabase-js stays signed in.
const LEGACY_SESSION_KEY = "forgefit-session-v1";

export interface Session {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: { id: string; email: string };
}

// ── auth session mirror ─────────────────────────────────────────────────────

let session: Session | null = null;
const listeners = new Set<(s: Session | null) => void>();

function fromSupabase(s: SupabaseSession | null): Session | null {
  if (!s) return null;
  return {
    accessToken: s.access_token,
    refreshToken: s.refresh_token,
    expiresAt: s.expires_at ?? 0,
    user: { id: s.user.id, email: s.user.email ?? "" },
  };
}

function setSession(next: Session | null) {
  const changed = (session?.user.id ?? null) !== (next?.user.id ?? null);
  session = next;
  if (changed) listeners.forEach((l) => l(next));
}

export const auth = {
  getSession: () => session,
  isAuthenticated: () => !!session,
  /** Fires when the signed-in user changes (sign-in, sign-out, session lost). */
  onChange(cb: (s: Session | null) => void) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  clear: () => {
    void api.logout();
  },
};

let authReady: Promise<void> | null = null;

/**
 * Loads the stored session (asynchronously on iOS — it lives in native
 * Preferences) and keeps the mirror in step with supabase-js from then on.
 * Idempotent; main.tsx awaits it before the first render.
 */
export function initAuth(): Promise<void> {
  if (authReady) return authReady;
  authReady = (async () => {
    if (!supabaseConfigured()) {
      console.error("[auth] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set — sign-in is unavailable.");
      return;
    }
    const client = supabase();
    try {
      const { data } = await client.auth.getSession();
      let current = data.session;
      if (!current) current = await adoptLegacySession();
      setSession(fromSupabase(current));
    } catch (err) {
      console.warn("[auth] could not restore the session:", err);
    }
    // Never call back into supabase-js from inside this callback — it runs
    // under the client's auth lock.
    client.auth.onAuthStateChange((_event, s) => setSession(fromSupabase(s)));
  })();
  return authReady;
}

/** One-time hand-over of a session the old accounts-service login stored. */
async function adoptLegacySession(): Promise<SupabaseSession | null> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LEGACY_SESSION_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    localStorage.removeItem(LEGACY_SESSION_KEY);
    const legacy = JSON.parse(raw) as Partial<Session>;
    if (!legacy.accessToken || !legacy.refreshToken) return null;
    const { data } = await supabase().auth.setSession({
      access_token: legacy.accessToken,
      refresh_token: legacy.refreshToken,
    });
    return data.session;
  } catch {
    return null;
  }
}

/** A current access token, refreshed by supabase-js if it has expired. */
async function accessToken(): Promise<string | null> {
  if (!supabaseConfigured()) return null;
  const { data } = await supabase().auth.getSession();
  return data.session?.access_token ?? null;
}

async function forceRefresh(): Promise<boolean> {
  try {
    const { data, error } = await supabase().auth.refreshSession();
    return !error && !!data.session;
  } catch {
    return false;
  }
}

// ── HTTP to the services ────────────────────────────────────────────────────

// A request that's in flight when the app is backgrounded can be suspended by
// the OS and never settle once the app resumes (common on iOS), leaving callers
// awaiting it forever. Bound every request so it always rejects instead.
const REQUEST_TIMEOUT_MS = 15_000;
// AI-backed endpoints can chain multiple sequential Gemini calls server-side
// (e.g. program refresh = evolve program + regenerate nutrition), which
// routinely takes longer than a normal CRUD round trip.
const AI_REQUEST_TIMEOUT_MS = 60_000;
// The health routes run a reasoning model with a 90s server-side deadline
// (MEDICAL_AI_TIMEOUT_MS), plus the database work around it. At 60s the client
// would abort a request the server was still handling perfectly well.
export const MEDICAL_REQUEST_TIMEOUT_MS = 120_000;

async function rawRequest(
  base: string,
  path: string,
  init: RequestInit,
  withAuth: boolean,
  timeoutMs: number
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (withAuth) {
    const token = await accessToken();
    if (!token) throw new AuthExpiredError();
    headers.set("Authorization", `Bearer ${token}`);
  }
  try {
    return await fetch(`${base}${path}`, { ...init, headers, signal: timeoutSignal(timeoutMs) });
  } catch (err) {
    if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new ApiError("The server took too long to answer. Try again in a moment.", 0, "timeout");
    }
    throw new ApiError("Couldn't reach the server — check your connection.", 0, "network");
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  withAuth = true,
  base: string = API_BASE,
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<T> {
  let res = await rawRequest(base, path, init, withAuth, timeoutMs);

  if (res.status === 401 && withAuth) {
    // One forced refresh, then retry the original request.
    if (!(await forceRefresh())) throw new AuthExpiredError();
    res = await rawRequest(base, path, init, withAuth, timeoutMs);
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let feature: string | undefined;
    let code: string | undefined;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
      if (body?.feature) feature = body.feature;
      if (body?.code) code = body.code;
    } catch {
      /* ignore */
    }
    if (res.status === 401) throw new AuthExpiredError();
    if (res.status === 402) throw new UpgradeRequiredError(message, feature);
    if (res.status === 429) {
      const retry = Number(res.headers.get("retry-after"));
      throw new RateLimitedError(message, code, Number.isFinite(retry) ? retry : undefined);
    }
    throw new ApiError(message, res.status, code);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function accountsRequest<T>(path: string, init: RequestInit = {}, withAuth = true): Promise<T> {
  return request<T>(path, init, withAuth, ACCOUNTS_BASE);
}

function aiRequest<T>(path: string, body: unknown, timeoutMs = AI_REQUEST_TIMEOUT_MS): Promise<T> {
  return request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }, true, API_BASE, timeoutMs);
}

// Why a video list came back empty. The picker explains itself with this rather
// than showing a generic error — the text guide beside it is still perfectly
// good, so an absent video is a degraded section, not a failed one.
export type VideoUnavailable = "not_configured" | "quota" | "error";

interface ProgramResult {
  program: Program;
  routines: Routine[];
  nutritionPlan?: NutritionPlan | null;
}

// ── Health / medical ──────────────────────────────────────────────────────
export interface HealthOverview {
  health: HealthProfile;
  issues: HealthIssue[];
  records: HealthRecord[];
  rules: HealthRule[];
  /** Null when the data API couldn't be reached — the record still loads. */
  ai: MedicalAiStatus | null;
}

export interface HealthReviewResult {
  summary: string;
  model: string;
  created: number;
  updated: number;
  /** Issues the AI thinks are done. Shown for confirmation, never auto-applied. */
  resolvedSuggestions: string[];
  issues: HealthIssue[];
  disclaimer: string;
  /** What the cloud model was given for this review. */
  disclosure?: CloudDisclosure;
}

// `rules` can ride along with any reply type — the chat may set standing
// do/don't rules while also tracking an issue or filing a record.
interface MedicalReplyCommon {
  text: string;
  urgent: boolean;
  redFlags: string[];
  model: string;
  disclaimer: string;
  rules?: HealthRule[];
  /** What the cloud model was given for this turn — absent if nothing was sent. */
  disclosure?: CloudDisclosure;
}

export type MedicalChatReply =
  | ({ type: "message"; suggestions?: string[] } & MedicalReplyCommon)
  | ({ type: "issue"; issue: HealthIssue } & MedicalReplyCommon)
  | ({ type: "record"; record: HealthRecord } & MedicalReplyCommon);

/** Where a password-reset email should send the user back to. */
function resetRedirectUrl(): string {
  if (isNative()) return `${APP_URL_SCHEME}://reset-password`;
  return `${window.location.origin}/reset-password`;
}

type ChatTurn = {
  role: "user" | "model";
  content: string;
  images?: { mimeType: string; data: string }[];
};

export const api = {
  // ── auth ───────────────────────────────────────────────────────────────────
  // Sign-up stays on the accounts service: it creates the user pre-confirmed
  // and seeds the profile, the free subscription row and the Stripe customer,
  // all of which need the service role. Everything after that is supabase-js.
  async signup(email: string, password: string, name?: string): Promise<Session> {
    const s = await accountsRequest<Session>(
      "/auth/signup",
      { method: "POST", body: JSON.stringify({ email, password, name }) },
      false
    );
    const { data, error } = await supabase().auth.setSession({
      access_token: s.accessToken,
      refresh_token: s.refreshToken,
    });
    if (error || !data.session) throw new ApiError("Account created — please log in.", 400);
    const next = fromSupabase(data.session)!;
    setSession(next);
    return next;
  },

  async login(email: string, password: string): Promise<Session> {
    if (!supabaseConfigured()) {
      throw new ApiError("This build isn't connected to a Supabase project.", 0, "not_configured");
    }
    const { data, error } = await supabase().auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      // Don't reveal whether the address exists.
      if (error && /fetch|network/i.test(error.message)) {
        throw new ApiError("Couldn't reach the server — check your connection.", 0, "network");
      }
      throw new ApiError("Invalid email or password", 401);
    }
    const next = fromSupabase(data.session)!;
    setSession(next);
    return next;
  },

  /** Local sign-out: forgets the session on this device, even offline. */
  async logout(): Promise<void> {
    setSession(null);
    if (!supabaseConfigured()) return;
    try {
      await supabase().auth.signOut({ scope: "local" });
    } catch {
      /* offline — the storage removal below still signs this device out */
    }
    try {
      await authStorage.removeItem(AUTH_STORAGE_KEY);
    } catch {
      /* already gone */
    }
  },

  /**
   * Sends the recovery email. Always resolves: whether the address is
   * registered must not be observable from here.
   */
  async forgotPassword(email: string): Promise<{ ok: true }> {
    try {
      await supabase().auth.resetPasswordForEmail(email, { redirectTo: resetRedirectUrl() });
    } catch (err) {
      console.warn("[auth] forgot-password error:", err);
    }
    return { ok: true };
  },

  // Completing the reset needs no session: the recovery token from the email
  // link is the proof, and the accounts service sets the password with it.
  resetPassword: (accessToken: string, password: string) =>
    accountsRequest<{ ok: true }>(
      "/auth/reset-password",
      { method: "POST", body: JSON.stringify({ accessToken, password }) },
      false
    ),

  // ── account management ─────────────────────────────────────────────────────
  getAccount: () =>
    accountsRequest<{
      id: string; email: string; name: string;
      plan: Plan; status: string; currentPeriodEnd: string | null;
    }>("/account"),

  async updateAccount(patch: { name?: string; email?: string }): Promise<{ ok: true }> {
    if (patch.name !== undefined) await db.updateAccountName(patch.name);
    // Email changes go through the service: it confirms the new address with
    // the service role and keeps the Stripe customer's email in step.
    if (patch.email !== undefined) {
      await accountsRequest<{ ok: true }>("/account", {
        method: "PATCH",
        body: JSON.stringify({ email: patch.email }),
      });
      await forceRefresh();
    }
    return { ok: true };
  },

  changePassword: (password: string) =>
    accountsRequest<{ ok: true }>("/account/password", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),

  deleteAccount: () => accountsRequest<void>("/account", { method: "DELETE" }),

  // ── billing ───────────────────────────────────────────────────────────────
  getPlans: () => accountsRequest<{ plans: PlanInfo[] }>("/billing/plans"),
  /** Read straight from the `subscriptions` row (owner read-only). */
  getSubscription: (): Promise<Subscription> => db.getSubscription(),
  startCheckout: (plan: "pro") =>
    accountsRequest<{ url: string }>("/billing/checkout", {
      method: "POST",
      body: JSON.stringify({ plan }),
    }),
  openBillingPortal: () => accountsRequest<{ url: string }>("/billing/portal", { method: "POST" }),

  // ── training data (Supabase) ────────────────────────────────────────────────
  bootstrap: () => db.bootstrap(),
  /** Older history, past the bootstrap window. `before` is epoch ms. */
  workoutHistory: (before?: number, limit = 100) => db.workoutHistory(before, limit),
  updateProfile: (profile: Partial<UserProfile>) => db.updateProfile(profile),
  createRoutine: (routine: Omit<Routine, "id" | "createdAt" | "source">) => db.createRoutine(routine),
  updateRoutine: (id: string, patch: Partial<Routine>) => db.updateRoutine(id, patch),
  deleteRoutine: (id: string) => db.deleteRoutine(id),
  createExercise: (e: { name: string; muscleGroup: string; equipment: string }) => db.createExercise(e),
  saveWorkouts: (workouts: Parameters<typeof db.saveWorkouts>[0]) => db.saveWorkouts(workouts),
  deleteWorkout: (id: string) => db.deleteWorkout(id),

  // ── AI (data API) ───────────────────────────────────────────────────────────
  generateProgram: (profile: UserProfile) => aiRequest<ProgramResult>("/api/program/generate", profile),
  refreshProgram: () => aiRequest<ProgramResult>("/api/program/refresh", {}),

  // Lazily generate (and cache) an AI how-to guide for an exercise that isn't
  // in the client seed library. Returns the exercise with its `guide` populated.
  exerciseGuide: (e: { name: string; muscleGroup?: string; equipment?: string; force?: boolean }) =>
    aiRequest<Exercise>("/api/exercises/guide", e),

  // Ranked demonstration videos, plus whichever one this user previously chose.
  // Served from the server's global cache — see the quota note in youtube.ts.
  exerciseVideos: (name: string, force = false) =>
    request<{ videos: ExerciseVideo[]; selectedId: string | null; unavailable?: VideoUnavailable }>(
      `/api/exercises/videos?name=${encodeURIComponent(name)}${force ? "&force=true" : ""}`
    ),

  // Remember the chosen demo (null clears it). Stays on the server because it
  // also tallies towards the community default in the shared cache.
  setExerciseVideo: (e: { name: string; videoId: string | null; muscleGroup?: string; equipment?: string }) =>
    request<Exercise>("/api/exercises/video", { method: "POST", body: JSON.stringify(e) }),

  aiAssistExercise: (name: string) => aiRequest<Exercise>("/api/exercises/ai-assist", { name }),

  // Resolve (and cache server-side) a MET for an exercise the client's built-in
  // Compendium table can't classify, so calories become accurate.
  exerciseMet: (e: { name: string; muscleGroup?: string; equipment?: string; kind?: string }) =>
    aiRequest<{ slug: string; met: number; source: string }>("/api/exercises/met", e),

  // Generate/evolve the nutrition plan. Optional profile fields (metabolic data
  // or the chosen `cuisine`) patch the profile server-side before planning.
  generateNutrition: (patch?: Partial<UserProfile>) =>
    aiRequest<{ nutritionPlan: NutritionPlan; profile: UserProfile & { onboarded: boolean } }>(
      "/api/nutrition/generate",
      patch ?? {}
    ),

  // AI-verified nutritional lookup. Returns null when no food was identified.
  lookupFood: (query: string) =>
    aiRequest<{ result: FoodLookupResult | null }>("/api/nutrition/lookup", { query }),

  aiChat: (messages: { role: "user" | "model"; content: string }[]) =>
    aiRequest<{ type: "question" | "done"; text: string; suggestions?: string[]; profile?: UserProfile }>(
      "/api/ai/chat",
      { messages }
    ),

  aiCoach: (messages: ChatTurn[]) =>
    aiRequest<
      | { type: "message"; text: string; suggestions?: string[] }
      | { type: "update"; text: string; program: Program; routines: Routine[] }
      | { type: "log"; text: string; workout: WorkoutSession }
    >("/api/ai/coach", { messages }),

  // ── health record (Supabase) ────────────────────────────────────────────────
  /**
   * The Medical tab's data. The record comes straight from Supabase; which
   * model would answer comes from the data API, and is allowed to fail — the
   * record is the user's and must open even when the AI side is unreachable.
   */
  async healthOverview(): Promise<HealthOverview> {
    const [record, ai] = await Promise.all([
      db.loadHealthRecord(),
      api.medicalAiStatus().catch(() => null),
    ]);
    return {
      ...record,
      ai: ai ? { ...ai, consented: !!record.health.aiConsentAt } : null,
    };
  },

  /** Which model backs the medical desk. `consented` is filled in by the caller. */
  async medicalAiStatus(): Promise<MedicalAiStatus> {
    try {
      const s = await request<Omit<MedicalAiStatus, "consented">>("/api/health/ai");
      return { ...s, consented: false };
    } catch (err) {
      // A data API deployed before /health/ai existed still answers the old
      // overview route, which carries the same status block.
      if (err instanceof ApiError && err.status === 404) {
        const legacy = await request<{ ai: MedicalAiStatus }>("/api/health/overview");
        return legacy.ai;
      }
      throw err;
    }
  },

  updateHealthProfile: (patch: Partial<HealthProfile>) => db.updateHealthProfile(patch),
  /** Opt in/out of sending health data to the medical model. */
  setHealthConsent: (granted: boolean) => db.setHealthConsent(granted),
  createHealthIssue: (issue: db.IssueInput) => db.createHealthIssue(issue),
  updateHealthIssue: (id: string, patch: Partial<HealthIssue>) => db.updateHealthIssue(id, patch),
  deleteHealthIssue: (id: string) => db.deleteHealthIssue(id),
  /** A note or a measurement on an issue's timeline. */
  addIssueEvent: (
    id: string,
    event: { kind?: HealthIssueEvent["kind"]; body?: string; metric?: string; value?: number; unit?: string }
  ) => db.addIssueEvent(id, event),
  createHealthRule: (rule: db.RuleInput) => db.createHealthRule(rule),
  updateHealthRule: (id: string, patch: Partial<HealthRule>) => db.updateHealthRule(id, patch),
  deleteHealthRule: (id: string) => db.deleteHealthRule(id),
  createHealthRecord: (record: db.RecordInput) => db.createHealthRecord(record),
  deleteHealthRecord: (id: string) => db.deleteHealthRecord(id),

  // ── medical AI (data API, consent-gated server-side) ────────────────────────
  /** Re-runs the medical review and folds the result into the tracked issues. */
  reviewHealth: () =>
    aiRequest<HealthReviewResult>("/api/health/review", {}, MEDICAL_REQUEST_TIMEOUT_MS),

  medicalChat: (messages: ChatTurn[]) =>
    aiRequest<MedicalChatReply>("/api/health/chat", { messages }, MEDICAL_REQUEST_TIMEOUT_MS),
};
