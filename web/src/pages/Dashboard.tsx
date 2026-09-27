import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Play, Plus, Sparkles, Flame, Calendar, Bell, BellRing,
  TrendingUp, Star, ChevronRight, Check, Apple,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { weekStats, currentStreak } from "@/lib/analytics";
import { formatVolume, formatCalories, cn } from "@/lib/utils";
import {
  requestNotificationPermission, scheduleReminder, notificationsSupported, describeReminderDays,
} from "@/lib/notifications";
import type { Routine } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, Progress, Spinner } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/lib/toast";
import { isNative } from "@/lib/platform";
import { effectiveReminderDays } from "@/lib/reminders";

export function Dashboard() {
  const navigate = useNavigate();
  const profile = useStore((s) => s.profile)!;
  const routines = useStore((s) => s.routines);
  const program = useStore((s) => s.program);
  const history = useStore((s) => s.history);
  const settings = useStore((s) => s.settings);
  const active = useStore((s) => s.active);
  const startWorkout = useStore((s) => s.startWorkout);
  const refreshProgram = useStore((s) => s.refreshProgram);
  const setSetting = useStore((s) => s.setSetting);

  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<string | null>(null);

  const stats = useMemo(() => weekStats(history, profile.daysPerWeek), [history, profile]);
  const streak = useMemo(() => currentStreak(history), [history]);

  const aiRoutines = routines.filter((r) => r.source === "ai");
  // Pick the next AI routine in rotation based on completed sessions count.
  const nextRoutine: Routine | undefined =
    aiRoutines.length > 0 ? aiRoutines[history.length % aiRoutines.length] : undefined;

  const favorites = routines.filter((r) => r.favorite);
  const recentNames = [...new Set(history.slice(0, 6).map((h) => h.routineId))];
  const quickStart = [
    ...favorites,
    ...recentNames
      .map((id) => routines.find((r) => r.id === id))
      .filter((r): r is Routine => !!r && !r.favorite),
  ].slice(0, 4);

  const begin = (routine?: Routine) => {
    startWorkout(routine);
    navigate("/workout");
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const summary = await refreshProgram();
      setRefreshResult(summary);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI refresh failed. Try again.");
    } finally {
      setRefreshing(false);
    }
  };

  const enableReminders = async () => {
    const perm = await requestNotificationPermission();
    if (perm === "granted") {
      setSetting("remindersEnabled", true);
      if (isNative()) {
        // The real schedule is planned by NativeBridge from Settings → Notifications.
        const s = useStore.getState();
        toast.success(
          `Reminders on — ${describeReminderDays(
            effectiveReminderDays(s.settings, s.profile),
            s.settings.reminderTime
          )}. Change it in Settings.`
        );
        return;
      }
      // Browser demo: schedule a nudge in ~5s so the user sees it works.
      scheduleReminder(
        "next-workout",
        5000,
        "Time to train 💪",
        nextRoutine ? `Your ${nextRoutine.name} is ready in Fitnofat.` : "Your next workout is ready."
      );
    } else {
      setSetting("remindersEnabled", false);
    }
  };

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between pt-2">
        <div>
          <p className="text-sm text-muted-foreground">{greeting}</p>
          <h1 className="text-2xl font-extrabold tracking-tight">
            {profile.name || "Athlete"} 👋
          </h1>
        </div>
        {streak > 0 && (
          <div className="flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1.5 text-primary">
            <Flame className="h-4 w-4" />
            <span className="text-sm font-bold">{streak}d streak</span>
          </div>
        )}
      </div>

      {/* Resume active workout */}
      {active && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-xl bg-primary p-2 text-primary-foreground">
              <Play className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <p className="font-semibold">Workout in progress</p>
              <p className="text-sm text-muted-foreground">{active.routineName}</p>
            </div>
            <Button size="sm" onClick={() => navigate("/workout")}>
              Resume
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Weekly consistency */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">This week</span>
            </div>
            <Badge variant={stats.trained >= stats.goal ? "success" : "muted"}>
              {stats.trained}/{stats.goal} workouts
            </Badge>
          </div>
          <Progress value={stats.pct} className="mt-3" />
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Stat label="Trained" value={`${stats.trained}`} />
            <Stat label="Volume" value={formatVolume(stats.volume, profile.units)} />
            <Stat label="Calories" value={formatCalories(stats.calories)} />
          </div>
        </CardContent>
      </Card>

      {/* Next scheduled workout */}
      {nextRoutine && (
        <div>
          <SectionHeader title="Next up" icon={Calendar} />
          <Card className="overflow-hidden">
            <div className="bg-gradient-to-br from-primary/15 to-transparent p-4">
              <div className="flex items-start justify-between">
                <div>
                  <Badge>{nextRoutine.dayLabel ?? "AI Routine"}</Badge>
                  <h3 className="mt-2 text-xl font-bold">{nextRoutine.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {nextRoutine.exercises.length} exercises ·{" "}
                    {nextRoutine.exercises.reduce((n, e) => n + e.sets.length, 0)} sets
                  </p>
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <Button className="flex-1" onClick={() => begin(nextRoutine)}>
                  <Play className="h-4 w-4" />
                  Start workout
                </Button>
                {notificationsSupported() && (
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={enableReminders}
                    title="Remind me"
                    className={cn(settings.remindersEnabled && "border-primary text-primary")}
                  >
                    {settings.remindersEnabled ? (
                      <BellRing className="h-5 w-5" />
                    ) : (
                      <Bell className="h-5 w-5" />
                    )}
                  </Button>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Start empty */}
      <Button
        variant="secondary"
        size="lg"
        className="w-full"
        onClick={() => begin(undefined)}
      >
        <Plus className="h-5 w-5" />
        Start empty workout
      </Button>

      {/* Quick start */}
      {quickStart.length > 0 && (
        <div>
          <SectionHeader title="Quick start" icon={Star} />
          <div className="grid grid-cols-2 gap-2">
            {quickStart.map((r) => (
              <button
                key={r.id}
                onClick={() => begin(r)}
                className="flex flex-col items-start gap-1 rounded-xl border border-border bg-card p-3 text-left tap hover:border-primary/40"
              >
                <div className="flex w-full items-center justify-between">
                  <span className="font-semibold leading-tight">{r.name}</span>
                  {r.favorite && <Star className="h-3.5 w-3.5 fill-primary text-primary" />}
                </div>
                <span className="text-xs text-muted-foreground">
                  {r.exercises.length} exercises
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Evolve program */}
      {program && (
        <Card className="border-primary/30 bg-gradient-to-br from-primary/10 to-transparent">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">{program.name}</span>
              <Badge variant="outline" className="ml-auto">
                v{program.iteration}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Ready to level up? We’ll analyze your progress and adapt loads, reps and
              exercises for your next block — and re-scale your nutrition to match.
            </p>
            <Button
              className="mt-3 w-full"
              variant="default"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              {refreshing ? <Spinner /> : <Sparkles className="h-4 w-4" />}
              {refreshing ? "Analyzing your progress…" : "Refresh / Evolve program"}
            </Button>
          </CardContent>
        </Card>
      )}

      <button
        onClick={() => navigate("/routines")}
        className="flex w-full items-center justify-between rounded-xl px-1 py-2 text-sm text-muted-foreground tap"
      >
        Manage all routines
        <ChevronRight className="h-4 w-4" />
      </button>

      {/* Refresh result modal */}
      <Modal
        open={!!refreshResult}
        onClose={() => setRefreshResult(null)}
        title="Program evolved"
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="rounded-full bg-success/15 p-3 text-success">
            <Check className="h-7 w-7" />
          </div>
          <p className="text-sm text-muted-foreground">{refreshResult}</p>
          <p className="text-xs text-muted-foreground">
            Your nutrition plan was re-scaled to match the new training load.
          </p>
          <Button className="w-full" onClick={() => setRefreshResult(null)}>
            View updated routines
          </Button>
          <Button variant="outline" className="w-full" onClick={() => navigate("/nutrition")}>
            <Apple className="h-4 w-4" />
            View nutrition plan
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-secondary py-2">
      <p className="text-base font-bold leading-none">{value}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function SectionHeader({
  title,
  icon: Icon,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
    </div>
  );
}
