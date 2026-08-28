import { create } from "zustand";
import { persist } from "zustand/middleware";
import { format } from "date-fns";
import type {
  ActiveWorkout, Cuisine, EquipmentPrefCategory, EquipmentPreference, Exercise,
  FoodLookupResult, LoggedExercise, LoggedFood, NutritionLog, NutritionPlan,
  Program, RepSensitivity, Routine, Subscription, UserProfile, WorkoutSession,
} from "./types";
import { SEED_EXERCISES } from "./exercises";
import { sessionVolume, uid } from "./utils";
import { estimateSessionCalories, needsAiMet, resolveKind } from "./calories";
import { api, auth, AuthExpiredError, type Session } from "./api";
import { toast } from "./toast";

// Cached METs keyed by exercise id/slug, for reusing known values in calorie
// estimates (so repeated exercises never re-hit the AI).
function metMapFrom(exercises: Exercise[]): Record<string, number | undefined> {
  const m: Record<string, number | undefined> = {};
  for (const e of exercises) if (e.met != null) m[e.id] = e.met;
  return m;
}

export const todayKey = () => format(new Date(), "yyyy-MM-dd");

// Input for saveManualSession — the editable parts of a session; the store fills
// in id/clientId/volume/calories.
export interface ManualSessionDraft {
  routineName: string;
  startedAt: number;
  durationSec: number;
  exercises: LoggedExercise[];
  notes?: string;
}

interface Settings {
  theme: "dark" | "light";
  defaultRestSeconds: number;
  remindersEnabled: boolean;
  // Smart Rep Counter
  repSensitivity: RepSensitivity; // accelerometer detection sensitivity
  repSound: boolean; // audible "tick" cue on each logged rep
}

interface AppState {
  hydrated: boolean;
  bootstrapped: boolean;
  bootstrapping: boolean; // in-flight guard so overlapping bootstrap() calls don't race
  user: Session["user"] | null;
  profile: UserProfile | null;
  onboarded: boolean;
  exercises: Exercise[];
  hiddenExerciseIds: string[]; // excluded from routine-building suggestions
  routines: Routine[];
  program: Program | null;
  nutritionPlan: NutritionPlan | null;
  nutritionLog: NutritionLog | null; // today's offline meal checklist
  history: WorkoutSession[];
  active: ActiveWorkout | null;
  subscription: Subscription | null; // billing tier/status (accounts service)
  settings: Settings;

  // auth
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => void;
  bootstrap: () => Promise<void>;
  // Escape hatch for the launch splash: proceed with whatever's cached instead
  // of waiting on a bootstrap request that's taking too long or is stuck.
  skipBootstrap: () => void;

  // account & billing (accounts microservice)
  loadSubscription: () => Promise<void>;
  updateAccount: (patch: { name?: string; email?: string }) => Promise<void>;
  changePassword: (password: string) => Promise<void>;
  deleteAccount: () => Promise<void>;

  // AI / onboarding
  generateProgram: (profile: UserProfile) => Promise<void>;
  refreshProgram: () => Promise<string>;
  applyProgramUpdate: (program: Program, aiRoutines: Routine[]) => void;

  // nutrition
  generateNutrition: (patch?: Partial<UserProfile>) => Promise<void>;
  setNutritionDayType: (dayType: "training" | "rest") => void;
  toggleMeal: (mealKey: string) => void;
  setCuisine: (cuisine: Cuisine) => void;          // persisted on the profile (server + local)
  logFood: (food: FoodLookupResult) => void;       // append a looked-up food to today's tracker
  removeLoggedFood: (id: string) => void;

  // routines
  saveRoutine: (input: {
    id?: string;
    name: string;
    description?: string;
    dayLabel?: string;
    favorite?: boolean;
    exercises: Routine["exercises"];
  }) => Promise<void>;
  deleteRoutine: (id: string) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;

  // exercises
  addCustomExercise: (e: { name: string; muscleGroup: Exercise["muscleGroup"]; equipment: string }) => Promise<Exercise>;
  receiveExercise: (exercise: Exercise) => void;
  fetchExerciseGuide: (e: { name: string; muscleGroup?: Exercise["muscleGroup"]; equipment?: string; force?: boolean }) => Promise<Exercise>;
  toggleExerciseHidden: (id: string) => void;

