import { Router } from "express";
import { z } from "zod";
import { supabaseAdmin } from "../supabase";
import { asyncHandler, requireAuth, AuthedRequest } from "../middleware";
import { requireEntitlement } from "../entitlements";
import { aiLimiter, aiQuota, readUsage, videoLimiter, claimYoutubeSearch } from "../ratelimit";
import { readShared, writeShared, readSharedVideos, writeSharedVideos, recordVideoPick } from "../aicache";
import { searchExerciseVideos, rankVideos, dedupeSearch, unavailableReason, youtubeConfigured } from "../youtube";
import { config } from "../config";
import { generateProgram, refreshProgram, chatOnboarding, chatCoach, generateExerciseGuide, identifyExercise, estimateMet, type ChatMessage, type LoggedWorkoutDraft } from "../gemini";
import { generateNutritionPlan, lookupFood, type RoutineLite } from "../nutrition";
import { buildRefreshSummary, SessionLite } from "../analytics";
import { estimateExerciseCalories, needsAiMet, metFromName } from "../calories";
import { slugify } from "../util";
import {
  aiRoutinesToRows, profileToRow, rowToExercise, rowToProfile,
  rowToProgram, rowToRoutine, rowToWorkout, rowToNutritionPlan,
} from "../mappers";
import type { Cuisine, NutritionPlanData, UserProfile } from "../types";

const CUISINES = ["standard", "french", "italian", "korean", "mediterranean", "mexican", "japanese"] as const;

export const dataRouter = Router();
dataRouter.use(requireAuth);

const uid = (req: AuthedRequest) => req.userId;

// ── validation schemas ────────────────────────────────────────────────────
const profileSchema = z.object({
  name: z.string().optional(),
  goal: z.enum(["strength", "hypertrophy", "weight_loss", "endurance", "general"]),
  equipment: z.enum(["full_gym", "home_gym", "dumbbells", "bodyweight", "resistance_bands", "machines", "kettlebells", "mixed", "other"]),
  equipmentMix: z.array(z.string()).optional(),
  equipmentPrefs: z
    .object({
      bands: z.enum(["include", "exclude"]).optional(),
      freeWeights: z.enum(["include", "exclude"]).optional(),
      machines: z.enum(["include", "exclude"]).optional(),
    })
    .optional(),
  experience: z.enum(["beginner", "intermediate", "advanced"]),
  category: z.enum(["calisthenics", "weightlifting", "cardio", "yoga_pilates", "mixed", "other"]).optional().default("mixed"),
  daysPerWeek: z.number().int().min(1).max(7),
  sessionMinutes: z.number().int().min(10).max(240),
  bodyweightKg: z.number().optional(),
  units: z.enum(["kg", "lb"]),
  notes: z.string().optional(),
  // metabolic data for the nutrition planner
  heightCm: z.number().positive().optional(),
  age: z.number().int().positive().max(120).optional(),
  sex: z.enum(["male", "female", "other"]).optional(),
  activityLevel: z.enum(["sedentary", "light", "moderate", "very_active"]).optional(),
  dietGoal: z.enum(["lean_gain", "recomp", "maintain", "deficit", "aggressive_deficit"]).optional(),
  dietRestrictions: z.array(z.string()).optional(),
  cuisine: z.enum(CUISINES).optional(),
});

const plannedSet = z.object({
  targetReps: z.number(),
  targetWeight: z.number().optional(),
  rpe: z.number().optional(),
});
const routineExercise = z.object({
  exerciseId: z.string(),
  name: z.string(),
  muscleGroup: z.string(),
  sets: z.array(plannedSet),
  restSeconds: z.number(),
  notes: z.string().optional(),
});
const routineSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  dayLabel: z.string().optional(),
  favorite: z.boolean().optional(),
  exercises: z.array(routineExercise),
});

const loggedSet = z.object({
  weight: z.number(),
  reps: z.number(),
  completed: z.boolean(),
  durationSec: z.number().optional(),
  distanceKm: z.number().optional(),
  rpe: z.number().optional(),
});
const workoutSchema = z.object({
  clientId: z.string(),
  routineId: z.string().optional().nullable(),
  routineName: z.string(),
  startedAt: z.number(),
  endedAt: z.number().optional(),
  durationSec: z.number(),
  totalVolume: z.number(),
  calories: z.number().optional(),
  notes: z.string().optional(),
  exercises: z.array(
    z.object({
      exerciseId: z.string(),
      name: z.string(),
      muscleGroup: z.string(),
      restSeconds: z.number(),
      kind: z.enum(["strength", "cardio", "hold"]).optional(),
      calories: z.number().optional(),
      sets: z.array(loggedSet),
    })
  ),
});

