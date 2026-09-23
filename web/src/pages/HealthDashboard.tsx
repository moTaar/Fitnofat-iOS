import { useEffect, useMemo, useState } from "react";
import {
  Activity, AlertTriangle, ArrowDown, ArrowUp, Ban, CalendarClock, Check, ChevronDown,
  ClipboardList, CircleCheck, HeartPulse, Loader2, Lock, PlayCircle, Plus, RefreshCw,
  ShieldCheck, Stethoscope, Trash2, X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useStore } from "@/lib/store";
import { toast } from "@/lib/toast";
import { isEntitled } from "@/lib/entitlements";
import { UpgradeRequiredError } from "@/lib/api";
import type {
  HealthIssue, HealthIssueCategory, HealthIssueSeverity, HealthIssueStatus, HealthRecordKind,
  HealthRule, RuleDirection, RuleDomain,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Badge, EmptyState, Progress, Spinner } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

// Severity drives the entire visual hierarchy of the list — an urgent item must
// be unmissable among a dozen low-severity ones.
const SEVERITY_STYLE: Record<HealthIssueSeverity, { dot: string; label: string; ring: string }> = {
  urgent: { dot: "bg-destructive", label: "Urgent", ring: "border-destructive/50" },
  high: { dot: "bg-orange-500", label: "High", ring: "border-orange-500/40" },
  moderate: { dot: "bg-amber-500", label: "Moderate", ring: "border-border" },
  low: { dot: "bg-sky-500", label: "Low", ring: "border-border" },
};
const SEVERITY_RANK: Record<HealthIssueSeverity, number> = { urgent: 0, high: 1, moderate: 2, low: 3 };

const STATUS_LABEL: Record<HealthIssueStatus, string> = {
  open: "Open",
  in_progress: "Working on it",
  monitoring: "Monitoring",
  resolved: "Resolved",
  dismissed: "Dismissed",
};
const OPEN_STATUSES: HealthIssueStatus[] = ["open", "in_progress", "monitoring"];

const CATEGORIES: HealthIssueCategory[] = [
  "injury", "pain", "nutrition", "metabolic", "sleep", "stress", "medical", "lifestyle", "other",
];
const RECORD_KINDS: HealthRecordKind[] = [
  "symptom", "condition", "medication", "allergy", "injury",
  "surgery", "lab", "vitals", "appointment", "note",
];

const dateLabel = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

// The five directions, in the order they're shown. Avoid first: the list is
// most useful when the hard stops are the first thing you see.
const DIRECTIONS: RuleDirection[] = ["avoid", "less", "more", "start", "keep"];

const DIRECTION_META: Record<
  RuleDirection,
  { label: string; icon: typeof Ban; chip: string; dot: string }
> = {
  avoid:  { label: "Avoid",      icon: Ban,         chip: "border-destructive/40 bg-destructive/10 text-destructive", dot: "bg-destructive" },
  less:   { label: "Less",       icon: ArrowDown,   chip: "border-amber-500/40 bg-amber-500/10 text-amber-500",       dot: "bg-amber-500" },
  more:   { label: "More",       icon: ArrowUp,     chip: "border-success/40 bg-success/10 text-success",             dot: "bg-success" },
  start:  { label: "Start",      icon: PlayCircle,  chip: "border-sky-500/40 bg-sky-500/10 text-sky-500",             dot: "bg-sky-500" },
  keep:   { label: "Keep doing", icon: CircleCheck, chip: "border-border bg-secondary text-muted-foreground",         dot: "bg-muted-foreground" },
};

const DOMAINS: RuleDomain[] = ["nutrition", "physical", "medical", "lifestyle"];

type Tab = "issues" | "rules" | "history" | "background";