  // active workout
  startWorkout: (routine?: Routine) => void;
  // Re-do a past session live: seeds the active workout from its exercises.
  startWorkoutFromSession: (session: WorkoutSession) => void;
  logSet: (
    exIdx: number,
    setIdx: number,
    patch: Partial<{ weight: number; reps: number; completed: boolean; durationSec: number; distanceKm: number; rpe: number }>
  ) => void;
  addSetToExercise: (exIdx: number) => void;
  removeSet: (exIdx: number, setIdx: number) => void;
  addExerciseToActive: (exercise: Exercise) => void;
  removeExerciseFromActive: (exIdx: number) => void;
  setActiveExerciseKind: (exIdx: number, kind: LoggedExercise["kind"]) => void;
  startRest: (seconds: number) => void;
  stopRest: () => void;
  finishWorkout: () => Promise<void>;
  cancelWorkout: () => void;
  syncPending: () => Promise<void>;
  // Merge a workout the AI coach reconstructed + saved server-side into history.
  receiveLoggedWorkout: (workout: WorkoutSession) => void;
  // Save an edited/cloned/manual session as a NEW history entry (fresh id/date),
  // recomputing volume + calories, then sync.
  saveManualSession: (draft: ManualSessionDraft) => Promise<void>;
  // Edit an existing history entry in place (keeps its id/clientId so the server
  // upsert updates the same row), recomputing volume + calories, then sync.
  updateManualSession: (id: string, draft: ManualSessionDraft) => Promise<void>;
  // Remove a session from history (optimistic) and delete it server-side.
  deleteWorkout: (id: string) => Promise<void>;
  // For exercises whose MET the local table can't classify, fetch a precise MET
  // from the AI (cached server-side), store it, and recompute the session's
  // calories. Cheap + best-effort; makes thin-data logs accurate after a beat.
  backfillSessionCalories: (sessionId: string) => Promise<void>;

  // settings
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  setUnits: (units: "kg" | "lb") => void;
  // Equipment Preferences (Settings, collapsed by default): per-item override
  // on top of `equipment`/`equipmentMix`. `value === undefined` clears back to
  // "no preference" — persisted on the profile (server + local).
  setEquipmentPref: (category: EquipmentPrefCategory, value: EquipmentPreference | undefined) => void;
}

// Most recently logged sets for an exercise, so a routine's static targets can
// be overridden with what the user actually did last time (history is sorted
// most-recent-first).
function lastLoggedSets(history: WorkoutSession[], exerciseId: string) {
  for (const session of history) {
    const ex = session.exercises.find((e) => e.exerciseId === exerciseId);
    if (ex) return ex.sets;
  }
  return undefined;
}

function routineToLoggedExercises(routine: Routine, history: WorkoutSession[]): LoggedExercise[] {
  return routine.exercises.map((re) => {
    const last = lastLoggedSets(history, re.exerciseId);
    return {
      exerciseId: re.exerciseId,
      name: re.name,
      muscleGroup: re.muscleGroup,
      restSeconds: re.restSeconds,
      kind: re.muscleGroup === "Cardio" ? "cardio" : "strength",
      sets: re.sets.map((s, i) => {
        const prev = last?.[i];
        const rpe = prev?.rpe ?? s.rpe;
        return {
          weight: prev?.weight ?? s.targetWeight ?? 0,
          reps: prev?.reps ?? s.targetReps,
          completed: false,
          ...(rpe != null ? { rpe } : {}),
        };
      }),
    };
  });
}

