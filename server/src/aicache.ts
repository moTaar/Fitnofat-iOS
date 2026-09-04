// Cross-user cache for AI-generated exercise metadata.
//
// Guides, muscle-group/equipment classification and MET values describe the
// *movement*, not the user — "barbell bench press" is the same lift for
// everybody. The per-user `exercises` row still caches each user's copy (it's
// what their library reads), but the expensive Gemini call behind it now runs
// at most once per movement across the whole user base.

import { supabaseAdmin } from "./supabase";
import type { ExerciseGuide } from "./gemini";

export interface CachedExercise {
  slug: string;
  name: string;
  muscleGroup?: string | null;
  equipment?: string | null;
  guide?: ExerciseGuide | null;
  met?: number | null;
}

export async function readShared(slug: string): Promise<CachedExercise | null> {
  const { data, error } = await supabaseAdmin
    .from("exercise_guides")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (error || !data) return null;
  return {
    slug: data.slug,
    name: data.name,
    muscleGroup: data.muscle_group,
    equipment: data.equipment,
    guide: (data.guide as ExerciseGuide | null) ?? null,
    met: data.met == null ? null : Number(data.met),
  };
}

/**
 * Merge-write into the shared cache. Best-effort: a cache write must never fail
 * the request that produced the value, and never overwrites a populated column
 * with null (so a MET-only lookup can't wipe a previously cached guide).
 */
export async function writeShared(entry: CachedExercise): Promise<void> {
  try {
    const existing = await readShared(entry.slug);
    const row = {
      slug: entry.slug,
      name: entry.name || existing?.name || entry.slug,
      muscle_group: entry.muscleGroup ?? existing?.muscleGroup ?? null,
      equipment: entry.equipment ?? existing?.equipment ?? null,
      guide: entry.guide ?? existing?.guide ?? null,
      met: entry.met ?? existing?.met ?? null,
      updated_at: new Date().toISOString(),
    };
    await supabaseAdmin.from("exercise_guides").upsert(row, { onConflict: "slug" });
  } catch (err) {
    console.error("[aicache] write failed", err instanceof Error ? err.message : err);
  }
}
