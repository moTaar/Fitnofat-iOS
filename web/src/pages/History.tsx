import { useMemo, useState } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import {
  Calendar, Clock, TrendingUp, Dumbbell, Flame, ChevronRight, Plus, HeartPulse,
  Timer, Copy, RotateCw, Trash2, Trophy, Activity,
} from "lucide-react";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import { useStore } from "@/lib/store";
import { formatDuration, formatVolume, formatCalories, minutesLabel } from "@/lib/utils";
import {
  exerciseTrends, exerciseSeries, rangeSummary, weeklySeries, personalRecords,
  type TrendMetric,
} from "@/lib/analytics";
import { resolveKind, exerciseDuration } from "@/lib/calories";
import type { ExerciseKind, LoggedExercise, WorkoutSession } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, EmptyState } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { SessionEditor } from "@/components/SessionEditor";

const KIND_ICON: Record<ExerciseKind, typeof Dumbbell> = {
  strength: Dumbbell,
  cardio: HeartPulse,
  hold: Timer,
};

// Friendly unit label for a trend/PR metric (e1RM uses the athlete's weight unit).
function metricUnit(metric: TrendMetric, units: string): string {
  return metric === "e1rm" ? units : metric === "reps" ? "reps" : metric === "duration" ? "min" : "km";
}