function workoutToApi(w: WorkoutSession) {
  return {
    clientId: w.clientId ?? w.id,
    routineId: w.routineId ?? null,
    routineName: w.routineName,
    startedAt: w.startedAt,
    endedAt: w.endedAt,
    durationSec: w.durationSec,
    totalVolume: w.totalVolume,
    calories: w.calories,
    notes: w.notes,
    exercises: w.exercises,
  };
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      bootstrapped: false,
      bootstrapping: false,
      user: auth.getSession()?.user ?? null,
      profile: null,
      onboarded: false,
      exercises: SEED_EXERCISES,
      hiddenExerciseIds: [],
      routines: [],
      program: null,
      nutritionPlan: null,
      nutritionLog: null,
      history: [],
      active: null,
      subscription: null,
      settings: {
        theme: "dark",
        defaultRestSeconds: 90,
        remindersEnabled: false,
        repSensitivity: "medium",
        repSound: true,
      },

      // ── auth ────────────────────────────────────────────────────────────
      login: async (email, password) => {
        const s = await api.login(email, password);
        set({ user: s.user, bootstrapped: false });
        await get().bootstrap();
      },
      signup: async (email, password, name) => {
        const s = await api.signup(email, password, name);
        set({ user: s.user, bootstrapped: false, onboarded: false });
        await get().bootstrap();
      },
      logout: () => {
        api.logout();
        set({
          user: null,
          bootstrapped: false,
          profile: null,
          onboarded: false,
          routines: [],
          program: null,
          nutritionPlan: null,
          nutritionLog: null,
          history: [],
          active: null,
          subscription: null,
          exercises: SEED_EXERCISES,
        });
      },

      // ── account & billing ───────────────────────────────────────────────
      loadSubscription: async () => {
        if (!auth.isAuthenticated()) return;
        try {
          const subscription = await api.getSubscription();
          set({ subscription });
        } catch {
          /* best-effort; gating still enforced server-side */
        }
      },

      updateAccount: async (patch) => {
        await api.updateAccount(patch);
        const p = get().profile;
        if (patch.name !== undefined && p) set({ profile: { ...p, name: patch.name } });
        if (patch.email !== undefined) {
          const u = get().user;
          if (u) set({ user: { ...u, email: patch.email } });
        }
      },

      changePassword: async (password) => {
        await api.changePassword(password);
      },

      deleteAccount: async () => {
        await api.deleteAccount();
        get().logout();
      },

      bootstrap: async () => {
        if (!auth.isAuthenticated() || get().bootstrapping) return;
        set({ bootstrapping: true });
        try {
          const data = await api.bootstrap();
          const seedIds = new Set(SEED_EXERCISES.map((e) => e.id));
          const customs = data.exercises.filter((e) => !seedIds.has(e.id));

          // Merge server history with any local workouts that haven't synced.
          const serverClientIds = new Set(
            data.workouts.map((w) => w.clientId).filter(Boolean) as string[]
          );
          const pendingLocal = get().history.filter(
            (w) => !w.synced && !serverClientIds.has(w.clientId ?? w.id)
          );

          set({
            bootstrapped: true,
            user: auth.getSession()?.user ?? get().user,
            profile: data.profile
              ? {
                  name: data.profile.name,
                  goal: data.profile.goal,
                  category: data.profile.category ?? "mixed",
                  equipment: data.profile.equipment,
                  equipmentMix: data.profile.equipmentMix,
                  equipmentPrefs: data.profile.equipmentPrefs,
                  experience: data.profile.experience,
                  daysPerWeek: data.profile.daysPerWeek,
                  sessionMinutes: data.profile.sessionMinutes,
                  bodyweightKg: data.profile.bodyweightKg,
                  units: data.profile.units,
                  notes: data.profile.notes,
                  heightCm: data.profile.heightCm,
                  age: data.profile.age,
                  sex: data.profile.sex,
                  activityLevel: data.profile.activityLevel,
                  dietGoal: data.profile.dietGoal,
                  dietRestrictions: data.profile.dietRestrictions,
                  cuisine: data.profile.cuisine,
                }
              : null,
            onboarded: data.profile?.onboarded ?? false,
            program: data.program,
            nutritionPlan: data.nutritionPlan ?? get().nutritionPlan,
            routines: data.routines,
            exercises: [...SEED_EXERCISES, ...customs],
            history: [...pendingLocal, ...data.workouts],
          });

          // Best-effort flush of anything queued offline.
          if (pendingLocal.length) void get().syncPending();
          // Pull billing tier/status from the accounts service (non-blocking).
          void get().loadSubscription();
        } catch (err) {
          if (err instanceof AuthExpiredError) get().logout();
          // Offline or transient error: keep the cached state, mark hydrated.
          set({ bootstrapped: true });
        } finally {
          set({ bootstrapping: false });
        }
      },

      skipBootstrap: () => set({ bootstrapped: true }),

      // ── AI / onboarding ─────────────────────────────────────────────────
      generateProgram: async (profile) => {
        const { program, routines } = await api.generateProgram(profile);
        const manual = get().routines.filter((r) => r.source === "manual");
        set({ profile, onboarded: true, program, routines: [...routines, ...manual] });
      },

      refreshProgram: async () => {
        const { program, routines, nutritionPlan } = await api.refreshProgram();
        const manual = get().routines.filter((r) => r.source === "manual");
        set({
          program,
          routines: [...routines, ...manual],
          // The refresh also evolves the diet — keep the old plan if it didn't.
          nutritionPlan: nutritionPlan ?? get().nutritionPlan,
        });
        return program.summary ?? "";
      },

      applyProgramUpdate: (program, aiRoutines) => {
        const manual = get().routines.filter((r) => r.source === "manual");
        set({ program, routines: [...aiRoutines, ...manual] });
      },

      // ── nutrition ───────────────────────────────────────────────────────
      generateNutrition: async (patch) => {
        const { nutritionPlan, profile } = await api.generateNutrition(patch);
        set((s) => ({ nutritionPlan, profile: profile ?? s.profile }));
      },

      // Persist the cuisine preference on the profile (server + local). Used by
      // Settings; the Nutrition tab patches it via generateNutrition + regenerate.
      setCuisine: (cuisine) => {
        const p = get().profile;
        if (!p) return;
        set({ profile: { ...p, cuisine } });
        void api.updateProfile({ cuisine }).catch(() => {});
      },

      logFood: (food) => {
        const today = todayKey();
        const entry: LoggedFood = {
          id: uid("food"),
          name: food.foodName,
          portion: food.portion,
          macros: food.macros,
          loggedAt: Date.now(),
        };
        set((s) => {
          const base: NutritionLog =
            s.nutritionLog && s.nutritionLog.date === today
              ? s.nutritionLog
              : { date: today, dayType: "training", checkedMeals: [] };
          return { nutritionLog: { ...base, extras: [...(base.extras ?? []), entry] } };
        });
      },

      removeLoggedFood: (id) => {
        const today = todayKey();
        set((s) => {
          if (!s.nutritionLog || s.nutritionLog.date !== today) return {};
          return {
            nutritionLog: {
              ...s.nutritionLog,
              extras: (s.nutritionLog.extras ?? []).filter((f) => f.id !== id),
            },
          };
        });
      },

      setNutritionDayType: (dayType) => {
        const today = todayKey();
        set((s) => {
          const existing =
            s.nutritionLog && s.nutritionLog.date === today ? s.nutritionLog : null;
          return {
            nutritionLog: {
              date: today,
              dayType,
              checkedMeals: existing?.checkedMeals ?? [],
            },
          };
        });
      },

      toggleMeal: (mealKey) => {
        const today = todayKey();
        set((s) => {
          const base: NutritionLog =
            s.nutritionLog && s.nutritionLog.date === today
              ? s.nutritionLog
              : { date: today, dayType: "training", checkedMeals: [] };
          const checked = base.checkedMeals.includes(mealKey)
            ? base.checkedMeals.filter((k) => k !== mealKey)
            : [...base.checkedMeals, mealKey];
          return { nutritionLog: { ...base, checkedMeals: checked } };
        });
      },

      // ── routines ────────────────────────────────────────────────────────
      saveRoutine: async (input) => {
        if (input.id) {
          const updated = await api.updateRoutine(input.id, {
            name: input.name,
            description: input.description,
            dayLabel: input.dayLabel,
            favorite: input.favorite,
            exercises: input.exercises,
          });
          set((s) => ({ routines: s.routines.map((r) => (r.id === updated.id ? updated : r)) }));
        } else {
          const created = await api.createRoutine({
            name: input.name,
            description: input.description,
            dayLabel: input.dayLabel,
            favorite: input.favorite,
            exercises: input.exercises,
          });
          set((s) => ({ routines: [...s.routines, created] }));
        }
      },

      deleteRoutine: async (id) => {
        set((s) => ({ routines: s.routines.filter((r) => r.id !== id) })); // optimistic
        try {
          await api.deleteRoutine(id);
        } catch {
          await get().bootstrap(); // resync on failure
        }
      },

      toggleFavorite: async (id) => {
        const routine = get().routines.find((r) => r.id === id);
        if (!routine) return;
        const favorite = !routine.favorite;
        set((s) => ({ routines: s.routines.map((r) => (r.id === id ? { ...r, favorite } : r)) }));
        try {
          await api.updateRoutine(id, { favorite });
        } catch {
          set((s) => ({ routines: s.routines.map((r) => (r.id === id ? { ...r, favorite: !favorite } : r)) }));
        }
      },

      // ── exercises ───────────────────────────────────────────────────────
      addCustomExercise: async (e) => {
        const exercise = await api.createExercise(e);
        set((s) => ({
          exercises: s.exercises.some((x) => x.id === exercise.id)
            ? s.exercises.map((x) => (x.id === exercise.id ? exercise : x))
            : [...s.exercises, exercise],
        }));
        return exercise;
      },

      receiveExercise: (exercise) => {
        set((s) => ({
          exercises: s.exercises.some((x) => x.id === exercise.id)
            ? s.exercises.map((x) => (x.id === exercise.id ? exercise : x))
            : [...s.exercises, exercise],
        }));
      },

      fetchExerciseGuide: async (e) => {
        const exercise = await api.exerciseGuide(e);
        set((s) => ({
          exercises: s.exercises.some((x) => x.id === exercise.id)
            ? s.exercises.map((x) => (x.id === exercise.id ? { ...x, ...exercise } : x))
            : [...s.exercises, exercise],
        }));
        return exercise;
      },

      toggleExerciseHidden: (id) =>
        set((s) => ({
          hiddenExerciseIds: s.hiddenExerciseIds.includes(id)
            ? s.hiddenExerciseIds.filter((x) => x !== id)
            : [...s.hiddenExerciseIds, id],
        })),

      // ── active workout ──────────────────────────────────────────────────
      startWorkout: (routine) => {
        const rest = get().settings.defaultRestSeconds;
        set({
          active: {
            id: uid("ses"),
            routineId: routine?.id,
            routineName: routine?.name ?? "Empty Workout",
            startedAt: Date.now(),
            exercises: routine ? routineToLoggedExercises(routine, get().history) : [],
            restTimer: { active: false, endsAt: null, durationSec: rest },
          },
        });
      },

      startWorkoutFromSession: (session) => {
        const rest = get().settings.defaultRestSeconds;
        // Re-seed the exercises but clear completion + per-set timing so the user
        // logs the new session fresh (keeping the planned weights/reps as targets).
        const exercises: LoggedExercise[] = session.exercises.map((ex) => ({
          exerciseId: ex.exerciseId,
          name: ex.name,
          muscleGroup: ex.muscleGroup,
          restSeconds: ex.restSeconds,
          kind: ex.kind ?? resolveKind(ex),
          sets: ex.sets.map((s) => ({
            weight: s.weight,
            reps: s.reps,
            completed: false,
            ...(s.durationSec ? { durationSec: s.durationSec } : {}),
            ...(s.distanceKm ? { distanceKm: s.distanceKm } : {}),
            ...(s.rpe != null ? { rpe: s.rpe } : {}),
          })),
        }));
        set({
          active: {
            id: uid("ses"),
            routineId: session.routineId,
            routineName: session.routineName,
            startedAt: Date.now(),
            exercises,
            restTimer: { active: false, endsAt: null, durationSec: rest },
          },
        });
      },

      logSet: (exIdx, setIdx, patch) =>
        set((s) => {
          if (!s.active) return {};
          const exercises = s.active.exercises.map((ex, i) =>
            i !== exIdx ? ex : { ...ex, sets: ex.sets.map((st, j) => (j === setIdx ? { ...st, ...patch } : st)) }
          );
          return { active: { ...s.active, exercises } };
        }),

      addSetToExercise: (exIdx) =>
        set((s) => {
          if (!s.active) return {};
          const exercises = s.active.exercises.map((ex, i) => {
            if (i !== exIdx) return ex;
            const last = ex.sets[ex.sets.length - 1];
            return {
              ...ex,
              sets: [
                ...ex.sets,
                {
                  weight: last?.weight ?? 0,
                  reps: last?.reps ?? 10,
                  completed: false,
                  ...(last?.rpe != null ? { rpe: last.rpe } : {}),
                },
              ],
            };
          });
          return { active: { ...s.active, exercises } };
        }),

      removeSet: (exIdx, setIdx) =>
        set((s) => {
          if (!s.active) return {};
          const exercises = s.active.exercises.map((ex, i) =>
            i !== exIdx ? ex : { ...ex, sets: ex.sets.filter((_, j) => j !== setIdx) }
          );
          return { active: { ...s.active, exercises } };
        }),

      addExerciseToActive: (exercise) =>
        set((s) => {
          if (!s.active) return {};
          const kind = exercise.muscleGroup === "Cardio" ? "cardio" : "strength";
          const last = lastLoggedSets(s.history, exercise.id)?.[0];
          const logged: LoggedExercise = {
            exerciseId: exercise.id,
            name: exercise.name,
            muscleGroup: exercise.muscleGroup,
            restSeconds: s.settings.defaultRestSeconds,
            kind,
            sets:
              kind === "cardio"
                ? [{ weight: 0, reps: 0, completed: false, durationSec: last?.durationSec ?? 0 }]
                : [
                    {
                      weight: last?.weight ?? 0,
                      reps: last?.reps ?? 10,
                      completed: false,
                      ...(last?.rpe != null ? { rpe: last.rpe } : {}),
                    },
                  ],
          };
          return { active: { ...s.active, exercises: [...s.active.exercises, logged] } };
        }),

      setActiveExerciseKind: (exIdx, kind) =>
        set((s) => {
          if (!s.active) return {};
          const exercises = s.active.exercises.map((ex, i) => {
            if (i !== exIdx) return ex;
            // Seed a sensible empty set for the new measurement type.
            const sets =
              kind === "strength"
                ? ex.sets.map((st) => ({ weight: st.weight, reps: st.reps || 10, completed: st.completed }))
                : ex.sets.map((st) => ({
                    weight: 0,
                    reps: 0,
                    completed: st.completed,
                    durationSec: st.durationSec ?? 0,
                  }));
            return { ...ex, kind, sets };
          });
          return { active: { ...s.active, exercises } };
        }),

      removeExerciseFromActive: (exIdx) =>
        set((s) => (s.active ? { active: { ...s.active, exercises: s.active.exercises.filter((_, i) => i !== exIdx) } } : {})),

      startRest: (seconds) =>
        set((s) =>
          s.active
            ? { active: { ...s.active, restTimer: { active: true, endsAt: Date.now() + seconds * 1000, durationSec: seconds } } }
            : {}
        ),

      stopRest: () =>
        set((s) => (s.active ? { active: { ...s.active, restTimer: { ...s.active.restTimer, active: false, endsAt: null } } } : {})),

      finishWorkout: async () => {
        const s = get();
        if (!s.active) return;
        const endedAt = Date.now();
        const durationSec = Math.round((endedAt - s.active.startedAt) / 1000);
        const bodyweightKg = s.profile?.bodyweightKg ?? undefined;
        const metMap = metMapFrom(s.exercises);
        const exercises = s.active.exercises
          .map((ex) => ({ ...ex, sets: ex.sets.filter((st) => st.completed) }))
          .filter((ex) => ex.sets.length > 0)
          .map((ex) => ({ ...ex, calories: estimateSessionCalories([ex], bodyweightKg, metMap) }));
        if (exercises.length === 0) {
          set({ active: null });
          return;
        }
        const clientId = s.active.id;
        const session: WorkoutSession = {
          id: clientId,
          clientId,
          routineId: s.active.routineId,
          routineName: s.active.routineName,
          startedAt: s.active.startedAt,
          endedAt,
          durationSec,
          exercises,
          totalVolume: sessionVolume(exercises),
          calories: estimateSessionCalories(exercises, bodyweightKg, metMap),
          synced: false,
        };
        set({ active: null, history: [session, ...s.history] });
        // Attempt immediate upload; if offline it stays queued.
        await get().syncPending();
        // Refine calories for any exercises the local MET table couldn't classify.
        void get().backfillSessionCalories(clientId);
      },

      cancelWorkout: () => set({ active: null }),

      receiveLoggedWorkout: (workout) =>
        set((s) => {
          const key = workout.clientId ?? workout.id;
          // Idempotent: replace if we've already got this session, else prepend.
          const exists = s.history.some((w) => (w.clientId ?? w.id) === key);
          return {
            history: exists
              ? s.history.map((w) => ((w.clientId ?? w.id) === key ? workout : w))
              : [workout, ...s.history],
          };
        }),

      saveManualSession: async (draft) => {
        const s = get();
        const bodyweightKg = s.profile?.bodyweightKg ?? undefined;
        const metMap = metMapFrom(s.exercises);
        // Stamp per-exercise calories + resolved kind so detail views and progress
        // treat a manual/cloned entry exactly like a live-logged one.
        const exercises: LoggedExercise[] = draft.exercises.map((ex) => ({
          ...ex,
          kind: ex.kind ?? resolveKind(ex),
          calories: estimateSessionCalories([ex], bodyweightKg, metMap),
        }));
        const clientId = uid("manual");
        const session: WorkoutSession = {
          id: clientId,
          clientId,
          routineName: draft.routineName || "Logged Workout",
          startedAt: draft.startedAt,
          endedAt: draft.startedAt + draft.durationSec * 1000,
          durationSec: draft.durationSec,
          exercises,
          totalVolume: sessionVolume(exercises),
          calories: estimateSessionCalories(exercises, bodyweightKg, metMap),
          notes: draft.notes,
          synced: false,
        };
        set({ history: [session, ...s.history].sort((a, b) => b.startedAt - a.startedAt) });
        await get().syncPending();
        void get().backfillSessionCalories(clientId);
      },

      updateManualSession: async (id, draft) => {
        const s = get();
        const existing = s.history.find((w) => w.id === id || w.clientId === id);
        if (!existing) return;
        const bodyweightKg = s.profile?.bodyweightKg ?? undefined;
        const metMap = metMapFrom(s.exercises);
        const exercises: LoggedExercise[] = draft.exercises.map((ex) => ({
          ...ex,
          kind: ex.kind ?? resolveKind(ex),
          calories: estimateSessionCalories([ex], bodyweightKg, metMap),
        }));
        const updated: WorkoutSession = {
          ...existing,
          routineName: draft.routineName || "Logged Workout",
          startedAt: draft.startedAt,
          endedAt: draft.startedAt + draft.durationSec * 1000,
          durationSec: draft.durationSec,
          exercises,
          totalVolume: sessionVolume(exercises),
          calories: estimateSessionCalories(exercises, bodyweightKg, metMap),
          notes: draft.notes ?? existing.notes,
          // Re-queue for sync; the server upsert keys on (user_id, client_id).
          synced: false,
        };
        set({
          history: s.history
            .map((w) => (w === existing ? updated : w))
            .sort((a, b) => b.startedAt - a.startedAt),
        });
        await get().syncPending();
        void get().backfillSessionCalories(existing.clientId ?? existing.id);
      },

      deleteWorkout: async (id) => {
        const target = get().history.find((w) => w.id === id || w.clientId === id);
        set((s) => ({ history: s.history.filter((w) => w.id !== id && w.clientId !== id) }));
        // Only synced sessions exist server-side; offline-only ones are already gone.
        if (target?.synced && auth.isAuthenticated()) {
          try {
            await api.deleteWorkout(target.id);
          } catch {
            /* best-effort; the optimistic local delete stands */
          }
        }
      },

      backfillSessionCalories: async (sessionId) => {
        if (!auth.isAuthenticated() || !navigator.onLine) return;
        const s = get();
        const session = s.history.find((w) => w.id === sessionId || w.clientId === sessionId);
        if (!session) return;
        const metMap = metMapFrom(s.exercises);
        // Only the exercises our local Compendium table can't classify need the AI.
        const targets = session.exercises.filter((ex) => needsAiMet(ex, metMap[ex.exerciseId]));
        if (!targets.length) return;

        const resolved: Record<string, number> = {};
        await Promise.all(
          targets.map(async (ex) => {
            try {
              const r = await api.exerciseMet({ name: ex.name, muscleGroup: ex.muscleGroup, kind: ex.kind });
              if (r.met > 0) resolved[ex.exerciseId] = r.met;
            } catch {
              /* leave the generic estimate in place */
            }
          })
        );
        if (!Object.keys(resolved).length) return;

        set((st) => {
          // Merge the resolved METs into the exercise library (update or add).
          const exercises = [...st.exercises];
          for (const [slug, met] of Object.entries(resolved)) {
            const idx = exercises.findIndex((e) => e.id === slug);
            if (idx >= 0) exercises[idx] = { ...exercises[idx], met };
            else {
              const le = session.exercises.find((e) => e.exerciseId === slug);
              if (le)
                exercises.push({
                  id: slug,
                  name: le.name,
                  muscleGroup: le.muscleGroup,
                  equipment: "Other",
                  isCustom: false,
                  met,
                });
            }
          }
          // Recompute the affected session's calories with the improved METs.
          const updatedMap = metMapFrom(exercises);
          const bw = st.profile?.bodyweightKg ?? undefined;
          const history = st.history.map((w) => {
            if (w.id !== session.id) return w;
            const exs = w.exercises.map((e) => ({
              ...e,
              calories: estimateSessionCalories([e], bw, updatedMap),
            }));
            return { ...w, exercises: exs, calories: estimateSessionCalories(exs, bw, updatedMap), synced: false };
          });
          return { exercises, history };
        });
        await get().syncPending();
      },

      syncPending: async () => {
        if (!auth.isAuthenticated() || !navigator.onLine) return;
        const pending = get().history.filter((w) => !w.synced);
        if (pending.length === 0) return;
        try {
          const saved = await api.saveWorkouts(pending.map(workoutToApi));
          const byClient = new Map(saved.map((w) => [w.clientId, w]));
          set((s) => ({
            history: s.history.map((w) => {
              const match = byClient.get(w.clientId ?? w.id);
              return match ? { ...match } : w;
            }),
          }));
        } catch {
          /* stay queued; retried on next connectivity/bootstrap */
        }
      },

      // ── settings ────────────────────────────────────────────────────────
      setSetting: (key, value) => set((s) => ({ settings: { ...s.settings, [key]: value } })),
      setUnits: (units) => {
        const p = get().profile;
        if (!p) return;
        set({ profile: { ...p, units } });
        void api.updateProfile({ units }).catch(() => {});
      },
      setEquipmentPref: (category, value) => {
        const p = get().profile;
        if (!p) return;
        const prevPrefs = p.equipmentPrefs;
        const equipmentPrefs = { ...p.equipmentPrefs };
        if (value === undefined) delete equipmentPrefs[category];
        else equipmentPrefs[category] = value;
        set({ profile: { ...p, equipmentPrefs } });
        api.updateProfile({ equipmentPrefs }).catch((err) => {
          // The save failed server-side (e.g. the equipment_prefs DB column
          // hasn't been migrated yet) — undo the optimistic flip instead of
          // silently pretending it persisted, and say so.
          const cur = get().profile;
          if (cur) set({ profile: { ...cur, equipmentPrefs: prevPrefs } });
          toast.error(
            err instanceof Error ? `Couldn't save: ${err.message}` : "Couldn't save that change"
          );
        });
      },
    }),
    {
      name: "forgefit-store-v2",
      partialize: (s) => ({
        profile: s.profile,
        onboarded: s.onboarded,
        exercises: s.exercises,
        hiddenExerciseIds: s.hiddenExerciseIds,
        routines: s.routines,
        program: s.program,
        nutritionPlan: s.nutritionPlan,
        nutritionLog: s.nutritionLog,
        history: s.history,
        active: s.active,
        subscription: s.subscription,
        settings: s.settings,
        user: s.user,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) state.hydrated = true;
      },
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        const seedIds = new Set(SEED_EXERCISES.map((e) => e.id));
        const customs = (p.exercises ?? []).filter((e) => !seedIds.has(e.id));
        return {
          ...current,
          ...p,
          exercises: [...SEED_EXERCISES, ...customs],
          // Merge settings field-by-field so newly-added defaults (e.g. the
          // Smart Rep Counter prefs) survive for users with older saved state.
          settings: { ...current.settings, ...(p.settings ?? {}) },
        };
      },
    }
  )
);
