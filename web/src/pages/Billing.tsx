import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Check, Crown, Sparkles, CreditCard } from "lucide-react";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import { effectivePlan } from "@/lib/entitlements";
import type { PlanInfo } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";
import { toast } from "@/lib/toast";

const FEATURE_LABELS: Record<string, string> = {
  ai_coach: "AI Coach chat & program tweaks",
  ai_nutrition: "AI nutrition plans that evolve",
  program_refresh: "Adaptive program refresh",
  ai_exercise: "AI exercise assist & how-to guides",
};

export function Billing() {
  const navigate = useNavigate();
  const subscription = useStore((s) => s.subscription);
  const loadSubscription = useStore((s) => s.loadSubscription);

  const [plans, setPlans] = useState<PlanInfo[] | null>(null);
  const [busy, setBusy] = useState<"checkout" | "portal" | null>(null);

  const plan = effectivePlan(subscription);
  const isPro = plan === "pro";

  useEffect(() => {
    void loadSubscription();
    api
      .getPlans()
      .then((r) => setPlans(r.plans))
      .catch(() => setPlans([]));
  }, [loadSubscription]);

  const upgrade = async () => {
    setBusy("checkout");
    try {
      const { url } = await api.startCheckout("pro");
      window.location.href = url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start checkout");
      setBusy(null);
    }
  };

  const manage = async () => {
    setBusy("portal");
    try {
      const { url } = await api.openBillingPortal();
      window.location.href = url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open billing portal");
      setBusy(null);
    }
  };

  const pro = plans?.find((p) => p.id === "pro");

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 pt-2">
        <button onClick={() => navigate(-1)} className="rounded-lg p-1.5 tap hover:bg-accent" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-2xl font-extrabold tracking-tight">Subscription</h1>
      </div>

      {/* Current plan banner */}
      <Card className={isPro ? "border-primary/40 bg-primary/5" : ""}>
        <CardContent className="flex items-center gap-3 p-4">
          <div className={`rounded-full p-2.5 ${isPro ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground"}`}>
            {isPro ? <Crown className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
          </div>
          <div className="flex-1">
            <p className="font-semibold">{isPro ? "ForgeFit Pro" : "Free plan"}</p>
            <p className="text-sm text-muted-foreground">
              {isPro
                ? subscription?.status === "past_due"
                  ? "Payment past due — update your card to keep Pro."
                  : "All premium features unlocked."
                : "Upgrade to unlock AI coaching, nutrition, and more."}
            </p>
          </div>
          {isPro && (
            <Button variant="outline" size="sm" onClick={manage} disabled={busy !== null}>
              {busy === "portal" ? <Spinner /> : <CreditCard className="h-4 w-4" />}
              Manage
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Pro plan card */}
      {plans === null ? (
        <div className="flex justify-center py-8">
          <Spinner className="text-primary" />
        </div>
      ) : (
        pro && (
          <Card className="overflow-hidden">
            <div className="bg-gradient-to-br from-primary to-orange-600 p-5 text-white">
              <div className="flex items-center gap-2">
                <Crown className="h-5 w-5" />
                <h2 className="text-lg font-bold">{pro.name}</h2>
              </div>
              <p className="mt-1 text-sm text-white/90">{pro.blurb}</p>
              <p className="mt-3 text-3xl font-extrabold">
                ${pro.priceUsd}
                <span className="text-base font-medium text-white/80">/mo</span>
              </p>
            </div>
            <CardContent className="p-4">
              <ul className="space-y-2.5">
                {pro.features.map((f) => (
                  <li key={f} className="flex items-center gap-2.5 text-sm">
                    <Check className="h-4 w-4 shrink-0 text-success" />
                    {FEATURE_LABELS[f] ?? f}
                  </li>
                ))}
              </ul>
              {!isPro && (
                <Button size="lg" className="mt-5 w-full" onClick={upgrade} disabled={busy !== null}>
                  {busy === "checkout" ? <Spinner /> : <Crown className="h-5 w-5" />}
                  Upgrade to Pro
                </Button>
              )}
              {isPro && (
                <p className="mt-5 flex items-center justify-center gap-1.5 text-sm font-medium text-success">
                  <Check className="h-4 w-4" /> You're on Pro
                </p>
              )}
            </CardContent>
          </Card>
        )
      )}

      <p className="pb-4 text-center text-xs text-muted-foreground">
        Billing is securely handled by Stripe. Cancel anytime from “Manage”.
      </p>
    </div>
  );
}
