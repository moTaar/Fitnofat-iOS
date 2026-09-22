// Typed client for the Fitnofat backend. Owns the auth session (access +
// refresh tokens), persists it to localStorage, and transparently refreshes
// an expired access token once on a 401.

import type {
<<<<<<< HEAD
  Exercise, FoodLookupResult, HealthIssue, HealthIssueEvent, HealthProfile,
  HealthRecord, MedicalAiStatus, NutritionPlan, Plan, PlanInfo, Program, Routine,
  Subscription, UserProfile, WorkoutSession,
=======
  Exercise, ExerciseVideo, FoodLookupResult, NutritionPlan, Plan, PlanInfo,
  Program, Routine, Subscription, UserProfile, WorkoutSession,
>>>>>>> origin/main
} from "./types";

// Two backends: the data API (workouts/programs/nutrition) and the accounts
// microservice (auth, account management, Stripe billing). They share Supabase,
// so the same Supabase JWT authenticates against both.
const API_BASE = (import.meta.env.VITE_API_URL ?? "http://localhost:8080").replace(/\/$/, "");
const ACCOUNTS_BASE = (import.meta.env.VITE_ACCOUNTS_URL ?? "http://localhost:8090").replace(/\/$/, "");
const SESSION_KEY = "forgefit-session-v1";

export interface Session {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: { id: string; email: string };
}

export class ApiError extends Error {
  status: number;
  /** The server's machine-readable discriminator, when it sent one. */
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export class AuthExpiredError extends ApiError {
  constructor() {
    super("Session expired", 401);
  }
}
// Thrown when the data API rejects a premium route for a non-Pro user (402).
export class UpgradeRequiredError extends ApiError {
  feature?: string;
  constructor(message: string, feature?: string) {
    super(message, 402);
    this.feature = feature;
  }
}
// Thrown on 429: either a short burst limit or the daily AI allowance. The
// server distinguishes the two via `code` — `upgrade_required` means a free
// user is out of allowance (offer Pro), `quota_exceeded`/`rate_limited` mean
// wait it out.
export class RateLimitedError extends ApiError {
  code?: string;
  retryAfterSec?: number;
  constructor(message: string, code?: string, retryAfterSec?: number) {
    super(message, 429);
    this.code = code;
    this.retryAfterSec = retryAfterSec;
  }
  /** True when the fix is upgrading rather than waiting. */
  get isUpgradePath() {
    return this.code === "upgrade_required";
  }
}

let session: Session | null = loadSession();
const listeners = new Set<(s: Session | null) => void>();

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function persist(s: Session | null) {
  session = s;
  if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  else localStorage.removeItem(SESSION_KEY);
  listeners.forEach((l) => l(s));
}

export const auth = {
  getSession: () => session,
  isAuthenticated: () => !!session,
  onChange(cb: (s: Session | null) => void) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  clear: () => persist(null),
};

// A request that's in flight when the app is backgrounded can be suspended by
// the OS/browser and never settle once the app resumes (common on iOS/PWA),
// leaving callers awaiting it forever. Bound every request so it always
// rejects instead of hanging.
const REQUEST_TIMEOUT_MS = 15_000;
// AI-backed endpoints can chain multiple sequential Gemini calls server-side
// (e.g. program refresh = evolve program + regenerate nutrition), which
// routinely takes longer than a normal CRUD round trip — give them more room
// before the client gives up on them.
const AI_REQUEST_TIMEOUT_MS = 60_000;

async function rawRequest(
  base: string,
  path: string,
  init: RequestInit,
  withAuth: boolean,
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (withAuth && session) headers.set("Authorization", `Bearer ${session.accessToken}`);
  return fetch(`${base}${path}`, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) });
}

