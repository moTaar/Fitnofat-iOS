import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dumbbell, Lock, AlertCircle, ArrowRight } from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Spinner } from "@/components/ui/misc";

/**
 * Landing page for the link in the Supabase "reset your password" email
 * (accounts service's redirectTo points here). Supabase appends the
 * one-time recovery session as a URL fragment
 * (`#access_token=...&type=recovery`), never as a query string, so it's
 * never sent to a server or logged — we just read it off `location.hash`.
 */
export function ResetPassword() {
  const navigate = useNavigate();
  // Read once via a lazy initializer rather than in an effect: an effect that
  // both reads location.hash AND mutates it (via replaceState below) isn't
  // idempotent, and React 18 StrictMode deliberately double-invokes effects
  // in dev — the second pass would see the already-stripped hash and wipe
  // this back to null. A lazy initializer only ever reads the untouched hash.
  const [accessToken] = useState<string | null>(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    return hash.get("access_token");
  });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Clear the token out of the URL/browser history now that it's captured
    // in state. Safe to run more than once — replaceState to the same target
    // is a no-op the second time.
    if (accessToken) window.history.replaceState(null, "", window.location.pathname);
  }, [accessToken]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken) return;
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.resetPassword(accessToken, password);
      toast.success("Password updated — please log in.");
      navigate("/login", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center px-6 py-10">
      <div className="mb-8 flex flex-col items-center text-center">
        <div className="rounded-3xl bg-gradient-to-br from-primary to-orange-600 p-4 text-white shadow-lg shadow-primary/30">
          <Dumbbell className="h-9 w-9" />
        </div>
        <h1 className="mt-5 text-3xl font-extrabold tracking-tight">Fitnofat</h1>
        <p className="mt-2 text-sm text-muted-foreground">Choose a new password.</p>
      </div>

      {!accessToken ? (
        <div className="space-y-4">
          <div className="flex gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            This reset link is invalid or has expired. Request a new one from the login screen.
          </div>
          <Button className="w-full" onClick={() => navigate("/login", { replace: true })}>
            Back to log in
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="new-password">New password</Label>
            <div className="relative mt-1.5">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="new-password" type="password" autoComplete="new-password" required
                minLength={6} className="pl-9" placeholder="••••••••"
                value={password} onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="confirm-password">Confirm password</Label>
            <div className="relative mt-1.5">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="confirm-password" type="password" autoComplete="new-password" required
                minLength={6} className="pl-9" placeholder="••••••••"
                value={confirm} onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
          </div>

          {error && (
            <div className="flex gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy ? <Spinner /> : <ArrowRight className="h-5 w-5" />}
            Update password
          </Button>
        </form>
      )}
    </div>
  );
}