// ── helpers ───────────────────────────────────────────────────────────────
async function loadProfile(userId: string): Promise<(UserProfile & { onboarded: boolean }) | null> {
  const { data } = await supabaseAdmin.from("profiles").select("*").eq("user_id", userId).maybeSingle();
  return data ? rowToProfile(data) : null;
}

async function loadRoutines(userId: string) {
  const { data } = await supabaseAdmin
    .from("routines").select("*").eq("user_id", userId).order("position", { ascending: true });
  return (data ?? []).map(rowToRoutine);
}

async function loadLatestProgram(userId: string, aiRoutineIds: string[]) {
  const { data } = await supabaseAdmin
    .from("programs").select("*").eq("user_id", userId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data ? rowToProgram(data, aiRoutineIds) : null;
}

async function loadLatestNutritionPlan(userId: string) {
  const { data } = await supabaseAdmin
    .from("nutrition_plans").select("*").eq("user_id", userId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data ? rowToNutritionPlan(data) : null;
}

// Generate + persist a nutrition plan from the athlete's profile and the
// exercises/volume in their current routines. Bumps iteration each time.
async function persistNutritionPlan(
  userId: string,
  profile: UserProfile,
  routines: RoutineLite[],
  analytics?: string,
  cuisine?: Cuisine
) {
  const data: NutritionPlanData = await generateNutritionPlan(profile, routines, analytics, cuisine);

  const { data: last } = await supabaseAdmin
    .from("nutrition_plans").select("iteration").eq("user_id", userId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const iteration = (last?.iteration ?? 0) + 1;

  const { data: row, error } = await supabaseAdmin
    .from("nutrition_plans")
    .insert({
      user_id: userId,
      iteration,
      strategy: data.strategy,
      summary: data.summary,
      plan: data,
    })
    .select().single();
  if (error || !row) throw new Error(error?.message ?? "Failed to save nutrition plan");
  return rowToNutritionPlan(row);
}

// The current routines reshaped for the nutrition planner.
async function loadRoutinesLite(userId: string): Promise<RoutineLite[]> {
  const routines = await loadRoutines(userId);
  return routines.map((r) => ({ name: r.name, dayLabel: r.dayLabel, exercises: r.exercises }));
}

// Persist a freshly generated/evolved program: replace AI routines, bump iteration.
async function persistProgram(userId: string, profile: UserProfile, ai: Awaited<ReturnType<typeof generateProgram>>) {
  const { data: last } = await supabaseAdmin
    .from("programs").select("iteration").eq("user_id", userId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const iteration = (last?.iteration ?? 0) + 1;

  const { data: programRow, error: progErr } = await supabaseAdmin
    .from("programs")
    .insert({
      user_id: userId,
      name: ai.programName,
      weeks: ai.weeks,
      goal: profile.goal,
      iteration,
      summary: ai.summary,
    })
    .select().single();
  if (progErr || !programRow) throw new Error(progErr?.message ?? "Failed to save program");

  // Replace existing AI routines.
  await supabaseAdmin.from("routines").delete().eq("user_id", userId).eq("source", "ai");
  const rows = aiRoutinesToRows(userId, programRow.id, ai);
  const { data: routineRows, error: rErr } = await supabaseAdmin
    .from("routines").insert(rows).select();
  if (rErr) throw new Error(rErr.message);

  const routines = (routineRows ?? []).map(rowToRoutine);
  return {
    program: rowToProgram(programRow, routines.map((r) => r.id)),
    routines,
  };
}

// Persist a workout the AI coach reconstructed from the athlete's free-text
// description ("I biked an hour and did 5 tibetans"). Mirrors the shape the
// client's finishWorkout produces so it shows up identically in History.
// Persist AI-resolved METs into the exercises table: update the row if the
// exercise already exists (preserving its guide/source), else insert a light
// library entry. Best-effort — a cache miss just means we re-resolve next time.
async function cacheResolvedMets(
  userId: string,
  resolved: Map<string, { name: string; muscleGroup: string; equipment: string; met: number }>,
  existingSlugs: Set<string>
) {
  if (!resolved.size) return;
  const inserts: any[] = [];
  for (const [slug, v] of resolved) {
    if (existingSlugs.has(slug)) {
      await supabaseAdmin.from("exercises").update({ met: v.met }).eq("user_id", userId).eq("slug", slug);
    } else {
      inserts.push({
        user_id: userId,
        slug,
        name: v.name,
        muscle_group: v.muscleGroup,
        equipment: v.equipment,
        met: v.met,
        source: "ai",
      });
    }
  }
  if (inserts.length) {
    await supabaseAdmin.from("exercises").upsert(inserts, { onConflict: "user_id,slug" });
  }
}

async function persistLoggedWorkout(
  userId: string,
  draft: LoggedWorkoutDraft,
  bodyweightKg?: number | null
) {
  const endedAt = Date.now();
  const startedAt = endedAt - (draft.durationSec || 0) * 1000;

  // Pull any METs we've already resolved for these exercises so repeats reuse
  // them for free (no AI). Keyed by slug.
  const slugs = [...new Set(draft.exercises.map((e) => slugify(e.name)))];
  const { data: knownRows } = await supabaseAdmin
    .from("exercises")
    .select("slug,met")
    .eq("user_id", userId)
    .in("slug", slugs);
  const metBySlug = new Map<string, number>();
  for (const r of knownRows ?? []) if (r.met != null) metBySlug.set(r.slug, Number(r.met));

  // METs we newly resolve via AI this call — persisted afterwards so they're
  // cached for next time (and for the client's offline calculator).
  const newlyResolved = new Map<string, { name: string; muscleGroup: string; equipment: string; met: number }>();

  const exercises: any[] = [];
  for (const e of draft.exercises) {
    const slug = slugify(e.name);
    const sets = e.sets.map((s) => ({
      weight: s.weight,
      reps: s.reps,
      completed: true,
      ...(s.durationSec ? { durationSec: s.durationSec } : {}),
      ...(s.distanceKm ? { distanceKm: s.distanceKm } : {}),
      ...(s.rpe ? { rpe: s.rpe } : {}),
    }));
    const exercise = {
      exerciseId: slug,
      name: e.name,
      muscleGroup: e.muscleGroup,
      kind: e.kind,
      restSeconds: e.restSeconds,
      notes: e.notes,
      sets,
    };

    // Resolve MET: cached → deterministic table → AI (only when truly unknown).
    let knownMet = metBySlug.get(slug) ?? null;
    if (knownMet == null && needsAiMet(exercise)) {
      const aiMet = await estimateMet(e.name, e.equipment, e.kind);
      if (aiMet > 0) {
        knownMet = aiMet;
        newlyResolved.set(slug, {
          name: e.name,
          muscleGroup: e.muscleGroup,
          equipment: e.equipment ?? "Other",
          met: aiMet,
        });
      }
    }

    exercises.push({
      ...exercise,
      calories: estimateExerciseCalories(exercise, bodyweightKg ?? undefined, knownMet),
    });
  }

  // Cache the freshly-resolved METs so future logs (and the client) reuse them.
  await cacheResolvedMets(userId, newlyResolved, new Set((knownRows ?? []).map((r) => r.slug)));
  const totalVolume = exercises.reduce(
    (sum, ex) => sum + ex.sets.reduce((v: number, s: any) => v + s.weight * s.reps, 0),
    0
  );
  const calories = exercises.reduce((sum, ex) => sum + (ex.calories ?? 0), 0);
  const clientId = `coachlog_${endedAt}_${Math.random().toString(36).slice(2, 8)}`;
  const { data, error } = await supabaseAdmin
    .from("workouts")
    .insert({
      user_id: userId,
      client_id: clientId,
      routine_id: null,
      routine_name: draft.routineName,
      started_at: new Date(startedAt).toISOString(),
      ended_at: new Date(endedAt).toISOString(),
      duration_sec: draft.durationSec,
      total_volume: totalVolume,
      calories,
      notes: "Logged via AI Coach",
      exercises,
    })
    .select()
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to save logged workout");
  return rowToWorkout(data);
}

// ── GET /bootstrap : everything the client needs to hydrate ──────────────────
dataRouter.get(
  "/bootstrap",
  asyncHandler(async (req, res) => {
    const userId = uid(req as AuthedRequest);
    // Only a recent window of history ships on cold start. A user with years of
    // sessions would otherwise pay for all of them on every launch — and the
    // client mirrors this payload into localStorage, which has a hard ~5MB cap.
    // Older sessions load on demand via GET /workouts (see below).
    const since = new Date(Date.now() - config.bootstrapHistoryDays * 86_400_000).toISOString();
    const [profile, routines, exercisesRes, workoutsRes, totalRes] = await Promise.all([
      loadProfile(userId),
      loadRoutines(userId),
      supabaseAdmin.from("exercises").select("*").eq("user_id", userId),
      supabaseAdmin
        .from("workouts")
        .select("*")
        .eq("user_id", userId)
        .gte("started_at", since)
        .order("started_at", { ascending: false }),
      supabaseAdmin
        .from("workouts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId),
    ]);
    const aiRoutineIds = routines.filter((r) => r.source === "ai").map((r) => r.id);
    const [program, nutritionPlan] = await Promise.all([
      loadLatestProgram(userId, aiRoutineIds),
      loadLatestNutritionPlan(userId),
    ]);
    const workouts = (workoutsRes.data ?? []).map(rowToWorkout);
    res.json({
      profile,
      program,
      nutritionPlan,
      routines,
      exercises: (exercisesRes.data ?? []).map(rowToExercise),
      workouts,
      history: {
        windowDays: config.bootstrapHistoryDays,
        returned: workouts.length,
        total: totalRes.count ?? workouts.length,
        // Tells the client whether the History page needs to offer "load older".
        hasMore: (totalRes.count ?? 0) > workouts.length,
      },
    });
  })
);

// ── GET /workouts : paged history, for anything outside the bootstrap window ──
dataRouter.get(
  "/workouts",
  asyncHandler(async (req, res) => {
    const userId = uid(req as AuthedRequest);
    const q = z
      .object({
        before: z.coerce.number().int().positive().optional(), // epoch ms, exclusive
        limit: z.coerce.number().int().min(1).max(200).optional(),
      })
      .parse(req.query);
    const limit = q.limit ?? 100;

    let query = supabaseAdmin
      .from("workouts")
      .select("*")
      .eq("user_id", userId)
      .order("started_at", { ascending: false })
      .limit(limit + 1);
    if (q.before) query = query.lt("started_at", new Date(q.before).toISOString());

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    const page = rows.slice(0, limit).map(rowToWorkout);
    res.json({ workouts: page, hasMore: rows.length > limit });
  })
);

// ── GET /ai/usage : today's AI allowance, so the UI can show what's left ──────
dataRouter.get(
  "/ai/usage",
  asyncHandler(async (req, res) => {
    const userId = uid(req as AuthedRequest);
    res.json({ used: await readUsage(userId), limits: config.aiDailyQuota });
  })
);

// ── PUT /profile ─────────────────────────────────────────────────────────────
dataRouter.put(
  "/profile",
  asyncHandler(async (req, res) => {
    const userId = uid(req as AuthedRequest);
    const body = profileSchema.partial().parse(req.body);
    const { data, error } = await supabaseAdmin
      .from("profiles").upsert(profileToRow(userId, body)).select().single();
    if (error) throw new Error(error.message);
    res.json(rowToProfile(data));
  })
);

// ── POST /program/generate : onboarding → AI program ─────────────────────────
dataRouter.post(
  "/program/generate",
  aiLimiter,
  aiQuota("program_generate"),
  asyncHandler(async (req, res) => {
    const userId = uid(req as AuthedRequest);
    const profile = profileSchema.parse(req.body) as UserProfile;

    await supabaseAdmin.from("profiles").upsert(profileToRow(userId, { ...profile, onboarded: true }));
    const ai = await generateProgram(profile);
    const result = await persistProgram(userId, profile, ai);
    res.json(result);
  })
);

// ── POST /program/refresh : adaptive evolution ───────────────────────────────
dataRouter.post(
  "/program/refresh",
  aiLimiter,
  requireEntitlement("program_refresh"),
  asyncHandler(async (req, res) => {
    const userId = uid(req as AuthedRequest);
    const profile = await loadProfile(userId);
    if (!profile) {
      res.status(400).json({ error: "Complete onboarding first" });
      return;
    }
    const { data: workouts } = await supabaseAdmin
      .from("workouts").select("*").eq("user_id", userId).order("started_at", { ascending: false });
    const history: SessionLite[] = (workouts ?? []).map((w) => ({
      startedAt: new Date(w.started_at).getTime(),
      totalVolume: Number(w.total_volume),
      exercises: w.exercises ?? [],
    }));
    const summary = buildRefreshSummary(history, profile);
    const ai = await refreshProgram(profile, summary);
    const result = await persistProgram(userId, profile, ai);

    // Dynamic adaptation loop: the training program just evolved, so re-scale the
    // diet to match the new metabolic demand. The freshly persisted AI routines
    // feed the planner; the same progress analytics fine-tune calories/carbs.
    let nutritionPlan = null;
    try {
      const routinesLite: RoutineLite[] = result.routines.map((r) => ({
        name: r.name, dayLabel: r.dayLabel, exercises: r.exercises,
      }));
      nutritionPlan = await persistNutritionPlan(userId, profile, routinesLite, summary, profile.cuisine);
    } catch {
      // Nutrition is best-effort here — never fail a program refresh over it.
    }
    res.json({ ...result, nutritionPlan });
  })
);

// ── POST /nutrition/generate : build/evolve the diet plan on demand ───────────
dataRouter.post(
  "/nutrition/generate",
  aiLimiter,
  requireEntitlement("ai_nutrition"),
  asyncHandler(async (req, res) => {
    const userId = uid(req as AuthedRequest);
    const profile = await loadProfile(userId);
    if (!profile) {
      res.status(400).json({ error: "Complete onboarding first" });
      return;
    }
    // Optional metabolic fields can be sent to patch the profile before planning
    // (lets the Nutrition tab capture height/age/activity/diet goal/cuisine inline).
    // `cuisine` is a persisted profile field, so the chosen style survives refresh
    // and is honoured by every later regeneration (including program refresh).
    const patch = profileSchema.partial().parse(req.body ?? {});
    let effective: UserProfile & { onboarded: boolean } = profile;
    if (Object.keys(patch).length) {
      const { data } = await supabaseAdmin
        .from("profiles").upsert(profileToRow(userId, patch)).select().single();
      if (data) effective = rowToProfile(data);
    }

    const routines = await loadRoutinesLite(userId);
    const plan = await persistNutritionPlan(userId, effective, routines, undefined, effective.cuisine);
    res.json({ nutritionPlan: plan, profile: effective });
  })
);

// ── POST /nutrition/lookup : AI-verified nutritional lookup ("L'apport nutritif") ──
dataRouter.post(
  "/nutrition/lookup",
  aiLimiter,
  aiQuota("nutrition_lookup"),
  asyncHandler(async (req, res) => {
    const { query } = z.object({ query: z.string().min(1).max(200) }).parse(req.body);
    const result = await lookupFood(query);
    res.json({ result });
  })
);

// ── Routines CRUD ────────────────────────────────────────────────────────────
dataRouter.post(
  "/routines",
  asyncHandler(async (req, res) => {
    const userId = uid(req as AuthedRequest);
    const body = routineSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from("routines")
      .insert({
        user_id: userId,
        name: body.name,
        description: body.description ?? null,
        day_label: body.dayLabel ?? null,
        favorite: body.favorite ?? false,
        source: "manual",
        position: 999,
        exercises: body.exercises,
      })
      .select().single();
    if (error) throw new Error(error.message);
    res.status(201).json(rowToRoutine(data));
  })
);

dataRouter.put(
  "/routines/:id",
  asyncHandler(async (req, res) => {
    const userId = uid(req as AuthedRequest);
    const body = routineSchema.partial().parse(req.body);
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description;
    if (body.dayLabel !== undefined) patch.day_label = body.dayLabel;
    if (body.favorite !== undefined) patch.favorite = body.favorite;
    if (body.exercises !== undefined) patch.exercises = body.exercises;
    const { data, error } = await supabaseAdmin
      .from("routines").update(patch).eq("id", req.params.id).eq("user_id", userId).select().single();
    if (error) throw new Error(error.message);
    res.json(rowToRoutine(data));
  })
);

dataRouter.delete(
  "/routines/:id",
  asyncHandler(async (req, res) => {
    const userId = uid(req as AuthedRequest);
    const { error } = await supabaseAdmin
      .from("routines").delete().eq("id", req.params.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    res.status(204).end();
  })
);

// ── Custom exercises ─────────────────────────────────────────────────────────
dataRouter.post(
  "/exercises",
  asyncHandler(async (req, res) => {
    const userId = uid(req as AuthedRequest);
    const body = z
      .object({ name: z.string().min(1), muscleGroup: z.string(), equipment: z.string() })
      .parse(req.body);
    const { data, error } = await supabaseAdmin
      .from("exercises")
      .upsert(
        {
          user_id: userId,
          slug: slugify(body.name),
          name: body.name,
          muscle_group: body.muscleGroup,
          equipment: body.equipment,
        },
        { onConflict: "user_id,slug" }
      )
      .select().single();
    if (error) throw new Error(error.message);
    res.status(201).json(rowToExercise(data));
  })
);

// ── AI exercise assist (name → muscle group + equipment + guide in one shot) ──
dataRouter.post(
  "/exercises/ai-assist",
  aiLimiter,
  requireEntitlement("ai_exercise"),
  asyncHandler(async (req, res) => {
    const userId = uid(req as AuthedRequest);
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body);
    const slug = slugify(name);

    // Return cached result if we already have a fully AI-identified entry.
    const { data: existing } = await supabaseAdmin
      .from("exercises")
      .select("*")
      .eq("user_id", userId)
      .eq("slug", slug)
      .maybeSingle();
    if (existing?.guide && existing?.muscle_group && existing?.equipment) {
      res.json(rowToExercise(existing));
      return;
    }

    // Shared cache next: this movement may already have been identified for a
    // different user. Classification and guides describe the exercise, not the
    // athlete, so there is nothing user-specific to regenerate.
    const shared = await readShared(slug);
    let muscleGroup: string;
    let equipment: string;
    let guide: Awaited<ReturnType<typeof identifyExercise>>["guide"];
    if (shared?.guide && shared.muscleGroup && shared.equipment) {
      muscleGroup = shared.muscleGroup;
      equipment = shared.equipment;
      guide = shared.guide;
    } else {
      ({ muscleGroup, equipment, guide } = await identifyExercise(name));
      await writeShared({ slug, name, muscleGroup, equipment, guide });
    }

    const { data, error } = await supabaseAdmin
      .from("exercises")
      .upsert(
        {
          user_id: userId,
          slug,
          name,
          muscle_group: muscleGroup,
          equipment,
          guide,
          source: "custom",
        },
        { onConflict: "user_id,slug" }
      )
      .select()
      .single();
    if (error) throw new Error(error.message);
    res.status(201).json(rowToExercise(data));
  })
);

// ── AI exercise how-to guide (lazy: generated + cached on first view) ─────────
dataRouter.post(
  "/exercises/guide",
  aiLimiter,
  requireEntitlement("ai_exercise"),
  asyncHandler(async (req, res) => {
    const userId = uid(req as AuthedRequest);
    const body = z
      .object({
        name: z.string().min(1),
        muscleGroup: z.string().optional(),
        equipment: z.string().optional(),
        force: z.boolean().optional(),
      })
      .parse(req.body);
    const slug = slugify(body.name);

    // Return the cached guide if we've already generated it for this user
    // (unless the caller explicitly forces a regeneration).
    const { data: existing } = await supabaseAdmin
      .from("exercises")
      .select("*")
      .eq("user_id", userId)
      .eq("slug", slug)
      .maybeSingle();
    if (existing?.guide && !body.force) {
      res.json(rowToExercise(existing));
      return;
    }

    // Shared cache before paying for a generation — unless the caller forced one.
    const sharedGuide = body.force ? null : await readShared(slug);
    const guide = sharedGuide?.guide
      ? sharedGuide.guide
      : await generateExerciseGuide(body.name, body.muscleGroup, body.equipment);
    if (!sharedGuide?.guide) {
      await writeShared({
        slug,
        name: body.name,
        muscleGroup: body.muscleGroup ?? null,
        equipment: body.equipment ?? null,
        guide,
      });
    }

    // Persist (upsert) so the exercise joins the library with its guide cached.
    const { data, error } = await supabaseAdmin
      .from("exercises")
      .upsert(
        {
          user_id: userId,
          slug,
          name: body.name,
          muscle_group: body.muscleGroup ?? existing?.muscle_group ?? "Full Body",
          equipment: body.equipment ?? existing?.equipment ?? "Other",
          guide,
          source: existing?.source ?? "ai",
        },
        { onConflict: "user_id,slug" }
      )
      .select()
      .single();
    if (error) throw new Error(error.message);
    res.json(rowToExercise(data));
  })
);

// ── Exercise demo videos (YouTube) ───────────────────────────────────────────
// Returns a ranked list of demonstration videos for the client's picker. Almost
// every call is served from the shared cache: a YouTube search costs 100 of a
// ~100/day global allowance, so paying for one per sheet-open would take the
// feature down before lunch. See youtube.ts for the full quota argument.
//
// Not entitlement-gated — knowing how to perform a movement safely is not a
// premium feature, and the cost profile is nothing like Gemini's: the marginal
// user costs zero once a movement has been searched once, for anyone, ever.
dataRouter.get(
  "/exercises/videos",
  videoLimiter,
  asyncHandler(async (req, res) => {
    const userId = uid(req as AuthedRequest);
    const { name, force } = z
      .object({ name: z.string().min(1).max(120), force: z.coerce.boolean().optional() })
      .parse(req.query);
    const slug = slugify(name);

    const cached = await readSharedVideos(slug);
    const fresh =
      cached?.videos.length &&
      cached.updatedAt !== null &&
      Date.now() - cached.updatedAt < config.youtubeCacheDays * 86_400_000;

    // The user's own pick, so the client can open straight onto it.
    const { data: own } = await supabaseAdmin
      .from("exercises")
      .select("video_id")
      .eq("user_id", userId)
      .eq("slug", slug)
      .maybeSingle();

    if (fresh && !force) {
      // Re-ranked on every read rather than at write time, so a pick recorded a
      // minute ago reorders the list for the next user without a new search.
      res.json({
        videos: rankVideos(cached!.videos, name, cached!.picks),
        selectedId: own?.video_id ?? null,
      });
      return;
    }

    // Checked before the budget claim, not inside the search: an unconfigured
    // server would otherwise spend a unit per request and fail anyway, so by the
    // time a key was added the day's allowance would already be gone.
    if (!youtubeConfigured()) {
      res.json({
        videos: cached?.videos.length ? rankVideos(cached.videos, name, cached.picks) : [],
        selectedId: own?.video_id ?? null,
        unavailable: cached?.videos.length ? undefined : "not_configured",
      });
      return;
    }

    try {
      // The budget claim sits *inside* the dedupe so callers piggybacking on an
      // in-flight search don't each spend a unit for the same answer. Exhaustion
      // throws and lands in the catch below, which serves stale results when we
      // have them — a six-month-old demo of a squat is still a demo of a squat.
      const found = await dedupeSearch(slug, async () => {
        if (!(await claimYoutubeSearch())) throw new Error("YOUTUBE_QUOTA");
        const videos = await searchExerciseVideos(name);
        if (videos.length) await writeSharedVideos(slug, name, videos);
        return videos;
      });
      res.json({
        videos: rankVideos(found, name, cached?.picks ?? {}),
        selectedId: own?.video_id ?? null,
      });
    } catch (err) {
      // Never a 500: the text guide is the primary content and the video is an
      // enhancement, so a YouTube outage degrades the sheet instead of breaking it.
      console.error("[videos] search failed", err instanceof Error ? err.message : err);
      res.json({
        videos: cached?.videos.length ? rankVideos(cached.videos, name, cached.picks) : [],
        selectedId: own?.video_id ?? null,
        unavailable: cached?.videos.length ? undefined : unavailableReason(err),
      });
    }
  })
);

// Remember which demo this user chose, and tally it towards the community
// default that orders results for everyone else.
dataRouter.post(
  "/exercises/video",
  asyncHandler(async (req, res) => {
    const userId = uid(req as AuthedRequest);
    const body = z
      .object({
        name: z.string().min(1),
        // null clears the pick and returns the user to the ranked list.
        videoId: z.string().min(5).max(20).regex(/^[\w-]+$/).nullable(),
        muscleGroup: z.string().optional(),
        equipment: z.string().optional(),
      })
      .parse(req.body);
    const slug = slugify(body.name);

    const { data: existing } = await supabaseAdmin
      .from("exercises")
      .select("*")
      .eq("user_id", userId)
      .eq("slug", slug)
      .maybeSingle();

    // Upsert rather than update: a seed-library exercise has no row until the
    // user does something with it, and picking a demo is that something.
    const { data, error } = await supabaseAdmin
      .from("exercises")
      .upsert(
        {
          user_id: userId,
          slug,
          name: body.name,
          muscle_group: body.muscleGroup ?? existing?.muscle_group ?? "Full Body",
          equipment: body.equipment ?? existing?.equipment ?? "Other",
          video_id: body.videoId,
          source: existing?.source ?? "custom",
        },
        { onConflict: "user_id,slug" }
      )
      .select()
      .single();
    if (error) throw new Error(error.message);

    // Tally only real picks, and only when it's a change — re-opening a sheet
    // shouldn't inflate a video's standing.
    if (body.videoId && body.videoId !== existing?.video_id) {
      await recordVideoPick(slug, body.name, body.videoId);
    }
    res.json(rowToExercise(data));
  })
);

// ── AI MET lookup (lazy: resolved + cached on first need) ─────────────────────
// The client calls this only for exercises its own deterministic table can't
// classify. We cache the resolved MET so it's reused for free thereafter.
dataRouter.post(
  "/exercises/met",
  aiLimiter,
  requireEntitlement("ai_exercise"),
  asyncHandler(async (req, res) => {
    const userId = uid(req as AuthedRequest);
    const body = z
      .object({
        name: z.string().min(1),
        muscleGroup: z.string().optional(),
        equipment: z.string().optional(),
        kind: z.string().optional(),
      })
      .parse(req.body);
    const slug = slugify(body.name);

    const { data: existing } = await supabaseAdmin
      .from("exercises")
      .select("*")
      .eq("user_id", userId)
      .eq("slug", slug)
      .maybeSingle();
    if (existing?.met != null) {
      res.json({ slug, met: Number(existing.met), source: "cache" });
      return;
    }

    // Deterministic table first (free), then the shared cross-user cache, then
    // AI for genuinely unknown movements.
    let met = metFromName(body.name) ?? 0;
    let source = met > 0 ? "table" : "ai";
    if (met <= 0) {
      const sharedMet = await readShared(slug);
      if (sharedMet?.met != null && sharedMet.met > 0) {
        met = sharedMet.met;
        source = "shared-cache";
      }
    }
    if (met <= 0) {
      met = await estimateMet(body.name, body.equipment, body.kind);
      if (met > 0) {
        await writeShared({
          slug,
          name: body.name,
          muscleGroup: body.muscleGroup ?? null,
          equipment: body.equipment ?? null,
          met,
        });
      }
    }
    if (met <= 0) {
      res.json({ slug, met: 0, source: "unresolved" });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from("exercises")
      .upsert(
        {
          user_id: userId,
          slug,
          name: body.name,
          muscle_group: body.muscleGroup ?? existing?.muscle_group ?? "Full Body",
          equipment: body.equipment ?? existing?.equipment ?? "Other",
          met,
          source: existing?.source ?? "ai",
        },
        { onConflict: "user_id,slug" }
      )
      .select()
      .single();
    if (error) throw new Error(error.message);
    res.json({ slug, met: Number(data.met), source });
  })
);

// ── Workouts ──────────────────────────────────────────────────────────────────
// Upsert by (user_id, client_id) so offline-queued sessions sync idempotently.
dataRouter.post(
  "/workouts",
  asyncHandler(async (req, res) => {
    const userId = uid(req as AuthedRequest);
    const items = z.union([workoutSchema, z.array(workoutSchema)]).parse(req.body);
    const list = Array.isArray(items) ? items : [items];
    const rows = list.map((w) => ({
      user_id: userId,
      client_id: w.clientId,
      routine_id: w.routineId ?? null,
      routine_name: w.routineName,
      started_at: new Date(w.startedAt).toISOString(),
      ended_at: w.endedAt ? new Date(w.endedAt).toISOString() : null,
      duration_sec: w.durationSec,
      total_volume: w.totalVolume,
      calories: w.calories ?? 0,
      notes: w.notes ?? null,
      exercises: w.exercises,
    }));
    const { data, error } = await supabaseAdmin
      .from("workouts").upsert(rows, { onConflict: "user_id,client_id" }).select();
    if (error) throw new Error(error.message);
    res.status(201).json((data ?? []).map(rowToWorkout));
  })
);

dataRouter.delete(
  "/workouts/:id",
  asyncHandler(async (req, res) => {
    const userId = uid(req as AuthedRequest);
    const { error } = await supabaseAdmin
      .from("workouts").delete().eq("id", req.params.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    res.status(204).end();
  })
);

// ── AI conversational onboarding ─────────────────────────────────────────────
// Photo attachments for the coach chat (screenshots of other apps, machine
// consoles, unknown machines). Base64 without the data-URL prefix; the client
// downscales before upload but we still cap size server-side (~6MB binary).
const chatImageSchema = z.object({
  mimeType: z.string().regex(/^image\//),
  data: z.string().min(1).max(8_000_000),
});
const chatMessageSchema = z.object({
  role: z.enum(["user", "model"]),
  content: z.string(),
  images: z.array(chatImageSchema).max(4).optional(),
});

dataRouter.post(
  "/ai/chat",
  aiLimiter,
  aiQuota("onboarding_chat"),
  asyncHandler(async (req, res) => {
    const { messages } = z.object({ messages: z.array(chatMessageSchema) }).parse(req.body);
    const reply = await chatOnboarding(messages as ChatMessage[]);
    res.json(reply);
  })
);

// ── AI ongoing coaching (for onboarded users — answers + routine adjustments) ──
dataRouter.post(
  "/ai/coach",
  aiLimiter,
  requireEntitlement("ai_coach"),
  asyncHandler(async (req, res) => {
    const userId = uid(req as AuthedRequest);
    const { messages } = z.object({ messages: z.array(chatMessageSchema) }).parse(req.body);

    const profile = await loadProfile(userId);
    if (!profile) {
      res.status(400).json({ error: "Complete onboarding first" });
      return;
    }
    const routines = await loadRoutines(userId);

    // Recent training context so the coach can reference real progress instead
    // of coaching blind: 4-week analytics + a digest of the last few sessions.
    const { data: workouts } = await supabaseAdmin
      .from("workouts").select("*").eq("user_id", userId)
      .order("started_at", { ascending: false }).limit(40);
    const history: SessionLite[] = (workouts ?? []).map((w) => ({
      startedAt: new Date(w.started_at).getTime(),
      totalVolume: Number(w.total_volume),
      exercises: w.exercises ?? [],
    }));
    let trainingContext: string | undefined;
    if (history.length) {
      const recent = (workouts ?? []).slice(0, 6).map((w) => {
        const date = new Date(w.started_at).toDateString();
        const mins = Math.round(Number(w.duration_sec || 0) / 60);
        const names = (w.exercises ?? []).map((e: { name: string }) => e.name).join(", ");
        return `   • ${date}: ${w.routine_name} (${mins} min${w.calories ? `, ~${Math.round(Number(w.calories))} kcal` : ""}) — ${names}`;
      });
      trainingContext = `${buildRefreshSummary(history, profile)}\n- Last sessions:\n${recent.join("\n")}`;
    }

    const reply = await chatCoach(messages as ChatMessage[], profile, routines, trainingContext);

    if (reply.type === "update" && reply.program) {
      const result = await persistProgram(userId, profile, reply.program);
      res.json({
        type: "update",
        text: reply.text,
        program: result.program,
        routines: result.routines,
      });
      return;
    }

    // The athlete described a completed session — persist it to their history.
    if (reply.type === "log" && reply.workout) {
      const saved = await persistLoggedWorkout(userId, reply.workout, profile.bodyweightKg);
      res.json({ type: "log", text: reply.text, workout: saved });
      return;
    }

    res.json({ type: "message", text: reply.text, suggestions: reply.suggestions });
  })
);