export function History() {
  const history = useStore((s) => s.history);
  const units = useStore((s) => s.profile?.units ?? "kg");
  const [tab, setTab] = useState<"sessions" | "progress">("sessions");
  const [detail, setDetail] = useState<WorkoutSession | null>(null);
  const [editor, setEditor] = useState<{ open: boolean; initial: WorkoutSession | null }>({
    open: false,
    initial: null,
  });

  if (history.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="pt-2 text-2xl font-extrabold tracking-tight">History</h1>
        <EmptyState
          icon={<Calendar className="h-6 w-6" />}
          title="No workouts logged yet"
          description="Finish a workout, tell the AI coach what you did, or log one manually — it’ll show up here with calories and progress charts."
          action={
            <Button onClick={() => setEditor({ open: true, initial: null })}>
              <Plus className="h-4 w-4" />
              Log a workout
            </Button>
          }
        />
        <SessionEditor
          open={editor.open}
          initial={editor.initial}
          onClose={() => setEditor({ open: false, initial: null })}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between pt-2">
        <h1 className="text-2xl font-extrabold tracking-tight">History</h1>
        <Button size="sm" variant="outline" onClick={() => setEditor({ open: true, initial: null })}>
          <Plus className="h-4 w-4" />
          Log
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-1 rounded-xl bg-secondary p-1">
        {(["sessions", "progress"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg py-2 text-sm font-medium capitalize tap ${
              tab === t ? "bg-card shadow-sm" : "text-muted-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "sessions" ? (
        <SessionsTab history={history} units={units} onOpen={setDetail} />
      ) : (
        <ProgressTab history={history} units={units} />
      )}

      <SessionDetail
        session={detail}
        units={units}
        onClose={() => setDetail(null)}
        onClone={(s) => {
          setDetail(null);
          setEditor({ open: true, initial: s });
        }}
      />

      <SessionEditor
        open={editor.open}
        initial={editor.initial}
        onClose={() => setEditor({ open: false, initial: null })}
      />
    </div>
  );
}

// ── Sessions list ─────────────────────────────────────────────────────────────
function SessionsTab({
  history,
  units,
  onOpen,
}: {
  history: WorkoutSession[];
  units: "kg" | "lb";
  onOpen: (s: WorkoutSession) => void;
}) {
  return (
    <div className="space-y-2">
      {history.map((s) => (
        <button key={s.id} onClick={() => onOpen(s)} className="w-full text-left tap">
          <Card className="transition-colors hover:border-primary/40">
            <CardContent className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate font-semibold leading-tight">{s.routineName}</h3>
                  <p className="text-xs text-muted-foreground">
                    {format(s.startedAt, "EEE, MMM d · h:mm a")}
                  </p>
                </div>
                <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <Stat icon={Clock} text={formatDuration(s.durationSec)} />
                {(s.calories ?? 0) > 0 && (
                  <Stat icon={Flame} text={formatCalories(s.calories ?? 0)} accent />
                )}
                {s.totalVolume > 0 && <Stat icon={TrendingUp} text={formatVolume(s.totalVolume, units)} />}
                <Stat icon={Dumbbell} text={`${s.exercises.length} exercises`} />
              </div>
            </CardContent>
          </Card>
        </button>
      ))}
    </div>
  );
}

function Stat({ icon: Icon, text, accent }: { icon: typeof Clock; text: string; accent?: boolean }) {
  return (
    <span className={`flex items-center gap-1 ${accent ? "text-primary" : "text-muted-foreground"}`}>
      <Icon className="h-3.5 w-3.5" />
      {text}
    </span>
  );
}

// ── Session detail sheet ──────────────────────────────────────────────────────
function setLabel(ex: LoggedExercise, s: LoggedExercise["sets"][number], units: string): string {
  const kind = ex.kind ?? resolveKind(ex);
  if (kind === "strength") {
    return s.weight > 0 ? `${s.weight} ${units} × ${s.reps}` : `${s.reps} reps`;
  }
  const mins = s.durationSec ? Math.round(s.durationSec / 60) : s.reps; // legacy fallback
  const dist = s.distanceKm ? ` · ${s.distanceKm} km` : "";
  return `${mins} min${dist}`;
}

function SessionDetail({
  session,
  units,
  onClose,
  onClone,
}: {
  session: WorkoutSession | null;
  units: "kg" | "lb";
  onClose: () => void;
  onClone: (s: WorkoutSession) => void;
}) {
  const navigate = useNavigate();
  const startWorkoutFromSession = useStore((s) => s.startWorkoutFromSession);
  const deleteWorkout = useStore((s) => s.deleteWorkout);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!session) return null;
  const cardioMin = session.exercises
    .filter((ex) => resolveKind(ex) !== "strength")
    .reduce((sum, ex) => sum + exerciseDuration(ex), 0);

  return (
    <Modal open={!!session} onClose={onClose} title={session.routineName}>
      <p className="-mt-1 mb-3 text-xs text-muted-foreground">
        {format(session.startedAt, "EEE, MMM d yyyy · h:mm a")}
      </p>

      {/* Summary chips */}
      <div className="mb-4 grid grid-cols-4 gap-2 text-center">
        <SummaryChip label="Time" value={formatDuration(session.durationSec)} />
        <SummaryChip label="Calories" value={`${Math.round(session.calories ?? 0)}`} accent />
        <SummaryChip label="Volume" value={`${Math.round(session.totalVolume)}`} />
        <SummaryChip label="Cardio" value={cardioMin > 0 ? minutesLabel(cardioMin) : "—"} />
      </div>

      {/* Exercise breakdown */}
      <div className="space-y-2">
        {session.exercises.map((ex, i) => {
          const Icon = KIND_ICON[ex.kind ?? resolveKind(ex)];
          return (
            <div key={i} className="rounded-xl border border-border bg-card p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-primary" />
                  <span className="font-medium leading-tight">{ex.name}</span>
                </div>
                {(ex.calories ?? 0) > 0 && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Flame className="h-3 w-3" />
                    {Math.round(ex.calories ?? 0)}
                  </span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {ex.sets.map((s, j) => (
                  <span
                    key={j}
                    className="rounded-md bg-secondary px-2 py-1 text-xs font-medium text-muted-foreground"
                  >
                    {setLabel(ex, s, units)}
                    {s.rpe ? ` · RPE ${s.rpe}` : ""}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button
          variant="default"
          onClick={() => {
            startWorkoutFromSession(session);
            navigate("/workout");
          }}
        >
          <RotateCw className="h-4 w-4" />
          Repeat
        </Button>
        <Button variant="outline" onClick={() => onClone(session)}>
          <Copy className="h-4 w-4" />
          Clone & edit
        </Button>
      </div>
      <button
        onClick={() => setConfirmDelete(true)}
        className="mt-2 flex w-full items-center justify-center gap-1.5 py-2 text-sm text-destructive tap"
      >
        <Trash2 className="h-4 w-4" />
        Delete session
      </button>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this session?" sheet={false}>
        <p className="text-sm text-muted-foreground">This permanently removes it from your history.</p>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => setConfirmDelete(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            className="flex-1"
            onClick={() => {
              void deleteWorkout(session.id);
              setConfirmDelete(false);
              onClose();
            }}
          >
            Delete
          </Button>
        </div>
      </Modal>
    </Modal>
  );
}

function SummaryChip({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl bg-secondary py-2">
      <p className={`text-base font-bold leading-none ${accent ? "text-primary" : ""}`}>{value}</p>
      <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}

// ── Progress dashboard ────────────────────────────────────────────────────────
const RANGES: { label: string; days: number; weeks: number }[] = [
  { label: "4W", days: 28, weeks: 4 },
  { label: "12W", days: 84, weeks: 12 },
  { label: "All", days: 3650, weeks: 26 },
];

function ProgressTab({ history, units }: { history: WorkoutSession[]; units: "kg" | "lb" }) {
  const [rangeIdx, setRangeIdx] = useState(0);
  const [chartExercise, setChartExercise] = useState<string | null>(null);
  const range = RANGES[rangeIdx];

  const summary = useMemo(() => rangeSummary(history, range.days), [history, range.days]);
  const series = useMemo(() => weeklySeries(history, range.weeks), [history, range.weeks]);
  const trends = useMemo(() => exerciseTrends(history), [history]);
  const prs = useMemo(() => personalRecords(history).slice(0, 6), [history]);

  const chart = useMemo(
    () => (chartExercise ? exerciseSeries(history, chartExercise) : null),
    [chartExercise, history]
  );
  const chartUnit = chart ? metricUnit(chart.metric, units) : "";

  return (
    <div className="space-y-4">
      {/* Range selector */}
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-secondary p-1">
        {RANGES.map((r, i) => (
          <button
            key={r.label}
            onClick={() => setRangeIdx(i)}
            className={`rounded-lg py-1.5 text-xs font-semibold tap ${
              i === rangeIdx ? "bg-card shadow-sm" : "text-muted-foreground"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-2">
        <SummaryCard icon={Flame} label="Calories burned" value={formatCalories(summary.calories)} accent />
        <SummaryCard icon={TrendingUp} label="Total volume" value={formatVolume(summary.volume, units)} />
        <SummaryCard icon={Activity} label="Sessions" value={String(summary.sessions)} />
        <SummaryCard icon={HeartPulse} label="Cardio" value={`${summary.cardioMin} min`} />
      </div>

      {/* Calories chart */}
      <ChartCard title="Calories burned / week" icon={Flame}>
        <BarChart data={series} margin={{ top: 5, right: 8, left: -22, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={10} />
          <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} />
          <Tooltip cursor={{ fill: "hsl(var(--accent))" }} contentStyle={tooltipStyle} />
          <Bar dataKey="calories" name="kcal" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ChartCard>

      {/* Volume chart */}
      <ChartCard title="Training volume / week" icon={TrendingUp}>
        <LineChart data={series} margin={{ top: 5, right: 8, left: -22, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={10} />
          <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} />
          <Tooltip contentStyle={tooltipStyle} />
          <Line type="monotone" dataKey="volume" name={units} stroke="hsl(var(--primary))" strokeWidth={2.5} dot={{ r: 2 }} />
        </LineChart>
      </ChartCard>

      {/* Personal records */}
      {prs.length > 0 && (
        <div>
          <SectionLabel icon={Trophy} text="Personal records" />
          <div className="grid grid-cols-2 gap-2">
            {prs.map((pr) => (
              <div key={pr.name} className="rounded-xl border border-border bg-card p-3">
                <p className="truncate text-sm font-semibold leading-tight">{pr.name}</p>
                <p className="mt-1 text-lg font-bold text-primary">
                  {pr.value} <span className="text-xs font-medium text-muted-foreground">{metricUnit(pr.metric, units)}</span>
                </p>
                <p className="text-[11px] text-muted-foreground">{format(pr.at, "MMM d")}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-exercise trends */}
      <div>
        <SectionLabel icon={Activity} text="Exercise trends" />
        <p className="mb-2 text-xs text-muted-foreground">Tap an exercise to chart its progress.</p>
        <div className="space-y-2">
          {trends.map((t) => (
            <button
              key={t.name}
              onClick={() => setChartExercise(t.name)}
              className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-3 text-left tap hover:border-primary/40"
            >
              <div className="flex-1 min-w-0">
                <p className="truncate font-medium leading-tight">{t.name}</p>
                <p className="text-xs text-muted-foreground">
                  {t.sessions} sessions · best {t.best} {metricUnit(t.metric, units)}
                </p>
              </div>
              {t.stalled ? (
                <Badge variant="muted">Stalled</Badge>
              ) : (
                <Badge variant={t.deltaPct >= 0 ? "success" : "muted"}>
                  {t.deltaPct >= 0 ? "+" : ""}
                  {t.deltaPct}%
                </Badge>
              )}
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          ))}
          {trends.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Log a few sessions to unlock progress charts.
            </p>
          )}
        </div>
      </div>

      <Modal open={!!chartExercise} onClose={() => setChartExercise(null)} title={chartExercise ?? ""}>
        <p className="mb-3 text-sm text-muted-foreground">
          {chart?.metric === "e1rm"
            ? `Estimated 1RM (${chartUnit})`
            : chart?.metric === "reps"
              ? "Best set (reps)"
              : chart?.metric === "distance"
                ? "Distance (km)"
                : "Duration (min)"}{" "}
          over time
        </p>
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chart?.points ?? []} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} domain={["auto", "auto"]} />
              <Tooltip contentStyle={tooltipStyle} />
              <Line
                type="monotone"
                dataKey="value"
                name={chartUnit || "value"}
                stroke="hsl(var(--primary))"
                strokeWidth={2.5}
                dot={{ r: 3, fill: "hsl(var(--primary))" }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Modal>
    </div>
  );
}

const tooltipStyle = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 12,
  fontSize: 12,
};

function SummaryCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof Flame;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className={`h-3.5 w-3.5 ${accent ? "text-primary" : ""}`} />
        {label}
      </div>
      <p className={`mt-1 text-xl font-extrabold ${accent ? "text-primary" : ""}`}>{value}</p>
    </div>
  );
}

function ChartCard({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Flame;
  children: React.ReactElement;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
        <Icon className="h-4 w-4 text-primary" />
        {title}
      </div>
      <div className="h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function SectionLabel({ icon: Icon, text }: { icon: typeof Flame; text: string }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{text}</h2>
    </div>
  );
}
