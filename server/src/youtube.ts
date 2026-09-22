// YouTube search for exercise demo videos.
//
// Quota is the whole design constraint. `search.list` costs 100 units against a
// default 10,000/day allocation — ~100 searches per day for the entire user
// base, not per user. Everything here exists to make each of those 100 count:
//
//   • results are cached globally by slug (see aicache.ts) — a movement is the
//     same movement for every athlete, so one search serves it forever;
//   • the caller checks a global daily budget before spending a unit;
//   • the query is shaped so the one search we pay for returns demos rather
//     than 12-minute video essays;
//   • a follow-up videos.list costs 1 unit and buys duration + view counts for
//     ranking and display, which is a rounding error against the 100 already
//     spent and materially improves what the user is offered.
//
// Failures here are never fatal: the text guide is the primary content and the
// video is an enhancement, so the route degrades to an empty list rather than
// surfacing a 500.

import { config } from "./config";

export interface ExerciseVideo {
  videoId: string;
  title: string;
  channelTitle: string;
  channelId: string;
  thumbnail: string;
  publishedAt?: string;
  /** Seconds. Absent when the videos.list enrichment call failed. */
  durationSec?: number;
  viewCount?: number;
}

/** Why a search produced nothing. Lets the UI explain itself instead of erroring. */
export type VideoUnavailable = "not_configured" | "quota" | "error";

/**
 * Whether searching is possible at all. Callers must check this BEFORE claiming
 * a unit of the daily budget: without a key every request would otherwise spend
 * a unit and then fail, silently draining an allowance that can't be topped up
 * before midnight Pacific — so the day a key is finally added, the feature would
 * report "quota exhausted" until the next reset.
 */
export function youtubeConfigured(): boolean {
  return !!config.youtubeApiKey;
}

const SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";
const VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";

/** How many results to ask YouTube for. Costs the same 100 units at any size. */
const MAX_RESULTS = 12;
/** How many survive ranking and reach the client. */
const KEEP = 8;

// ── Query shaping ────────────────────────────────────────────────────────────

/**
 * Searching the bare exercise name returns workout vlogs, programme videos and
 * clickbait. Adding form intent is what turns "Lateral Raise" from a playlist of
 * shoulder workouts into a set of single-movement demonstrations.
 */
export function buildQuery(name: string): string {
  return `${name.trim()} proper form technique how to`;
}

// Title signals. Ranking is deliberately explainable — no opaque scoring — so
// that a bad result set can be diagnosed by reading the title it came back with.
const GOOD_TITLE = [
  "how to", "proper form", "correct form", "form", "technique", "tutorial",
  "demonstration", "demo", "step by step", "exercise guide", "perfect",
];
const BAD_TITLE = [
  // Not a single-exercise demo: programmes, vlogs, entertainment, commentary.
  "workout", "routine", "day in the life", "podcast", "vlog", "challenge",
  "transformation", "full body", "push day", "pull day", "leg day", "reaction",
  "vs ", "top 10", "top 5", "compilation", "review", "diet", "what i eat",
  "motivation", "aesthetic", "edit", "gym fails", "fail",
];

/** ISO 8601 (`PT1M30S`) → seconds. Returns undefined for anything unparseable. */
export function parseIsoDuration(iso: string): number | undefined {
  const m = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return undefined;
  const [, d, h, min, s] = m;
  return (
    Number(d ?? 0) * 86400 +
    Number(h ?? 0) * 3600 +
    Number(min ?? 0) * 60 +
    Number(s ?? 0)
  );
}

/** Tokens of the exercise name worth matching against a title ("the", "a" are not). */
function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
}

/**
 * Score a candidate. Higher is better. Community picks dominate everything else
 * on purpose: a video a real user chose and kept is worth more than any
 * heuristic we can write about its title.
 */
export function scoreVideo(
  v: ExerciseVideo,
  name: string,
  picks: Record<string, number>,
  allowlist: Set<string>
): number {
  const title = v.title.toLowerCase();
  let score = 0;

  // 1. What users actually chose, damped so one enthusiast can't pin a bad video.
  score += Math.min(picks[v.videoId] ?? 0, 25) * 8;

  // 2. Curated channels (YOUTUBE_CHANNEL_ALLOWLIST) — the single highest-leverage
  //    quality lever available, and it costs no extra quota.
  if (allowlist.has(v.channelId)) score += 60;

  // 3. Does the title actually name this movement?
  const tokens = nameTokens(name);
  if (tokens.length) {
    const hit = tokens.filter((t) => title.includes(t)).length;
    score += (hit / tokens.length) * 40;
  }

  // 4. Form intent vs. noise.
  if (GOOD_TITLE.some((k) => title.includes(k))) score += 20;
  if (BAD_TITLE.some((k) => title.includes(k))) score -= 25;

  // 5. Duration. A demo is short; anything past ~5 min is a talk, not a demo.
  //    Sub-20s clips are usually Shorts with no setup explanation, so they rank
  //    below a proper 30s–3min demonstration rather than above it.
  if (v.durationSec != null) {
    if (v.durationSec >= 30 && v.durationSec <= 180) score += 18;
    else if (v.durationSec < 30) score += 4;
    else if (v.durationSec > 300) score -= 12;
  }

  // 6. Mild popularity prior — a tiebreak, not a driver (log-scaled so a
  //    10M-view vlog can't outrank a 50k-view demonstration on reach alone).
  if (v.viewCount) score += Math.min(Math.log10(v.viewCount), 7);

  return score;
}