export function HealthDashboard() {
  const navigate = useNavigate();
  const health = useStore((s) => s.health);
  const issues = useStore((s) => s.healthIssues);
  const records = useStore((s) => s.healthRecords);
  const rules = useStore((s) => s.healthRules);
  const ai = useStore((s) => s.medicalAi);
  const loading = useStore((s) => s.healthLoading);
  const loaded = useStore((s) => s.healthLoaded);
  const subscription = useStore((s) => s.subscription);
  const loadHealth = useStore((s) => s.loadHealth);
  const setHealthConsent = useStore((s) => s.setHealthConsent);
  const runHealthReview = useStore((s) => s.runHealthReview);
  const updateHealthIssue = useStore((s) => s.updateHealthIssue);

  const [tab, setTab] = useState<Tab>("issues");
  const [showResolved, setShowResolved] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [addingIssue, setAddingIssue] = useState(false);
  // Keys the last review believes are done. Applied only when the user taps.
  const [resolvedSuggestions, setResolvedSuggestions] = useState<string[]>([]);

  const entitled = isEntitled(subscription, "ai_medical");
  const consented = !!health?.aiConsentAt;

  useEffect(() => {
    void loadHealth();
  }, [loadHealth]);

  const visible = useMemo(() => {
    const list = issues.filter((i) =>
      showResolved ? !OPEN_STATUSES.includes(i.status) : OPEN_STATUSES.includes(i.status)
    );
    return [...list].sort(
      (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.updatedAt - a.updatedAt
    );
  }, [issues, showResolved]);

  const openCount = issues.filter((i) => OPEN_STATUSES.includes(i.status)).length;
  const activeRules = rules.filter((r) => r.status === "active").length;
  const urgent = issues.filter((i) => i.severity === "urgent" && OPEN_STATUSES.includes(i.status));

  const handleReview = async () => {
    setReviewing(true);
    try {
      const result = await runHealthReview();
      setResolvedSuggestions(result.resolvedSuggestions);
      toast.success(
        result.created || result.updated
          ? `Review done — ${result.created} new, ${result.updated} updated.`
          : "Review done — nothing new to flag."
      );
    } catch (e) {
      if (e instanceof UpgradeRequiredError) {
        toast.error("The AI health review is a Pro feature.");
        navigate("/billing");
      } else {
        toast.error(e instanceof Error ? e.message : "The review failed. Try again shortly.");
      }
    } finally {
      setReviewing(false);
    }
  };

  const handleConsent = async (granted: boolean) => {
    try {
      await setHealthConsent(granted);
      toast.success(
        granted ? "AI health analysis is on." : "AI health analysis is off. Your data stays put."
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save that.");
    }
  };

  if (!loaded && loading) {
    return (
      <div className="flex min-h-[50dvh] items-center justify-center">
        <Spinner className="text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 pt-2">
        <div className="flex items-center gap-2">
          <div className="rounded-xl bg-primary/15 p-2 text-primary">
            <HeartPulse className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold leading-tight tracking-tight">Medical</h1>
            <p className="text-xs text-muted-foreground">
              {openCount} thing{openCount === 1 ? "" : "s"} to work on
              {activeRules ? ` · ${activeRules} rule${activeRules === 1 ? "" : "s"}` : ""}
              {health?.lastReviewAt ? ` · reviewed ${dateLabel(health.lastReviewAt)}` : ""}
            </p>
          </div>
        </div>
        <Button
          size="sm"
          onClick={handleReview}
          disabled={reviewing || !consented || !ai?.available}
          title={consented ? "Re-run the AI health review" : "Turn on AI health analysis first"}
        >
          {reviewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Review
        </Button>
      </div>

      {/* Urgent banner — anything the review marked urgent gets its own shout. */}
      {urgent.length > 0 && (
        <div className="flex gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div>
            <p className="font-semibold text-destructive">Needs attention soon</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {urgent.map((i) => i.title).join(" · ")} — these were flagged as urgent. Please get
              them looked at by a clinician.
            </p>
          </div>
        </div>
      )}

      {/* Consent / entitlement gates */}
      {!entitled && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="flex gap-3 p-4">
            <Lock className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div className="flex-1">
              <p className="font-semibold">AI health analysis is a Pro feature</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Tracking issues and your medical history by hand works on any plan — the AI
                nutritionist, medical helper and automatic review need Pro.
              </p>
              <Button size="sm" className="mt-3" onClick={() => navigate("/billing")}>
                See Pro
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {entitled && !consented && (
        <Card className="border-amber-500/40 bg-amber-500/10">
          <CardContent className="flex gap-3 p-4">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            <div className="flex-1">
              <p className="font-semibold text-amber-500">Your health data stays in your database</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Everything on this page lives in your own Supabase project. To get an AI review or
                use the health chat, that record has to be sent to{" "}
                <b className="text-foreground">{ai?.model ?? "the medical model"}</b> for the length
                of the request. Nothing is sent until you turn this on, and you can turn it off at
                any time.
              </p>
              <Button size="sm" className="mt-3" onClick={() => handleConsent(true)}>
                Turn on AI health analysis
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Last review summary */}
      {health?.lastReviewSummary && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Stethoscope className="h-3.5 w-3.5" />
              Latest review
            </div>
            <p className="mt-2 text-sm leading-relaxed">{health.lastReviewSummary}</p>
            {ai?.model && (
              <p className="mt-2 text-[11px] text-muted-foreground">Answered by {ai.model}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Resolution suggestions from the last review — one tap to confirm. */}
      {resolvedSuggestions.length > 0 && (
        <Card className="border-success/40 bg-success/5">
          <CardContent className="p-4">
            <p className="text-sm font-semibold">These look resolved — close them?</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {resolvedSuggestions.map((key) => {
                const issue = issues.find((i) => i.key === key);
                if (!issue) return null;
                return (
                  <button
                    key={key}
                    onClick={async () => {
                      await updateHealthIssue(issue.id, { status: "resolved", progress: 100 });
                      setResolvedSuggestions((prev) => prev.filter((k) => k !== key));
                    }}
                    className="flex items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-3 py-1.5 text-xs font-medium text-success tap"
                  >
                    <Check className="h-3.5 w-3.5" />
                    {issue.title}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <div className="grid grid-cols-4 gap-1 rounded-xl bg-secondary p-1">
        {([
          ["issues", "To work on"],
          ["rules", "Do & Don't"],
          ["history", "History"],
          ["background", "Background"],
        ] as [Tab, string][]).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={cn(
              "rounded-lg px-2 py-2 text-xs font-semibold tap",
              tab === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "issues" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setShowResolved((v) => !v)}
              className="text-xs font-medium text-muted-foreground tap hover:text-foreground"
            >
              {showResolved ? "← Show active" : "Show closed →"}
            </button>
            <Button size="sm" variant="outline" onClick={() => setAddingIssue(true)}>
              <Plus className="h-4 w-4" />
              Track something
            </Button>
          </div>

          {visible.length === 0 ? (
            <EmptyState
              icon={<ClipboardList className="h-6 w-6" />}
              title={showResolved ? "Nothing closed yet" : "Nothing tracked yet"}
              description={
                showResolved
                  ? "Issues you resolve or dismiss land here."
                  : consented
                    ? "Run a review, or add something you already know needs work."
                    : "Add something that needs work, or turn on AI analysis for a full review."
              }
            />
          ) : (
            visible.map((issue) => <IssueCard key={issue.id} issue={issue} />)
          )}
        </div>
      )}

      {tab === "rules" && <RulesTab />}
      {tab === "history" && <HistoryTab />}
      {tab === "background" && <BackgroundTab onRevokeConsent={() => handleConsent(false)} />}

      <p className="px-1 pt-2 text-[11px] leading-relaxed text-muted-foreground">
        {ai?.disclaimer ??
          "This is general health information from an AI assistant, not a diagnosis or medical advice."}
      </p>

      <AddIssueModal open={addingIssue} onClose={() => setAddingIssue(false)} />
    </div>
  );
}

// ── One tracked issue ────────────────────────────────────────────────────────
function IssueCard({ issue }: { issue: HealthIssue }) {
  const toggleIssueStep = useStore((s) => s.toggleIssueStep);
  const updateHealthIssue = useStore((s) => s.updateHealthIssue);
  const deleteHealthIssue = useStore((s) => s.deleteHealthIssue);
  const addIssueEvent = useStore((s) => s.addIssueEvent);

  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [metric, setMetric] = useState(issue.metrics[0]?.label ?? "");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const style = SEVERITY_STYLE[issue.severity];
  const steps = issue.actionPlan;
  const doneSteps = steps.filter((s) => s.done).length;

  const logCheckIn = async () => {
    const numeric = value.trim() === "" ? undefined : Number(value);
    if (!note.trim() && numeric === undefined) return;
    if (numeric !== undefined && !Number.isFinite(numeric)) {
      toast.error("That measurement isn't a number.");
      return;
    }
    setBusy(true);
    try {
      await addIssueEvent(issue.id, {
        body: note.trim() || undefined,
        ...(numeric !== undefined ? { metric: metric || issue.metrics[0]?.label, value: numeric } : {}),
      });
      setNote("");
      setValue("");
      toast.success("Logged.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't log that.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className={cn("overflow-hidden", style.ring)}>
      <button onClick={() => setOpen((v) => !v)} className="w-full p-4 text-left tap">
        <div className="flex items-start gap-3">
          <span className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", style.dot)} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold leading-tight">{issue.title}</p>
              <ChevronDown
                className={cn(
                  "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                  open && "rotate-180"
                )}
              />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge variant="muted">{issue.category}</Badge>
              <Badge variant="outline">{style.label}</Badge>
              <Badge variant={issue.status === "in_progress" ? "default" : "outline"}>
                {STATUS_LABEL[issue.status]}
              </Badge>
              {issue.source === "ai" && <Badge variant="outline">AI</Badge>}
            </div>
            {issue.summary && (
              <p className={cn("mt-2 text-sm text-muted-foreground", !open && "line-clamp-2")}>
                {issue.summary}
              </p>
            )}
            {steps.length > 0 && (
              <div className="mt-3 space-y-1">
                <Progress value={issue.progress} />
                <p className="text-[11px] text-muted-foreground">
                  {doneSteps}/{steps.length} steps · {issue.progress}%
                </p>
              </div>
            )}
          </div>
        </div>
      </button>

      {open && (
        <CardContent className="space-y-4 border-t border-border p-4">
          {issue.whyItMatters && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Why it matters
              </p>
              <p className="mt-1 text-sm leading-relaxed">{issue.whyItMatters}</p>
            </div>
          )}

          {steps.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Plan
              </p>
              <div className="mt-2 space-y-1.5">
                {steps.map((s, i) => (
                  <button
                    key={`${s.step}-${i}`}
                    onClick={() => void toggleIssueStep(issue.id, i)}
                    className="flex w-full items-start gap-2.5 rounded-xl border border-border p-2.5 text-left tap"
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                        s.done ? "border-success bg-success text-success-foreground" : "border-input"
                      )}
                    >
                      {s.done && <Check className="h-3 w-3" />}
                    </span>
                    <span className="flex-1 text-sm">
                      <span className={cn(s.done && "text-muted-foreground line-through")}>
                        {s.step}
                      </span>
                      {s.cadence && (
                        <span className="ml-1.5 text-[11px] text-muted-foreground">({s.cadence})</span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {issue.metrics.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Tracking
              </p>
              <div className="mt-2 space-y-1.5">
                {issue.metrics.map((m) => (
                  <div
                    key={m.label}
                    className="flex items-center justify-between rounded-xl bg-secondary px-3 py-2 text-sm"
                  >
                    <span>{m.label}</span>
                    <span className="text-muted-foreground">
                      {m.latest != null ? (
                        <b className="text-foreground">
                          {m.latest}
                          {m.unit ?? ""}
                        </b>
                      ) : (
                        "—"
                      )}
                      {m.target ? ` · target ${m.target}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {issue.redFlags.length > 0 && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" />
                See a clinician if
              </p>
              <ul className="mt-1.5 space-y-1 text-sm text-muted-foreground">
                {issue.redFlags.map((f, i) => (
                  <li key={i}>• {f}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Check-in — a note, a measurement, or both. */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Log a check-in
            </p>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="How is it today?"
            />
            {issue.metrics.length > 0 && (
              <div className="flex gap-2">
                <select
                  value={metric}
                  onChange={(e) => setMetric(e.target.value)}
                  className="h-11 flex-1 rounded-xl border border-input bg-background px-3 text-sm"
                >
                  {issue.metrics.map((m) => (
                    <option key={m.label} value={m.label}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="Value"
                  className="w-28"
                />
              </div>
            )}
            <Button size="sm" className="w-full" onClick={logCheckIn} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
              Save check-in
            </Button>
          </div>

          {issue.events && issue.events.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Timeline
              </p>
              <div className="mt-2 space-y-1.5">
                {issue.events.slice(0, 6).map((e) => (
                  <div key={e.id} className="flex gap-2 text-xs text-muted-foreground">
                    <span className="shrink-0 tabular-nums">{dateLabel(e.createdAt)}</span>
                    <span className="flex-1 text-foreground">
                      {e.body ?? ""}
                      {e.value != null ? ` ${e.metric ?? ""} ${e.value}${e.unit ?? ""}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Status + delete */}
          <div className="flex flex-wrap gap-1.5 border-t border-border pt-3">
            {(Object.keys(STATUS_LABEL) as HealthIssueStatus[]).map((st) => (
              <button
                key={st}
                onClick={() =>
                  void updateHealthIssue(issue.id, {
                    status: st,
                    ...(st === "resolved" ? { progress: 100 } : {}),
                  })
                }
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] font-medium tap",
                  issue.status === st
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground"
                )}
              >
                {STATUS_LABEL[st]}
              </button>
            ))}
            <button
              onClick={() => {
                if (confirm(`Delete "${issue.title}" and its check-ins?`)) {
                  void deleteHealthIssue(issue.id);
                }
              }}
              className="ml-auto rounded-full p-1.5 text-muted-foreground tap hover:text-destructive"
              title="Delete issue"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ── Do & Don't ───────────────────────────────────────────────────────────────
// The standing rules the health chat has distilled, grouped by what to do about
// them. Everything here is editable: the AI writes a rule, you own it the moment
// you touch it (`userEdited`), and after that the AI stops rewriting that one.
function RulesTab() {
  const rules = useStore((s) => s.healthRules);
  const [domain, setDomain] = useState<RuleDomain | "all">("all");
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState(false);

  const visible = useMemo(() => {
    return rules.filter((r) => {
      if (showArchived ? r.status !== "archived" : r.status === "archived") return false;
      return domain === "all" || r.domain === domain;
    });
  }, [rules, domain, showArchived]);

  const grouped = useMemo(
    () => DIRECTIONS.map((d) => [d, visible.filter((r) => r.direction === d)] as const)
      .filter(([, list]) => list.length > 0),
    [visible]
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {(["all", ...DOMAINS] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDomain(d)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] font-medium tap",
                domain === d
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground"
              )}
            >
              {d}
            </button>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={() => setAdding(true)} className="shrink-0">
          <Plus className="h-4 w-4" />
          Add
        </Button>
      </div>

      <button
        onClick={() => setShowArchived((v) => !v)}
        className="text-xs font-medium text-muted-foreground tap hover:text-foreground"
      >
        {showArchived ? "← Show active" : "Show archived →"}
      </button>

      {grouped.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-6 w-6" />}
          title={showArchived ? "Nothing archived" : "No rules yet"}
          description={
            showArchived
              ? "Rules you archive land here, and the AI won't bring them back."
              : "Talk to the health desk about a symptom or your diet — what it works out lands here automatically. You can also add rules yourself."
          }
        />
      ) : (
        grouped.map(([direction, list]) => {
          const meta = DIRECTION_META[direction];
          const Icon = meta.icon;
          return (
            <div key={direction} className="space-y-2">
              <div className="flex items-center gap-2 pt-1">
                <span className={cn("flex h-6 w-6 items-center justify-center rounded-lg", meta.chip)}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <h2 className="text-sm font-bold tracking-tight">{meta.label}</h2>
                <span className="text-xs text-muted-foreground">{list.length}</span>
              </div>
              {list.map((rule) => (
                <RuleCard key={rule.id} rule={rule} />
              ))}
            </div>
          );
        })
      )}

      <AddRuleModal open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function RuleCard({ rule }: { rule: HealthRule }) {
  const updateHealthRule = useStore((s) => s.updateHealthRule);
  const deleteHealthRule = useStore((s) => s.deleteHealthRule);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(rule.subject);
  const [detail, setDetail] = useState(rule.detail ?? "");

  const meta = DIRECTION_META[rule.direction];

  const save = async () => {
    if (!subject.trim()) return;
    await updateHealthRule(rule.id, {
      subject: subject.trim(),
      detail: detail.trim() || undefined,
    });
    setEditing(false);
  };

  return (
    <Card className={cn(rule.status === "paused" && "opacity-60")}>
      <button onClick={() => setOpen((v) => !v)} className="w-full p-3 text-left tap">
        <div className="flex items-start gap-2.5">
          <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", meta.dot)} />
          <div className="min-w-0 flex-1">
            <p className="font-medium leading-tight">{rule.subject}</p>
            {rule.detail && (
              <p className={cn("mt-0.5 text-sm text-muted-foreground", !open && "line-clamp-1")}>
                {rule.detail}
              </p>
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge variant="muted">{rule.domain}</Badge>
              {rule.status === "paused" && <Badge variant="outline">paused</Badge>}
              {rule.source === "ai" && !rule.userEdited && <Badge variant="outline">AI</Badge>}
              {rule.userEdited && <Badge variant="outline">yours</Badge>}
            </div>
          </div>
          <ChevronDown
            className={cn(
              "mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180"
            )}
          />
        </div>
      </button>

      {open && (
        <CardContent className="space-y-3 border-t border-border p-3">
          {rule.reason && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Why
              </p>
              <p className="mt-1 text-sm leading-relaxed">{rule.reason}</p>
            </div>
          )}

          {editing ? (
            <div className="space-y-2">
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
              <textarea
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                rows={2}
                placeholder="The specifics — how much, when, what instead"
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-base placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={save} disabled={!subject.trim()}>
                  <Check className="h-4 w-4" />
                  Save
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Edit wording
            </Button>
          )}

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Change to
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {DIRECTIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => void updateHealthRule(rule.id, { direction: d })}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11px] font-medium tap",
                    rule.direction === d
                      ? DIRECTION_META[d].chip
                      : "border-border text-muted-foreground"
                  )}
                >
                  {DIRECTION_META[d].label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
            <button
              onClick={() =>
                void updateHealthRule(rule.id, {
                  status: rule.status === "paused" ? "active" : "paused",
                })
              }
              className="rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground tap"
            >
              {rule.status === "paused" ? "Resume" : "Pause"}
            </button>
            <button
              onClick={() =>
                void updateHealthRule(rule.id, {
                  status: rule.status === "archived" ? "active" : "archived",
                })
              }
              className="rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground tap"
              title="Archived rules stay out of the AI's way"
            >
              {rule.status === "archived" ? "Restore" : "Archive"}
            </button>
            <button
              onClick={() => {
                if (confirm(`Delete "${rule.subject}"?`)) void deleteHealthRule(rule.id);
              }}
              className="ml-auto rounded-full p-1.5 text-muted-foreground tap hover:text-destructive"
              title="Delete rule"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function AddRuleModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const createHealthRule = useStore((s) => s.createHealthRule);
  const [subject, setSubject] = useState("");
  const [detail, setDetail] = useState("");
  const [direction, setDirection] = useState<RuleDirection>("less");
  const [domain, setDomain] = useState<RuleDomain>("nutrition");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!subject.trim()) return;
    setBusy(true);
    try {
      await createHealthRule({
        subject: subject.trim(),
        detail: detail.trim() || undefined,
        direction,
        domain,
      });
      setSubject("");
      setDetail("");
      onClose();
      toast.success("Added to your list.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add that.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add a rule">
      <div className="space-y-3">
        <div>
          <Label htmlFor="rule-subject">What</Label>
          <Input
            id="rule-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. Coffee after 16:00"
            className="mt-1.5"
          />
        </div>
        <div>
          <Label>Do what about it</Label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {DIRECTIONS.map((d) => (
              <button
                key={d}
                onClick={() => setDirection(d)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium tap",
                  direction === d ? DIRECTION_META[d].chip : "border-border text-muted-foreground"
                )}
              >
                {DIRECTION_META[d].label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label>Area</Label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {DOMAINS.map((d) => (
              <button
                key={d}
                onClick={() => setDomain(d)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium tap",
                  domain === d
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground"
                )}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label htmlFor="rule-detail">Specifics (optional)</Label>
          <textarea
            id="rule-detail"
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            rows={2}
            placeholder="How much, when, what instead"
            className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-base placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <Button className="w-full" onClick={save} disabled={busy || !subject.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add rule
        </Button>
      </div>
    </Modal>
  );
}

// ── Medical history ──────────────────────────────────────────────────────────
function HistoryTab() {
  const records = useStore((s) => s.healthRecords);
  const addHealthRecord = useStore((s) => s.addHealthRecord);
  const deleteHealthRecord = useStore((s) => s.deleteHealthRecord);

  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<HealthRecordKind>("symptom");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [when, setWhen] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await addHealthRecord({
        kind,
        title: title.trim(),
        detail: detail.trim() || undefined,
        occurredAt: new Date(`${when}T12:00:00`).getTime(),
      });
      setTitle("");
      setDetail("");
      setAdding(false);
      toast.success("Added to your history.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save that.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" />
          Add entry
        </Button>
      </div>

      {records.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="h-6 w-6" />}
          title="No medical history yet"
          description="Log symptoms, diagnoses, labs, medication changes and appointments here — the AI reads this when it reviews you."
        />
      ) : (
        <div className="space-y-2">
          {records.map((r) => (
            <Card key={r.id}>
              <CardContent className="flex items-start gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="muted">{r.kind}</Badge>
                    <span className="text-xs text-muted-foreground">{dateLabel(r.occurredAt)}</span>
                    {r.source === "ai" && <Badge variant="outline">from chat</Badge>}
                  </div>
                  <p className="mt-1 font-medium leading-tight">{r.title}</p>
                  {r.detail && (
                    <p className="mt-0.5 text-sm text-muted-foreground">{r.detail}</p>
                  )}
                </div>
                <button
                  onClick={() => {
                    if (confirm(`Delete "${r.title}"?`)) void deleteHealthRecord(r.id);
                  }}
                  className="shrink-0 rounded-full p-1.5 text-muted-foreground tap hover:text-destructive"
                  title="Delete entry"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="Add to medical history">
        <div className="space-y-3">
          <div>
            <Label>Type</Label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {RECORD_KINDS.map((k) => (
                <button
                  key={k}
                  onClick={() => setKind(k)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs font-medium tap",
                    kind === k
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground"
                  )}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label htmlFor="record-title">What happened</Label>
            <Input
              id="record-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Lower back pain after deadlifts"
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="record-detail">Details (optional)</Label>
            <textarea
              id="record-detail"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              rows={3}
              placeholder="Values, doses, what the doctor said…"
              className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-base placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <Label htmlFor="record-date">When</Label>
            <Input
              id="record-date"
              type="date"
              value={when}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setWhen(e.target.value)}
              className="mt-1.5"
            />
          </div>
          <Button className="w-full" onClick={save} disabled={busy || !title.trim()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save entry
          </Button>
        </div>
      </Modal>
    </div>
  );
}

// ── Standing medical background ──────────────────────────────────────────────
function BackgroundTab({ onRevokeConsent }: { onRevokeConsent: () => void }) {
  const health = useStore((s) => s.health);
  const updateHealthProfile = useStore((s) => s.updateHealthProfile);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState(health?.notes ?? "");
  const [sleep, setSleep] = useState(health?.sleepHours?.toString() ?? "");
  const [bloodType, setBloodType] = useState(health?.bloodType ?? "");

  const save = async (patch: Parameters<typeof updateHealthProfile>[0]) => {
    setBusy(true);
    try {
      await updateHealthProfile(patch);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save that.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <ChipList
        label="Conditions"
        placeholder="e.g. Asthma"
        values={health?.conditions ?? []}
        onChange={(conditions) => void save({ conditions })}
      />
      <ChipList
        label="Allergies"
        placeholder="e.g. Penicillin"
        values={health?.allergies ?? []}
        onChange={(allergies) => void save({ allergies })}
      />
      <ChipList
        label="Medications"
        placeholder="e.g. Levothyroxine 50µg daily"
        values={(health?.medications ?? []).map((m) =>
          [m.name, m.dose, m.schedule].filter(Boolean).join(" ")
        )}
        onChange={(list) => void save({ medications: list.map((name) => ({ name })) })}
      />
      <ChipList
        label="Past surgeries"
        placeholder="e.g. ACL repair 2019"
        values={health?.surgeries ?? []}
        onChange={(surgeries) => void save({ surgeries })}
      />
      <ChipList
        label="Family history"
        placeholder="e.g. Father — type 2 diabetes"
        values={health?.familyHistory ?? []}
        onChange={(familyHistory) => void save({ familyHistory })}
      />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="sleep">Sleep (h/night)</Label>
          <Input
            id="sleep"
            type="number"
            inputMode="decimal"
            value={sleep}
            onChange={(e) => setSleep(e.target.value)}
            onBlur={() => {
              const n = Number(sleep);
              if (sleep.trim() && Number.isFinite(n)) void save({ sleepHours: n });
            }}
            className="mt-1.5"
          />
        </div>
        <div>
          <Label htmlFor="blood">Blood type</Label>
          <Input
            id="blood"
            value={bloodType}
            onChange={(e) => setBloodType(e.target.value)}
            onBlur={() => bloodType !== health?.bloodType && void save({ bloodType })}
            placeholder="O+"
            className="mt-1.5"
          />
        </div>
      </div>

      <OptionRow
        label="Stress"
        options={["low", "moderate", "high"]}
        value={health?.stressLevel}
        onChange={(stressLevel) => void save({ stressLevel })}
      />
      <OptionRow
        label="Smoking"
        options={["never", "former", "current"]}
        value={health?.smoking}
        onChange={(smoking) => void save({ smoking })}
      />
      <OptionRow
        label="Alcohol"
        options={["none", "occasional", "regular", "heavy"]}
        value={health?.alcohol}
        onChange={(alcohol) => void save({ alcohol })}
      />

      <div>
        <Label htmlFor="health-notes">Anything else the AI should know</Label>
        <textarea
          id="health-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes !== (health?.notes ?? "") && void save({ notes })}
          rows={4}
          placeholder="Recurring issues, what your doctor has told you, things that flare up…"
          className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-base placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {health?.aiConsentAt && (
        <Card>
          <CardContent className="flex items-start gap-3 p-4">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" />
            <div className="flex-1">
              <p className="text-sm font-semibold">AI health analysis is on</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Enabled {dateLabel(health.aiConsentAt)}. Turning it off stops any health data from
                being sent to the model — your records stay exactly where they are.
              </p>
              <Button size="sm" variant="outline" className="mt-3" onClick={onRevokeConsent}>
                Turn off
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {busy && <p className="text-center text-xs text-muted-foreground">Saving…</p>}
    </div>
  );
}

function ChipList({
  label,
  values,
  placeholder,
  onChange,
}: {
  label: string;
  values: string[];
  placeholder: string;
  onChange: (values: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const v = draft.trim();
    if (!v || values.includes(v)) {
      setDraft("");
      return;
    }
    onChange([...values, v]);
    setDraft("");
  };

  return (
    <div>
      <Label>{label}</Label>
      {values.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {values.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs"
            >
              {v}
              <button
                onClick={() => onChange(values.filter((x) => x !== v))}
                className="text-muted-foreground tap hover:text-destructive"
                aria-label={`Remove ${v}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="mt-1.5 flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder={placeholder}
        />
        <Button variant="outline" onClick={add} disabled={!draft.trim()} className="shrink-0 px-3">
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function OptionRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o}
            onClick={() => onChange(o)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium tap",
              value === o
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground"
            )}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

function AddIssueModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const createHealthIssue = useStore((s) => s.createHealthIssue);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [category, setCategory] = useState<HealthIssueCategory>("other");
  const [severity, setSeverity] = useState<HealthIssueSeverity>("moderate");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await createHealthIssue({
        title: title.trim(),
        summary: summary.trim() || undefined,
        category,
        severity,
      });
      setTitle("");
      setSummary("");
      onClose();
      toast.success("Tracking it.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create that.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Track something">
      <div className="space-y-3">
        <div>
          <Label htmlFor="issue-title">What needs working on</Label>
          <Input
            id="issue-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Left shoulder pain on overhead press"
            className="mt-1.5"
          />
        </div>
        <div>
          <Label htmlFor="issue-summary">Detail (optional)</Label>
          <textarea
            id="issue-summary"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={3}
            className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-base placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <Label>Category</Label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium tap",
                  category === c
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground"
                )}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label>Severity</Label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {(Object.keys(SEVERITY_STYLE) as HealthIssueSeverity[]).map((sv) => (
              <button
                key={sv}
                onClick={() => setSeverity(sv)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium tap",
                  severity === sv
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground"
                )}
              >
                {SEVERITY_STYLE[sv].label}
              </button>
            ))}
          </div>
        </div>
        <Button className="w-full" onClick={save} disabled={busy || !title.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Start tracking
        </Button>
      </div>
    </Modal>
  );
}
