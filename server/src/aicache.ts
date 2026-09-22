// Cross-user cache for AI-generated exercise metadata.
//
// Guides, muscle-group/equipment classification and MET values describe the
// *movement*, not the user — "barbell bench press" is the same lift for
// everybody. The per-user `exercises` row still caches each user's copy (it's
// what their library reads), but the expensive Gemini call behind it now runs
// at most once per movement across the whole user base.

import { supabaseAdmin } from "./supabase";
import type { ExerciseGuide } from "./gemini";
import type { ExerciseVideo } from "./youtube";

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

// ── Demo videos ──────────────────────────────────────────────────────────────
// Same argument as guides, with sharper teeth: a YouTube search costs 100 of a
// shared 10,000 daily quota units, so this cache is what makes the feature
// affordable at all rather than merely fast. See youtube.ts.

export interface CachedVideos {
  videos: ExerciseVideo[];
  /** {videoId: pickCount} — what users chose, which re-ranks results for free. */
  picks: Record<string, number>;
  updatedAt: number | null;
}

export async function readSharedVideos(slug: string): Promise<CachedVideos | null> {
  const { data, error } = await supabaseAdmin
    .from("exercise_guides")
    .select("videos, video_picks, videos_updated_at")
    .eq("slug", slug)
    .maybeSingle();
  if (error || !data) return null;
  return {
    videos: (data.videos as ExerciseVideo[] | null) ?? [],
    picks: (data.video_picks as Record<string, number> | null) ?? {},
    updatedAt: data.videos_updated_at ? Date.parse(data.videos_updated_at) : null,
  };
}

/** Store a fresh result set. Best-effort — a cache write must never fail the request. */
export async function writeSharedVideos(
  slug: string,
  name: string,
  videos: ExerciseVideo[]
): Promise<void> {
  try {
    await supabaseAdmin.from("exercise_guides").upsert(
      {
        slug,
        name,
        videos,
        videos_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "slug" }
    );
  } catch (err) {
    console.error("[aicache] video write failed", err instanceof Error ? err.message : err);
  }
}

/**
 * Tally one user's choice. This is the crowd-curation loop: picks feed straight
 * back into `rankVideos`, so the demo the next user sees first is the one people
 * before them actually kept — no editorial work and no extra quota.
 *
 * Read-modify-write on a jsonb blob is racy under concurrency; a lost increment
 * here costs nothing (the tally is a ranking hint, not an invariant), so it
 * isn't worth an RPC.
 */
export async function recordVideoPick(
  slug: string,
  name: string,
  videoId: string
): Promise<void> {
  try {
    const { data } = await supabaseAdmin
      .from("exercise_guides")
      .select("video_picks")
      .eq("slug", slug)
      .maybeSingle();
    const picks = ((data?.video_picks as Record<string, number> | null) ?? {}) as Record<string, number>;
    picks[videoId] = (picks[videoId] ?? 0) + 1;
    await supabaseAdmin
      .from("exercise_guides")
      .upsert({ slug, name, video_picks: picks, updated_at: new Date().toISOString() }, { onConflict: "slug" });
  } catch (err) {
    console.error("[aicache] pick write failed", err instanceof Error ? err.message : err);
  }
}
