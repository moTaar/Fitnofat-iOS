import { useCallback, useEffect, useState } from "react";
import { Play, RefreshCw, Repeat, Video, VideoOff, ExternalLink } from "lucide-react";
import type { ExerciseVideo } from "@/lib/types";
import { api, type VideoUnavailable } from "@/lib/api";
import { useStore } from "@/lib/store";
import { Spinner } from "@/components/ui/misc";
import { isNative } from "@/lib/platform";
import { openExternal } from "@/lib/native";

// The demo-video picker for "How to perform".
//
// Two states: a grid of candidate demos, and one playing. Picking a video
// remembers it (per user, synced) so the sheet opens straight onto it next time;
// "Choose another" comes back to the grid, which is the whole point — no single
// video is right for everybody, so the user gets to overrule us.
//
// The iframe is only ever mounted after a tap. YouTube's embed pulls ~hundreds
// of KB of player JS, and mounting it on every sheet open would put that on the
// in-gym critical path for a section the user may only be skimming. The facade
// is a thumbnail — the same trick the player itself uses.

const PLACEHOLDER_BLUR =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="9"><rect width="16" height="9" fill="#26262b"/></svg>`
  );

function formatDuration(sec?: number): string | null {
  if (!sec || sec <= 0) return null;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatViews(n?: number): string | null {
  if (!n || n <= 0) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M views`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K views`;
  return `${n} views`;
}

const UNAVAILABLE_COPY: Record<VideoUnavailable, string> = {
  not_configured: "Video demos aren't set up on this server yet.",
  quota: "Today's video search allowance is used up. Try again tomorrow — the written steps below still cover the movement.",
  error: "Couldn't reach YouTube just now. The written steps below still cover the movement.",
};

export function VideoPicker({
  exerciseId,
  name,
  muscleGroup,
  equipment,
}: {
  exerciseId: string;
  name: string;
  muscleGroup?: string;
  equipment?: string;
}) {
  const exercises = useStore((s) => s.exercises);
  const setExerciseVideo = useStore((s) => s.setExerciseVideo);
  const savedId = exercises.find((e) => e.id === exerciseId)?.videoId;

  const [videos, setVideos] = useState<ExerciseVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unavailable, setUnavailable] = useState<VideoUnavailable | null>(null);
  // The video currently on screen. Null = show the grid.
  const [playing, setPlaying] = useState<string | null>(null);
  // Set when the user explicitly taps "Choose another", so a saved pick doesn't
  // immediately pull them back into the player they just backed out of.
  const [browsing, setBrowsing] = useState(false);

  const load = useCallback(
    async (force: boolean) => {
      force ? setRefreshing(true) : setLoading(true);
      try {
        const res = await api.exerciseVideos(name, force);
        setVideos(res.videos);
        setUnavailable(res.videos.length ? null : (res.unavailable ?? "error"));
      } catch {
        setVideos([]);
        setUnavailable("error");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [name]
  );

  // Reset and reload whenever a different exercise is shown.
  useEffect(() => {
    setVideos([]);
    setPlaying(null);
    setBrowsing(false);
    setUnavailable(null);
    load(false);
  }, [load]);

  // Open straight onto the saved pick, but only if it's actually in the list —
  // a video can be deleted or made private between sessions, and silently
  // rendering a dead embed is worse than dropping back to the grid.
  useEffect(() => {
    if (browsing || playing || !savedId) return;
    if (videos.some((v) => v.videoId === savedId)) setPlaying(savedId);
  }, [savedId, videos, browsing, playing]);

  const choose = (videoId: string) => {
    setPlaying(videoId);
    setBrowsing(false);
    void setExerciseVideo({ id: exerciseId, name, videoId, muscleGroup, equipment });
  };

  const current = videos.find((v) => v.videoId === playing);

  if (loading) {
    return (
      <div className="flex aspect-video items-center justify-center gap-2 rounded-2xl border border-border bg-secondary/30 text-sm text-muted-foreground">
        <Spinner className="h-4 w-4" />
        Finding demonstrations…
      </div>
    );
  }

  if (!videos.length) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-secondary/30 px-4 py-6 text-center">
        <VideoOff className="h-5 w-5 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {UNAVAILABLE_COPY[unavailable ?? "error"]}
        </p>
        {unavailable !== "not_configured" && (
          <button
            onClick={() => load(false)}
            className="mt-1 text-xs font-medium text-primary hover:underline"
          >
            Try again
          </button>
        )}
      </div>
    );
  }

  if (playing && current) {
    return (
      <div className="space-y-2">
        {isNative() ? (
          // YouTube refuses to play embeds whose page has no web origin, and the
          // iOS app's pages come from its own capacitor:// scheme. So in the app
          // the pick shows as a poster that opens the video in a Safari sheet.
          <button
            onClick={() => void openExternal(`https://www.youtube.com/watch?v=${playing}`)}
            className="relative block aspect-video w-full overflow-hidden rounded-2xl border border-border bg-black tap"
          >
            <img
              src={current.thumbnail || PLACEHOLDER_BLUR}
              alt=""
              decoding="async"
              className="h-full w-full object-cover opacity-90"
            />
            <span className="absolute inset-0 flex items-center justify-center bg-black/30">
              <Play className="h-10 w-10 fill-white text-white drop-shadow" />
            </span>
          </button>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border bg-black">
            <iframe
              key={playing}
              src={`https://www.youtube-nocookie.com/embed/${playing}?rel=0&modestbranding=1&playsinline=1`}
              title={current.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              loading="lazy"
              className="aspect-video w-full border-0"
            />
          </div>
        )}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{current.title}</p>
            <p className="truncate text-xs text-muted-foreground">{current.channelTitle}</p>
          </div>
          <a
            href={`https://www.youtube.com/watch?v=${playing}`}
            target="_blank"
            rel="noopener noreferrer"
            title="Open on YouTube"
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
        <button
          onClick={() => {
            setPlaying(null);
            setBrowsing(true);
          }}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-secondary/40 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground tap"
        >
          <Repeat className="h-3.5 w-3.5" />
          Choose another demo
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Video className="h-3.5 w-3.5" />
        Pick a demonstration
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          title="Search for different videos"
          className="ml-auto rounded p-1 transition-colors hover:text-foreground disabled:opacity-40"
        >
          <RefreshCw className={`h-3.5 w-3.5${refreshing ? " animate-spin" : ""}`} />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {videos.map((v) => (
          <button
            key={v.videoId}
            onClick={() => choose(v.videoId)}
            className={`group overflow-hidden rounded-xl border text-left transition-colors tap ${
              v.videoId === savedId
                ? "border-primary bg-primary/10"
                : "border-border bg-secondary/30 hover:border-primary/50"
            }`}
          >
            <div className="relative aspect-video bg-muted">
              <img
                src={v.thumbnail || PLACEHOLDER_BLUR}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
              <span className="absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 transition-opacity group-hover:opacity-100">
                <Play className="h-7 w-7 fill-white text-white drop-shadow" />
              </span>
              {formatDuration(v.durationSec) && (
                <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 py-0.5 text-[10px] font-medium text-white">
                  {formatDuration(v.durationSec)}
                </span>
              )}
            </div>
            <div className="p-1.5">
              <p className="line-clamp-2 text-[11px] font-medium leading-tight">{v.title}</p>
              <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                {v.channelTitle}
                {formatViews(v.viewCount) ? ` · ${formatViews(v.viewCount)}` : ""}
              </p>
            </div>
          </button>
        ))}
      </div>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Demonstrations are searched on YouTube and play in YouTube's own player, ads included.
      </p>
    </div>
  );
}
