// Typed client for the ForgeFit backend. Owns the auth session (access +
// refresh tokens), persists it to localStorage, and transparently refreshes
// an expired access token once on a 401.

import type {
  Exercise, FoodLookupResult, NutritionPlan, Plan, PlanInfo, Program, Routine,
  Subscription, UserProfile, WorkoutSession,
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
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
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

async function rawRequest(
  base: string,
  path: string,
  init: RequestInit,
  withAuth: boolean
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (withAuth && session) headers.set("Authorization", `Bearer ${session.accessToken}`);
  return fetch(`${base}${path}`, { ...init, headers });
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
  base: string = API_BASE
): Promise<T> {
  let res = await rawRequest(base, path, init, withAuth);

  if (res.status === 401 && withAuth && session) {
    // Try a one-time refresh, then retry the original request.
    const refreshed = await refreshSession();
    if (!refreshed) throw new AuthExpiredError();
    res = await rawRequest(base, path, init, withAuth);
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let feature: string | undefined;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
      if (body?.feature) feature = body.feature;
    } catch {
      /* ignore */
    }
    if (res.status === 401) throw new AuthExpiredError();
    if (res.status === 402) throw new UpgradeRequiredError(message, feature);
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// Convenience wrapper for accounts-service calls (auth/account/billing).
function accountsRequest<T>(path: string, init: RequestInit = {}, withAuth = true): Promise<T> {
  return request<T>(path, init, withAuth, ACCOUNTS_BASE);
}

// ── Bootstrap payload ─────────────────────────────────────────────────────
export interface BootstrapData {
  profile: (UserProfile & { onboarded: boolean }) | null;
  program: Program | null;
  nutritionPlan: NutritionPlan | null;
  routines: Routine[];
  exercises: Exercise[];
  workouts: WorkoutSession[];
}

interface ProgramResult {
  program: Program;
  routines: Routine[];
  nutritionPlan?: NutritionPlan | null;
}

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

  updateProfile: (profile: Partial<UserProfile>) =>
    request<UserProfile & { onboarded: boolean }>("/api/profile", {
      method: "PUT",
      body: JSON.stringify(profile),
    }),

  generateProgram: (profile: UserProfile) =>
    request<ProgramResult>("/api/program/generate", {
      method: "POST",
      body: JSON.stringify(profile),
    }),

  refreshProgram: () => request<ProgramResult>("/api/program/refresh", { method: "POST" }),

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
    request<Exercise>("/api/exercises/guide", { method: "POST", body: JSON.stringify(e) }),

  aiAssistExercise: (name: string) =>
    request<Exercise>("/api/exercises/ai-assist", { method: "POST", body: JSON.stringify({ name }) }),

  // Generate/evolve the nutrition plan. Optional profile fields (metabolic data
  // or the chosen `cuisine`) patch the profile server-side before planning.
  generateNutrition: (patch?: Partial<UserProfile>) =>
    request<{ nutritionPlan: NutritionPlan; profile: UserProfile & { onboarded: boolean } }>(
      "/api/nutrition/generate",
      { method: "POST", body: JSON.stringify(patch ?? {}) }
    ),

  // AI-verified nutritional lookup ("L'apport nutritif"). Returns null when no
  // food could be identified for the query.
  lookupFood: (query: string) =>
    request<{ result: FoodLookupResult | null }>("/api/nutrition/lookup", {
      method: "POST",
      body: JSON.stringify({ query }),
    }),

  saveWorkouts: (workouts: unknown) =>
    request<WorkoutSession[]>("/api/workouts", { method: "POST", body: JSON.stringify(workouts) }),

  deleteWorkout: (id: string) =>
    request<void>(`/api/workouts/${id}`, { method: "DELETE" }),

  aiChat: (messages: { role: "user" | "model"; content: string }[]) =>
    request<{ type: "question" | "done"; text: string; suggestions?: string[]; profile?: import("./types").UserProfile }>(
      "/api/ai/chat",
      { method: "POST", body: JSON.stringify({ messages }) }
    ),

  aiCoach: (messages: { role: "user" | "model"; content: string }[]) =>
    request<
      | { type: "message"; text: string; suggestions?: string[] }
      | { type: "update"; text: string; program: Program; routines: Routine[] }
      | { type: "log"; text: string; workout: WorkoutSession }
    >("/api/ai/coach", { method: "POST", body: JSON.stringify({ messages }) }),
};
