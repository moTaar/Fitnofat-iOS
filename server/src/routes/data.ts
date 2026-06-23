import { Router } from "express";
import { z } from "zod";
import { supabaseAdmin } from "../supabase";
import { asyncHandler, requireAuth, AuthedRequest } from "../middleware";
import { generateProgram, refreshProgram, chatOnboarding, chatCoach, type ChatMessage } from "../gemini";
import { buildRefreshSummary, SessionLite } from "../analytics";
import { slugify } from "../util";
import {
  aiRoutinesToRows, profileToRow, rowToExercise, rowToProfile,
  rowToProgram, rowToRoutine, rowToWorkout,
} from "../mappers";
import type { UserProfile } from "../types";

export const dataRouter = Router();
dataRouter.use(requireAuth);

const uid = (req: AuthedRequest) => req.userId;

// ── validation schemas ────────────────────────────────────────────────────
const profileSchema = z.object({
  name: z.string().optional(),
  goal: z.enum(["strength", "hypertrophy", "weight_loss", "endurance", "general"]),
  equipment: z.enum(["full_gym", "dumbbells", "bodyweight", "home_gym"]),
  experience: z.enum(["beginner", "intermediate", "advanced"]),
  category: z.enum(["calisthenics", "weightlifting", "cardio", "yoga_pilates", "mixed", "other"]).optional().default("mixed"),
  daysPerWeek: z.number().int().min(1).max(7),
  sessionMinutes: z.number().int().min(10).max(240),
  bodyweightKg: z.number().optional(),
  units: z.enum(["kg", "lb"]),
  notes: z.string().optional(),
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
});
const workoutSchema = z.object({
  clientId: z.string(),
  routineId: z.string().optional().nullable(),
  routineName: z.string(),
  startedAt: z.number(),
  endedAt: z.number().optional(),
  durationSec: z.number(),
  totalVolume: z.number(),
  notes: z.string().optional(),
  exercises: z.array(
    z.object({
      exerciseId: z.string(),
      name: z.string(),
      muscleGroup: z.string(),
      restSeconds: z.number(),
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

// ── GET /bootstrap : everything the client needs to hydrate ──────────────────
dataRouter.get(
  "/bootstrap",
  asyncHandler(async (req, res) => {
    const userId = uid(req as AuthedRequest);
    const [profile, routines, exercisesRes, workoutsRes] = await Promise.all([
      loadProfile(userId),
      loadRoutines(userId),
      supabaseAdmin.from("exercises").select("*").eq("user_id", userId),
      supabaseAdmin.from("workouts").select("*").eq("user_id", userId).order("started_at", { ascending: false }),
    ]);
    const aiRoutineIds = routines.filter((r) => r.source === "ai").map((r) => r.id);
    const program = await loadLatestProgram(userId, aiRoutineIds);
    res.json({
      profile,
      program,
      routines,
      exercises: (exercisesRes.data ?? []).map(rowToExercise),
      workouts: (workoutsRes.data ?? []).map(rowToWorkout),
    });
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
    res.json(result);
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
const chatMessageSchema = z.object({
  role: z.enum(["user", "model"]),
  content: z.string(),
});

dataRouter.post(
  "/ai/chat",
  asyncHandler(async (req, res) => {
    const { messages } = z.object({ messages: z.array(chatMessageSchema) }).parse(req.body);
    const reply = await chatOnboarding(messages as ChatMessage[]);
    res.json(reply);
  })
);

// ── AI ongoing coaching (for onboarded users — answers + routine adjustments) ──
dataRouter.post(
  "/ai/coach",
  asyncHandler(async (req, res) => {
    const userId = uid(req as AuthedRequest);
    const { messages } = z.object({ messages: z.array(chatMessageSchema) }).parse(req.body);

    const profile = await loadProfile(userId);
    if (!profile) {
      res.status(400).json({ error: "Complete onboarding first" });
      return;
    }
    const routines = await loadRoutines(userId);

    const reply = await chatCoach(messages as ChatMessage[], profile, routines);

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
    res.json({ type: "message", text: reply.text, suggestions: reply.suggestions });
  })
);
