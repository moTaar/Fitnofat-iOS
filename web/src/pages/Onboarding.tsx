import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight, ArrowLeft, Dumbbell, Sparkles, Target, Calendar,
  Trophy, AlertCircle, Check,
} from "lucide-react";
import { useStore } from "@/lib/store";
import type { Equipment, Experience, Goal, UserProfile } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { SegmentedControl, Spinner, Progress } from "@/components/ui/misc";

const GOALS: { label: string; value: Goal; sub: string }[] = [
  { label: "Strength", value: "strength", sub: "Lift heavier" },
  { label: "Muscle", value: "hypertrophy", sub: "Build size" },
  { label: "Weight Loss", value: "weight_loss", sub: "Burn fat" },
  { label: "Endurance", value: "endurance", sub: "Last longer" },
  { label: "General", value: "general", sub: "Stay fit" },
];

const EQUIPMENT: { label: string; value: Equipment; sub: string }[] = [
  { label: "Full Gym", value: "full_gym", sub: "Everything" },
  { label: "Home Gym", value: "home_gym", sub: "Barbell + rack" },
  { label: "Dumbbells", value: "dumbbells", sub: "DBs only" },
  { label: "Bodyweight", value: "bodyweight", sub: "No equipment" },
];

const EXPERIENCE: { label: string; value: Experience; sub: string }[] = [
  { label: "Beginner", value: "beginner", sub: "< 1 yr" },
  { label: "Intermediate", value: "intermediate", sub: "1–3 yrs" },
  { label: "Advanced", value: "advanced", sub: "3+ yrs" },
];

const TOTAL_STEPS = 5;

