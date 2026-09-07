import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dumbbell, Mail, Lock, User, AlertCircle, ArrowRight, CheckCircle2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Spinner } from "@/components/ui/misc";

export function Login() {
  const navigate = useNavigate();
  const login = useStore((s) => s.login);
  const signup = useStore((s) => s.signup);

  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const switchMode = (next: typeof mode) => {
    setMode(next);
    setError(null);
    setSent(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "signup") {
        await signup(email.trim(), password, name.trim());
        navigate("/", { replace: true });
      } else if (mode === "forgot") {
        await api.forgotPassword(email.trim());
        setSent(true);
      } else {
        await login(email.trim(), password);
        navigate("/", { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
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
        <p className="mt-2 text-sm text-muted-foreground">
          {mode === "login" && "Welcome back — let’s train."}
          {mode === "signup" && "Create your account to get started."}
          {mode === "forgot" && "We’ll email you a link to reset your password."}
        </p>
      </div>

      {mode === "forgot" && sent ? (
        <div className="space-y-4">
          <div className="flex gap-2 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            If an account exists for <b className="font-semibold">{email.trim()}</b>, a reset
            link is on its way — check your inbox.
          </div>
          <Button variant="outline" className="w-full" onClick={() => switchMode("login")}>
            Back to log in
          </Button>
        </div>
      ) : (
      <form onSubmit={submit} className="space-y-4">
        {mode === "signup" && (
          <div>
            <Label htmlFor="name">Name (optional)</Label>
            <div className="relative mt-1.5">
              <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="name" className="pl-9" placeholder="Alex" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          </div>
        )}
        <div>
          <Label htmlFor="email">Email</Label>
          <div className="relative mt-1.5">
            <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="email" type="email" autoComplete="email" required className="pl-9"
              placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </div>
        {mode !== "forgot" && (
          <div>
            <div className="flex items-baseline justify-between">
              <Label htmlFor="password">Password</Label>
              {mode === "login" && (
                <button
                  type="button"
                  onClick={() => switchMode("forgot")}
                  className="text-xs font-semibold text-primary tap"
                >
                  Forgot password?
                </button>
              )}
            </div>
            <div className="relative mt-1.5">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="password" type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                required minLength={6} className="pl-9" placeholder="••••••••"
                value={password} onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>
        )}

        {error && (
          <div className="flex gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy ? <Spinner /> : <ArrowRight className="h-5 w-5" />}
          {mode === "login" && "Log in"}
          {mode === "signup" && "Create account"}
          {mode === "forgot" && "Send reset link"}
        </Button>
      </form>
      )}

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {mode === "forgot" ? (
          !sent && (
            <button onClick={() => switchMode("login")} className="font-semibold text-primary tap">
              Back to log in
            </button>
          )
        ) : (
          <>
            {mode === "login" ? "New to Fitnofat?" : "Already have an account?"}{" "}
            <button
              onClick={() => switchMode(mode === "login" ? "signup" : "login")}
              className="font-semibold text-primary tap"
            >
              {mode === "login" ? "Sign up" : "Log in"}
            </button>
          </>
        )}
      </p>
    </div>
  );
}
