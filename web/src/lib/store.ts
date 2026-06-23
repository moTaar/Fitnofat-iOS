import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  ActiveWorkout, Exercise, LoggedExercise, Program, Routine,
  UserProfile, WorkoutSession,
} from "./types";
import { SEED_EXERCISES } from "./exercises";
import { sessionVolume, uid } from "./utils";
import { api, auth, AuthExpiredError, type Session } from "./api";

interface Settings {
  theme: "dark" | "light";
  defaultRestSeconds: number;
  remindersEnabled: boolean;
}

interface AppState {
  hydrated: boolean;
  bootstrapped: boolean;
  user: Session["user"] | null;
  profile: UserProfile | null;
  onboarded: boolean;
  exercises: Exercise[];
  routines: Routine[];
  program: Program | null;
  history: WorkoutSession[];
  active: ActiveWorkout | null;
  settings: Settings;

  // auth
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => void;
  bootstrap: () => Promise<void>;

  // AI / onboarding
  generateProgram: (profile: UserProfile) => Promise<void>;
  refreshProgram: () => Promise<string>;
  applyProgramUpdate: (program: Program, aiRoutines: Routine[]) => void;

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
  fetchExerciseGuide: (e: { name: string; muscleGroup?: Exercise["muscleGroup"]; equipment?: string; force?: boolean }) => Promise<Exercise>;

  // active workout
  startWorkout: (routine?: Routine) => void;
  logSet: (exIdx: number, setIdx: number, patch: Partial<{ weight: number; reps: number; completed: boolean }>) => void;
  addSetToExercise: (exIdx: number) => void;
  removeSet: (exIdx: number, setIdx: number) => void;
  addExerciseToActive: (exercise: Exercise) => void;
  removeExerciseFromActive: (exIdx: number) => void;
  startRest: (seconds: number) => void;
  stopRest: () => void;
  finishWorkout: () => Promise<void>;
  cancelWorkout: () => void;
  syncPending: () => Promise<void>;

  // settings
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  setUnits: (units: "kg" | "lb") => void;
}

function routineToLoggedExercises(routine: Routine): LoggedExercise[] {
  return routine.exercises.map((re) => ({
    exerciseId: re.exerciseId,
    name: re.name,
    muscleGroup: re.muscleGroup,
    restSeconds: re.restSeconds,
    sets: re.sets.map((s) => ({
      weight: s.targetWeight ?? 0,
      reps: s.targetReps,
      completed: false,
    })),
  }));
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
    notes: w.notes,
    exercises: w.exercises,
  };
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      bootstrapped: false,
      user: auth.getSession()?.user ?? null,
      profile: null,
      onboarded: false,
      exercises: SEED_EXERCISES,
      routines: [],
      program: null,
      history: [],
      active: null,
      settings: { theme: "dark", defaultRestSeconds: 90, remindersEnabled: false },

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
          history: [],
          active: null,
          exercises: SEED_EXERCISES,
        });
      },

      bootstrap: async () => {
        if (!auth.isAuthenticated()) return;
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
                  experience: data.profile.experience,
                  daysPerWeek: data.profile.daysPerWeek,
                  sessionMinutes: data.profile.sessionMinutes,
                  bodyweightKg: data.profile.bodyweightKg,
                  units: data.profile.units,
                  notes: data.profile.notes,
                }
              : null,
            onboarded: data.profile?.onboarded ?? false,
            program: data.program,
            routines: data.routines,
            exercises: [...SEED_EXERCISES, ...customs],
            history: [...pendingLocal, ...data.workouts],
          });

          // Best-effort flush of anything queued offline.
          if (pendingLocal.length) void get().syncPending();
        } catch (err) {
          if (err instanceof AuthExpiredError) get().logout();
          // Offline or transient error: keep the cached state, mark hydrated.
          set({ bootstrapped: true });
        }
      },

      // ── AI / onboarding ─────────────────────────────────────────────────
      generateProgram: async (profile) => {
        const { program, routines } = await api.generateProgram(profile);
        const manual = get().routines.filter((r) => r.source === "manual");
        set({ profile, onboarded: true, program, routines: [...routines, ...manual] });
      },

      refreshProgram: async () => {
        const { program, routines } = await api.refreshProgram();
        const manual = get().routines.filter((r) => r.source === "manual");
        set({ program, routines: [...routines, ...manual] });
        return program.summary ?? "";
      },

      applyProgramUpdate: (program, aiRoutines) => {
        const manual = get().routines.filter((r) => r.source === "manual");
        set({ program, routines: [...aiRoutines, ...manual] });
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

      fetchExerciseGuide: async (e) => {
        const exercise = await api.exerciseGuide(e);
        set((s) => ({
          exercises: s.exercises.some((x) => x.id === exercise.id)
            ? s.exercises.map((x) => (x.id === exercise.id ? { ...x, ...exercise } : x))
            : [...s.exercises, exercise],
        }));
        return exercise;
      },

      // ── active workout ──────────────────────────────────────────────────
      startWorkout: (routine) => {
        const rest = get().settings.defaultRestSeconds;
        set({
          active: {
            id: uid("ses"),
            routineId: routine?.id,
            routineName: routine?.name ?? "Empty Workout",
            startedAt: Date.now(),
            exercises: routine ? routineToLoggedExercises(routine) : [],
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
            return { ...ex, sets: [...ex.sets, { weight: last?.weight ?? 0, reps: last?.reps ?? 10, completed: false }] };
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
          const logged: LoggedExercise = {
            exerciseId: exercise.id,
            name: exercise.name,
            muscleGroup: exercise.muscleGroup,
            restSeconds: s.settings.defaultRestSeconds,
            sets: [{ weight: 0, reps: 10, completed: false }],
          };
          return { active: { ...s.active, exercises: [...s.active.exercises, logged] } };
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
        const exercises = s.active.exercises
          .map((ex) => ({ ...ex, sets: ex.sets.filter((st) => st.completed) }))
          .filter((ex) => ex.sets.length > 0);
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
          synced: false,
        };
        set({ active: null, history: [session, ...s.history] });
        // Attempt immediate upload; if offline it stays queued.
        await get().syncPending();
      },

      cancelWorkout: () => set({ active: null }),

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
    }),
    {
      name: "forgefit-store-v2",
      partialize: (s) => ({
        profile: s.profile,
        onboarded: s.onboarded,
        exercises: s.exercises,
        routines: s.routines,
        program: s.program,
        history: s.history,
        active: s.active,
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
        return { ...current, ...p, exercises: [...SEED_EXERCISES, ...customs] };
      },
    }
  )
);