export function Onboarding() {
  const navigate = useNavigate();
  const generateProgram = useStore((s) => s.generateProgram);

  const [step, setStep] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [profile, setProfile] = useState<UserProfile>({
    name: "",
    goal: "hypertrophy",
    equipment: "full_gym",
    experience: "beginner",
    daysPerWeek: 3,
    sessionMinutes: 60,
    units: "kg",
    notes: "",
  });

  const update = <K extends keyof UserProfile>(key: K, value: UserProfile[K]) =>
    setProfile((p) => ({ ...p, [key]: value }));

  const next = () => setStep((s) => Math.min(TOTAL_STEPS - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      await generateProgram(profile);
      navigate("/", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate program.");
      setGenerating(false);
    }
  };

  if (generating) {
    return (
      <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col items-center justify-center gap-6 px-8 text-center">
        <div className="relative">
          <div className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
          <div className="relative rounded-full bg-primary/15 p-6 text-primary">
            <Sparkles className="h-10 w-10" />
          </div>
        </div>
        <div>
          <h2 className="text-xl font-bold">Building your program</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Our AI coach is designing a {profile.daysPerWeek}-day plan tailored to your
            goals and equipment…
          </p>
        </div>
        <Spinner className="text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col px-5 py-6">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <div className="rounded-xl bg-primary p-2 text-primary-foreground">
          <Dumbbell className="h-5 w-5" />
        </div>
        <span className="text-lg font-extrabold tracking-tight">ForgeFit</span>
        {step > 0 && (
          <span className="ml-auto text-sm text-muted-foreground">
            Step {step} of {TOTAL_STEPS - 1}
          </span>
        )}
      </div>

      {step > 0 && <Progress value={(step / (TOTAL_STEPS - 1)) * 100} className="mb-6" />}

      <div className="flex-1 animate-fade-in" key={step}>
        {step === 0 && (
          <div className="flex flex-col items-center pt-8 text-center">
            <div className="rounded-3xl bg-gradient-to-br from-primary to-orange-600 p-5 text-white shadow-lg shadow-primary/30">
              <Dumbbell className="h-12 w-12" />
            </div>
            <h1 className="mt-6 text-3xl font-extrabold tracking-tight">
              Your AI Personal Trainer
            </h1>
            <p className="mt-3 text-muted-foreground">
              Answer a few quick questions and we’ll build a fully personalized,
              progressively-adapting training program — ready to track on the gym floor.
            </p>
            <div className="mt-8 w-full space-y-3 text-left">
              {[
                { icon: Target, t: "Personalized to your goals & gear" },
                { icon: Sparkles, t: "AI-generated routines, zero manual entry" },
                { icon: Trophy, t: "Adapts as you get stronger" },
              ].map(({ icon: Icon, t }) => (
                <div key={t} className="flex items-center gap-3 rounded-xl bg-card p-3">
                  <div className="rounded-lg bg-primary/15 p-2 text-primary">
                    <Icon className="h-4 w-4" />
                  </div>
                  <span className="text-sm font-medium">{t}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 1 && (
          <Section icon={Target} title="What's your main goal?" subtitle="We'll prioritize this in your programming.">
            <SegmentedControl
              columns={2}
              options={GOALS.map((g) => ({ label: g.label, value: g.value, sublabel: g.sub }))}
              value={profile.goal}
              onChange={(v) => update("goal", v)}
            />
          </Section>
        )}

        {step === 2 && (
          <Section icon={Dumbbell} title="What equipment do you have?" subtitle="We'll only program moves you can actually do.">
            <SegmentedControl
              columns={2}
              options={EQUIPMENT.map((e) => ({ label: e.label, value: e.value, sublabel: e.sub }))}
              value={profile.equipment}
              onChange={(v) => update("equipment", v)}
            />
            <div className="mt-6">
              <Label>Experience level</Label>
              <div className="mt-2">
                <SegmentedControl
                  columns={3}
                  options={EXPERIENCE.map((e) => ({ label: e.label, value: e.value, sublabel: e.sub }))}
                  value={profile.experience}
                  onChange={(v) => update("experience", v)}
                />
              </div>
            </div>
          </Section>
        )}

        {step === 3 && (
          <Section icon={Calendar} title="How often can you train?" subtitle="Be realistic — consistency beats intensity.">
            <Label>Days per week</Label>
            <div className="mt-2">
              <SegmentedControl
                columns={6}
                options={[1, 2, 3, 4, 5, 6].map((n) => ({ label: String(n), value: n }))}
                value={profile.daysPerWeek}
                onChange={(v) => update("daysPerWeek", v)}
              />
            </div>
            <div className="mt-6">
              <Label>Session length</Label>
              <div className="mt-2">
                <SegmentedControl
                  columns={4}
                  options={[30, 45, 60, 90].map((n) => ({ label: `${n}m`, value: n }))}
                  value={profile.sessionMinutes}
                  onChange={(v) => update("sessionMinutes", v)}
                />
              </div>
            </div>
            <div className="mt-6">
              <Label>Units</Label>
              <div className="mt-2">
                <SegmentedControl
                  columns={2}
                  options={[
                    { label: "Kilograms", value: "kg" as const },
                    { label: "Pounds", value: "lb" as const },
                  ]}
                  value={profile.units}
                  onChange={(v) => update("units", v)}
                />
              </div>
            </div>
          </Section>
        )}

        {step === 4 && (
          <Section icon={Sparkles} title="Almost there!" subtitle="A couple of optional details to fine-tune your plan.">
            <div className="space-y-4">
              <div>
                <Label htmlFor="name">Your name (optional)</Label>
                <Input
                  id="name"
                  className="mt-1.5"
                  placeholder="Alex"
                  value={profile.name}
                  onChange={(e) => update("name", e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="notes">Injuries or preferences (optional)</Label>
                <textarea
                  id="notes"
                  className="mt-1.5 flex min-h-[88px] w-full rounded-xl border border-input bg-background px-3 py-2 text-base placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="e.g. Bad left shoulder, prefer free weights, no running…"
                  value={profile.notes}
                  onChange={(e) => update("notes", e.target.value)}
                />
              </div>
              <div className="flex gap-2 rounded-xl bg-secondary p-3 text-sm text-muted-foreground">
                <Sparkles className="h-4 w-4 shrink-0 text-primary" />
                <span>
                  Our AI coach will design your full program in a few seconds based on
                  everything above.
                </span>
              </div>
            </div>
            {error && (
              <div className="mt-4 flex gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}
          </Section>
        )}
      </div>

      {/* Footer nav */}
      <div className="mt-6 flex gap-3">
        {step > 0 && (
          <Button variant="outline" size="lg" onClick={back} className="w-14 shrink-0 px-0">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        )}
        {step < TOTAL_STEPS - 1 ? (
          <Button size="lg" onClick={next} className="flex-1">
            {step === 0 ? "Get started" : "Continue"}
            <ArrowRight className="h-5 w-5" />
          </Button>
        ) : (
          <Button size="lg" onClick={handleGenerate} className="flex-1">
            <Sparkles className="h-5 w-5" />
            Generate my program
          </Button>
        )}
      </div>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-5">
        <div className="mb-3 inline-flex rounded-xl bg-primary/15 p-2.5 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}