// ── API calls ────────────────────────────────────────────────────────────────

async function fetchJson(url: string): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(config.youtubeTimeoutMs) });
  } catch {
    throw new Error("YOUTUBE_TIMEOUT");
  }
  if (res.status === 403) {
    // 403 covers both "quota exceeded" and "key not authorised". Both mean the
    // same thing to a caller: stop spending, we're not getting results today.
    throw new Error("YOUTUBE_QUOTA");
  }
  if (!res.ok) throw new Error("YOUTUBE_ERROR");
  return res.json();
}

/**
 * One `videos.list` call (1 unit) enriching the search hits with duration and
 * view count. Best-effort: if it fails the videos are still usable, they just
 * rank on title alone and show no duration badge.
 */
async function enrich(videos: ExerciseVideo[]): Promise<void> {
  if (!videos.length) return;
  const ids = videos.map((v) => v.videoId).join(",");
  const url =
    `${VIDEOS_URL}?part=contentDetails,statistics&id=${encodeURIComponent(ids)}` +
    `&key=${encodeURIComponent(config.youtubeApiKey)}`;
  try {
    const data = await fetchJson(url);
    const byId = new Map<string, any>();
    for (const item of data.items ?? []) byId.set(item.id, item);
    for (const v of videos) {
      const item = byId.get(v.videoId);
      if (!item) continue;
      const iso = item.contentDetails?.duration;
      if (typeof iso === "string") v.durationSec = parseIsoDuration(iso);
      const views = Number(item.statistics?.viewCount);
      if (Number.isFinite(views)) v.viewCount = views;
    }
  } catch (err) {
    console.warn("[youtube] enrich failed", err instanceof Error ? err.message : err);
  }
}

/**
 * Search YouTube for demos of `name`. Spends 100 quota units — callers must
 * check the shared daily budget first (see `youtubeBudget` in ratelimit.ts) and
 * must cache the result.
 *
 * Throws `NO_YOUTUBE_KEY` | `YOUTUBE_TIMEOUT` | `YOUTUBE_QUOTA` | `YOUTUBE_ERROR`.
 */
export async function searchExerciseVideos(name: string): Promise<ExerciseVideo[]> {
  if (!config.youtubeApiKey) throw new Error("NO_YOUTUBE_KEY");

  const params = new URLSearchParams({
    part: "snippet",
    q: buildQuery(name),
    type: "video",
    // Non-embeddable videos render as a black box in an iframe, so excluding
    // them up front is the difference between a picker and a broken picker.
    videoEmbeddable: "true",
    videoSyndicated: "true",
    // "short" is <4 minutes — skews hard towards demonstrations over essays.
    videoDuration: "short",
    safeSearch: "strict",
    order: "relevance",
    maxResults: String(MAX_RESULTS),
    relevanceLanguage: config.youtubeLanguage,
    regionCode: config.youtubeRegion,
    key: config.youtubeApiKey,
  });

  const data = await fetchJson(`${SEARCH_URL}?${params.toString()}`);

  const videos: ExerciseVideo[] = (data.items ?? [])
    .filter((it: any) => it?.id?.videoId && it?.snippet)
    .map((it: any) => ({
      videoId: it.id.videoId,
      title: String(it.snippet.title ?? "").trim(),
      channelTitle: String(it.snippet.channelTitle ?? "").trim(),
      channelId: String(it.snippet.channelId ?? ""),
      thumbnail:
        it.snippet.thumbnails?.medium?.url ??
        it.snippet.thumbnails?.default?.url ??
        "",
      publishedAt: it.snippet.publishedAt,
    }));

  await enrich(videos);
  return videos;
}

// In-flight searches, keyed by slug. Two users opening the same uncached
// exercise at the same moment would otherwise both miss the cache and both
// spend 100 units to get the same answer — and with only ~90 searches in a day,
// wasting one on a duplicate is expensive. Collapsing them costs nothing.
//
// Per-instance, so it doesn't dedupe across a multi-instance deploy; it covers
// the cases that actually happen (a double-tap, a retry, React StrictMode's
// double effect in dev, two users on one box) and the cache catches the rest.
const inFlight = new Map<string, Promise<ExerciseVideo[]>>();

/**
 * Run `search` for `slug` at most once concurrently. Callers arriving while a
 * search is running await the same promise instead of starting a second one.
 */
export function dedupeSearch(
  slug: string,
  search: () => Promise<ExerciseVideo[]>
): Promise<ExerciseVideo[]> {
  const running = inFlight.get(slug);
  if (running) return running;
  const p = search().finally(() => inFlight.delete(slug));
  inFlight.set(slug, p);
  return p;
}

/**
 * Order cached results for a specific user request. Kept separate from the
 * search so community picks re-rank an already-cached list without spending a
 * single quota unit — which is what makes the crowd-curation loop free.
 */
export function rankVideos(
  videos: ExerciseVideo[],
  name: string,
  picks: Record<string, number> = {}
): ExerciseVideo[] {
  const allowlist = new Set(config.youtubeChannelAllowlist);
  return [...videos]
    .map((v) => ({ v, s: scoreVideo(v, name, picks, allowlist) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, KEEP)
    .map(({ v }) => v);
}

/** Map a thrown search error onto the reason the client shows the user. */
export function unavailableReason(err: unknown): VideoUnavailable {
  const msg = err instanceof Error ? err.message : "";
  if (msg === "NO_YOUTUBE_KEY") return "not_configured";
  if (msg === "YOUTUBE_QUOTA") return "quota";
  return "error";
}