async function refreshSession(): Promise<boolean> {
  if (!session?.refreshToken) return false;
  // Auth (incl. refresh) is served by the accounts microservice.
  const res = await rawRequest(
    ACCOUNTS_BASE,
    "/auth/refresh",
    { method: "POST", body: JSON.stringify({ refreshToken: session.refreshToken }) },
    false
  );
  if (!res.ok) {
    persist(null);
    return false;
  }
  persist((await res.json()) as Session);
  return true;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  withAuth = true,
  base: string = API_BASE,
  timeoutMs?: number
): Promise<T> {
  let res = await rawRequest(base, path, init, withAuth, timeoutMs);

  if (res.status === 401 && withAuth && session) {
    // Try a one-time refresh, then retry the original request.
    const refreshed = await refreshSession();
    if (!refreshed) throw new AuthExpiredError();
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

// Convenience wrapper for accounts-service calls (auth/account/billing).
function accountsRequest<T>(path: string, init: RequestInit = {}, withAuth = true): Promise<T> {
  return request<T>(path, init, withAuth, ACCOUNTS_BASE);
}

// Why a video list came back empty. The picker explains itself with this rather
// than showing a generic error — the text guide beside it is still perfectly
// good, so an absent video is a degraded section, not a failed one.
export type VideoUnavailable = "not_configured" | "quota" | "error";

// ── Bootstrap payload ─────────────────────────────────────────────────────
export interface BootstrapData {
  profile: (UserProfile & { onboarded: boolean }) | null;
  program: Program | null;
  nutritionPlan: NutritionPlan | null;
  routines: Routine[];
  exercises: Exercise[];
  /** Recent sessions only — see `history` for the window the server applied. */
  workouts: WorkoutSession[];
  history?: {
    windowDays: number;
    returned: number;
    total: number;
    hasMore: boolean;
  };
}

export interface WorkoutPage {
  workouts: WorkoutSession[];
  hasMore: boolean;
}

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
  ai: MedicalAiStatus;
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
}

export type MedicalChatReply =
  | { type: "message"; text: string; suggestions?: string[]; urgent: boolean; redFlags: string[]; model: string; disclaimer: string }
  | { type: "issue"; text: string; issue: HealthIssue; urgent: boolean; redFlags: string[]; model: string; disclaimer: string }
  | { type: "record"; text: string; record: HealthRecord; urgent: boolean; redFlags: string[]; model: string; disclaimer: string };

export const api = {
  // auth — served by the accounts microservice
  async signup(email: string, password: string, name?: string): Promise<Session> {
    const s = await accountsRequest<Session>(
      "/auth/signup",
      { method: "POST", body: JSON.stringify({ email, password, name }) },
      false
    );
    persist(s);
    return s;
  },
  async login(email: string, password: string): Promise<Session> {
    const s = await accountsRequest<Session>(
      "/auth/login",
      { method: "POST", body: JSON.stringify({ email, password }) },
      false
    );
    persist(s);
    return s;
  },
  logout() {
    persist(null);
  },
  forgotPassword: (email: string) =>
    accountsRequest<{ ok: true }>(
      "/auth/forgot-password",
      { method: "POST", body: JSON.stringify({ email }) },
      false
    ),
  resetPassword: (accessToken: string, password: string) =>
    accountsRequest<{ ok: true }>(
      "/auth/reset-password",
      { method: "POST", body: JSON.stringify({ accessToken, password }) },
      false
    ),

  // account management — accounts microservice
  getAccount: () =>
    accountsRequest<{
      id: string; email: string; name: string;
      plan: Plan; status: string; currentPeriodEnd: string | null;
    }>("/account"),
  updateAccount: (patch: { name?: string; email?: string }) =>
    accountsRequest<{ ok: true }>("/account", { method: "PATCH", body: JSON.stringify(patch) }),
  changePassword: (password: string) =>
    accountsRequest<{ ok: true }>("/account/password", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  deleteAccount: () => accountsRequest<void>("/account", { method: "DELETE" }),

  // billing — accounts microservice
  getPlans: () => accountsRequest<{ plans: PlanInfo[] }>("/billing/plans"),
  getSubscription: () => accountsRequest<Subscription>("/billing/subscription"),
  startCheckout: (plan: "pro") =>
    accountsRequest<{ url: string }>("/billing/checkout", {
      method: "POST",
      body: JSON.stringify({ plan }),
    }),
  openBillingPortal: () =>
    accountsRequest<{ url: string }>("/billing/portal", { method: "POST" }),

  // data
  bootstrap: () => request<BootstrapData>("/api/bootstrap"),

  /** Older history, past the window /bootstrap returns. `before` is epoch ms. */
  workoutHistory: (before?: number, limit = 100) => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (before) qs.set("before", String(before));
    return request<WorkoutPage>(`/api/workouts?${qs}`);
  },

  updateProfile: (profile: Partial<UserProfile>) =>
    request<UserProfile & { onboarded: boolean }>("/api/profile", {
      method: "PUT",
      body: JSON.stringify(profile),
    }),

  generateProgram: (profile: UserProfile) =>
    request<ProgramResult>(
      "/api/program/generate",
      { method: "POST", body: JSON.stringify(profile) },
      true, API_BASE, AI_REQUEST_TIMEOUT_MS
    ),

  refreshProgram: () =>
    request<ProgramResult>(
      "/api/program/refresh",
      { method: "POST" },
      true, API_BASE, AI_REQUEST_TIMEOUT_MS
    ),

  createRoutine: (routine: Omit<Routine, "id" | "createdAt" | "source">) =>
    request<Routine>("/api/routines", { method: "POST", body: JSON.stringify(routine) }),

  updateRoutine: (id: string, patch: Partial<Routine>) =>
    request<Routine>(`/api/routines/${id}`, { method: "PUT", body: JSON.stringify(patch) }),

  deleteRoutine: (id: string) =>
    request<void>(`/api/routines/${id}`, { method: "DELETE" }),

  createExercise: (e: { name: string; muscleGroup: string; equipment: string }) =>
    request<Exercise>("/api/exercises", { method: "POST", body: JSON.stringify(e) }),

  // Lazily generate (and cache) an AI how-to guide for an exercise that isn't
  // in the client seed library. Returns the exercise with its `guide` populated.
  exerciseGuide: (e: { name: string; muscleGroup?: string; equipment?: string; force?: boolean }) =>
    request<Exercise>(
      "/api/exercises/guide",
      { method: "POST", body: JSON.stringify(e) },
      true, API_BASE, AI_REQUEST_TIMEOUT_MS
    ),

  // Ranked demonstration videos for the "How to perform" picker, plus whichever
  // one this user previously chose. Cheap and cached server-side — see the quota
  // note in server/src/youtube.ts for why this is a GET and not a Gemini route.
  exerciseVideos: (name: string, force = false) =>
    request<{ videos: ExerciseVideo[]; selectedId: string | null; unavailable?: VideoUnavailable }>(
      `/api/exercises/videos?name=${encodeURIComponent(name)}${force ? "&force=true" : ""}`
    ),

  // Remember the chosen demo (null clears it). Also tallies towards the
  // community default that orders this exercise's list for everyone else.
  setExerciseVideo: (e: {
    name: string;
    videoId: string | null;
    muscleGroup?: string;
    equipment?: string;
  }) =>
    request<Exercise>("/api/exercises/video", { method: "POST", body: JSON.stringify(e) }),

  aiAssistExercise: (name: string) =>
    request<Exercise>(
      "/api/exercises/ai-assist",
      { method: "POST", body: JSON.stringify({ name }) },
      true, API_BASE, AI_REQUEST_TIMEOUT_MS
    ),

  // Resolve (and cache server-side) a MET for an exercise the client's built-in
  // Compendium table can't classify, so calories become accurate. Cheap + cached.
  exerciseMet: (e: { name: string; muscleGroup?: string; equipment?: string; kind?: string }) =>
    request<{ slug: string; met: number; source: string }>(
      "/api/exercises/met",
      { method: "POST", body: JSON.stringify(e) },
      true, API_BASE, AI_REQUEST_TIMEOUT_MS
    ),

  // Generate/evolve the nutrition plan. Optional profile fields (metabolic data
  // or the chosen `cuisine`) patch the profile server-side before planning.
  generateNutrition: (patch?: Partial<UserProfile>) =>
    request<{ nutritionPlan: NutritionPlan; profile: UserProfile & { onboarded: boolean } }>(
      "/api/nutrition/generate",
      { method: "POST", body: JSON.stringify(patch ?? {}) },
      true, API_BASE, AI_REQUEST_TIMEOUT_MS
    ),

  // AI-verified nutritional lookup ("L'apport nutritif"). Returns null when no
  // food could be identified for the query.
  lookupFood: (query: string) =>
    request<{ result: FoodLookupResult | null }>(
      "/api/nutrition/lookup",
      { method: "POST", body: JSON.stringify({ query }) },
      true, API_BASE, AI_REQUEST_TIMEOUT_MS
    ),

  saveWorkouts: (workouts: unknown) =>
    request<WorkoutSession[]>("/api/workouts", { method: "POST", body: JSON.stringify(workouts) }),

  deleteWorkout: (id: string) =>
    request<void>(`/api/workouts/${id}`, { method: "DELETE" }),

  aiChat: (messages: { role: "user" | "model"; content: string }[]) =>
    request<{ type: "question" | "done"; text: string; suggestions?: string[]; profile?: import("./types").UserProfile }>(
      "/api/ai/chat",
      { method: "POST", body: JSON.stringify({ messages }) },
      true, API_BASE, AI_REQUEST_TIMEOUT_MS
    ),

  aiCoach: (
    messages: {
      role: "user" | "model";
      content: string;
      images?: { mimeType: string; data: string }[];
    }[]
  ) =>
    request<
      | { type: "message"; text: string; suggestions?: string[] }
      | { type: "update"; text: string; program: Program; routines: Routine[] }
      | { type: "log"; text: string; workout: WorkoutSession }
    >(
      "/api/ai/coach",
      { method: "POST", body: JSON.stringify({ messages }) },
      true, API_BASE, AI_REQUEST_TIMEOUT_MS
    ),

  // ── health / medical ──────────────────────────────────────────────────────
  healthOverview: () => request<HealthOverview>("/api/health/overview"),

  updateHealthProfile: (patch: Partial<HealthProfile>) =>
    request<HealthProfile>("/api/health/profile", {
      method: "PUT",
      body: JSON.stringify(patch),
    }),

  /** Opt in/out of sending health data to the medical model. */
  setHealthConsent: (granted: boolean) =>
    request<HealthProfile>("/api/health/consent", {
      method: "POST",
      body: JSON.stringify({ granted }),
    }),

  createHealthIssue: (issue: {
    title: string;
    category?: HealthIssue["category"];
    severity?: HealthIssue["severity"];
    summary?: string;
    actionPlan?: HealthIssue["actionPlan"];
    metrics?: HealthIssue["metrics"];
    targetDate?: string;
  }) => request<HealthIssue>("/api/health/issues", { method: "POST", body: JSON.stringify(issue) }),

  updateHealthIssue: (id: string, patch: Partial<HealthIssue>) =>
    request<HealthIssue>(`/api/health/issues/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  deleteHealthIssue: (id: string) =>
    request<void>(`/api/health/issues/${id}`, { method: "DELETE" }),

  /** A note or a measurement on an issue's timeline. */
  addIssueEvent: (
    id: string,
    event: { kind?: HealthIssueEvent["kind"]; body?: string; metric?: string; value?: number; unit?: string }
  ) =>
    request<{ event: HealthIssueEvent; issue: HealthIssue }>(`/api/health/issues/${id}/events`, {
      method: "POST",
      body: JSON.stringify(event),
    }),

  createHealthRecord: (record: {
    kind?: HealthRecord["kind"];
    title: string;
    detail?: string;
    occurredAt?: number;
    issueId?: string;
    data?: Record<string, unknown>;
  }) => request<HealthRecord>("/api/health/records", { method: "POST", body: JSON.stringify(record) }),

  deleteHealthRecord: (id: string) =>
    request<void>(`/api/health/records/${id}`, { method: "DELETE" }),

  /** Re-runs the medical review and folds the result into the tracked issues. */
  reviewHealth: () =>
    request<HealthReviewResult>(
      "/api/health/review",
      { method: "POST" },
      true, API_BASE, AI_REQUEST_TIMEOUT_MS
    ),

  medicalChat: (
    messages: {
      role: "user" | "model";
      content: string;
      images?: { mimeType: string; data: string }[];
    }[]
  ) =>
    request<MedicalChatReply>(
      "/api/health/chat",
      { method: "POST", body: JSON.stringify({ messages }) },
      true, API_BASE, AI_REQUEST_TIMEOUT_MS
    ),
};
