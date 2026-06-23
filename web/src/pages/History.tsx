import { useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { Calendar, Clock, TrendingUp, Dumbbell, CloudOff, Cloud, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { useStore } from "@/lib/store";
import { estimate1RM, formatDuration, formatVolume } from "@/lib/utils";
import { exerciseTrends } from "@/lib/analytics";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, EmptyState } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";

export function History() {
  const history = useStore((s) => s.history);
  const units = useStore((s) => s.profile?.units ?? "kg");
  const [chartExercise, setChartExercise] = useState<string | null>(null);
  const [tab, setTab] = useState<"sessions" | "progress">("sessions");

  const trends = useMemo(() => exerciseTrends(history), [history]);

  const chartData = useMemo(() => {
    if (!chartExercise) return [];
    const points: { date: string; e1rm: number; weight: number }[] = [];
    [...history].reverse().forEach((s) => {
      s.exercises
        .filter((e) => e.name === chartExercise)
        .forEach((e) => {
          let best = 0;
          let bestW = 0;
          e.sets.forEach((st) => {
            const r = estimate1RM(st.weight, st.reps);
            if (r > best) {
              best = r;
              bestW = st.weight;
            }
          });
          if (best > 0)
            points.push({ date: format(s.startedAt, "MMM d"), e1rm: best, weight: bestW });
        });
    });
    return points;
  }, [chartExercise, history]);

  if (history.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="pt-2 text-2xl font-extrabold tracking-tight">History</h1>
        <EmptyState
          icon={<Calendar className="h-6 w-6" />}
          title="No workouts logged yet"
          description="Finish your first workout and it’ll show up here with volume and progress charts."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="pt-2 text-2xl font-extrabold tracking-tight">History</h1>

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
        <div className="space-y-2">
          {history.map((s) => (
            <Card key={s.id}>
              <CardContent className="p-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold leading-tight">{s.routineName}</h3>
                    <p className="text-xs text-muted-foreground">
                      {format(s.startedAt, "EEE, MMM d · h:mm a")}
                    </p>
                  </div>
                  <Badge variant={s.synced ? "success" : "muted"} className="gap-1">
                    {s.synced ? <Cloud className="h-3 w-3" /> : <CloudOff className="h-3 w-3" />}
                    {s.synced ? "Synced" : "Pending"}
                  </Badge>
                </div>
                <div className="mt-3 flex gap-4 text-sm">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    {formatDuration(s.durationSec)}
                  </span>
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <TrendingUp className="h-3.5 w-3.5" />
                    {formatVolume(s.totalVolume, units)}
                  </span>
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Dumbbell className="h-3.5 w-3.5" />
                    {s.exercises.length} exercises
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Tap an exercise to see your estimated 1RM trend. This data feeds the AI refresh.
          </p>
          {trends.map((t) => (
            <button
              key={t.name}
              onClick={() => setChartExercise(t.name)}
              className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-3 text-left tap hover:border-primary/40"
            >
              <div className="flex-1">
                <p className="font-medium leading-tight">{t.name}</p>
                <p className="text-xs text-muted-foreground">
                  {t.sessions} sessions · best {t.last1RM} {units} e1RM
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
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          ))}
          {trends.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Complete a few sets to unlock progress charts.
            </p>
          )}
        </div>
      )}

      <Modal open={!!chartExercise} onClose={() => setChartExercise(null)} title={chartExercise ?? ""}>
        <p className="mb-3 text-sm text-muted-foreground">Estimated 1RM ({units}) over time</p>
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} domain={["auto", "auto"]} />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 12,
                  fontSize: 12,
                }}
              />
              <Line
                type="monotone"
                dataKey="e1rm"
                name="Est. 1RM"
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
