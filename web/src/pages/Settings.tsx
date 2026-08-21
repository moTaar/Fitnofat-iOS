import { useEffect, useState } from "react";
import {
  Moon, Sun, Timer, Bell, Trash2, Weight, User, LogOut, Mail, Sparkles,
  Activity, Volume2, Crown, ChevronRight, ChevronDown, KeyRound, UserX, Dumbbell,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/hooks";
import { effectivePlan } from "@/lib/entitlements";
import { requestNotificationPermission, notificationsSupported } from "@/lib/notifications";
import { cn } from "@/lib/utils";
import type { EquipmentPrefCategory } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { SegmentedControl, Spinner, TriToggle, type TriState } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { CuisineSelector } from "@/components/CuisineSelector";
import { toast } from "@/lib/toast";

export function SettingsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { theme, toggle } = useTheme();
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const setUnits = useStore((s) => s.setUnits);
  const setCuisine = useStore((s) => s.setCuisine);
  const setEquipmentPref = useStore((s) => s.setEquipmentPref);
  const profile = useStore((s) => s.profile);
  const user = useStore((s) => s.user);
  const logout = useStore((s) => s.logout);
  const subscription = useStore((s) => s.subscription);
  const loadSubscription = useStore((s) => s.loadSubscription);
  const updateAccount = useStore((s) => s.updateAccount);
  const changePassword = useStore((s) => s.changePassword);
  const deleteAccount = useStore((s) => s.deleteAccount);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [emailModal, setEmailModal] = useState(false);
  const [passwordModal, setPasswordModal] = useState(false);
  const [deleteModal, setDeleteModal] = useState(false);

  const isPro = effectivePlan(subscription) === "pro";

  // On return from Stripe Checkout, toast the result and refresh billing state.
  useEffect(() => {
    const billing = searchParams.get("billing");
    if (!billing) return;
    if (billing === "success") toast.success("Welcome to Pro! 🎉 Your plan is now active.");
    else if (billing === "cancel") toast.show("Checkout canceled — no charge was made.");
    void loadSubscription();
    searchParams.delete("billing");
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams, loadSubscription]);

  const toggleReminders = async () => {
    if (!settings.remindersEnabled) {
      const perm = await requestNotificationPermission();
      setSetting("remindersEnabled", perm === "granted");
    } else {
      setSetting("remindersEnabled", false);
    }
  };

  const resetAll = () => {
    logout();
    localStorage.removeItem("forgefit-store-v2");
    localStorage.removeItem("forgefit-session-v1");
    localStorage.removeItem("forgefit-install-dismissed");
    location.href = "/";
  };

  return (
    <div className="space-y-5">
      <h1 className="pt-2 text-2xl font-extrabold tracking-tight">Settings</h1>

      {/* Account */}
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <div className="rounded-full bg-primary/15 p-2.5 text-primary">
            <User className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className="font-semibold">{profile?.name || "Athlete"}</p>
            <p className="flex items-center gap-1 text-sm text-muted-foreground">
              <Mail className="h-3.5 w-3.5" />
              {user?.email ?? "—"}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Subscription */}
      <SettingGroup title="Subscription">
        <button
          onClick={() => navigate("/billing")}
          className="flex w-full items-center gap-3 p-4 text-left tap"
        >
          <div className={`rounded-lg p-2 ${isPro ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground"}`}>
            <Crown className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className="font-medium">{isPro ? "ForgeFit Pro" : "Free plan"}</p>
            <p className="text-xs text-muted-foreground">
              {isPro ? "Manage your subscription & billing" : "Upgrade to unlock AI features"}
            </p>
          </div>
          {!isPro && (
            <span className="rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground">
              Upgrade
            </span>
          )}
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </button>
      </SettingGroup>

      {/* Appearance */}
      <SettingGroup title="Appearance">
        <Row
          icon={theme === "dark" ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
          label="Theme"
          desc={theme === "dark" ? "Dark mode" : "Light mode"}
        >
          <Toggle on={theme === "dark"} onClick={toggle} />
        </Row>
        <Row icon={<Weight className="h-5 w-5" />} label="Units" desc="Weight units">
          <div className="w-24">
            <SegmentedControl
              columns={2}
              options={[
                { label: "kg", value: "kg" as const },
                { label: "lb", value: "lb" as const },
              ]}
              value={profile?.units ?? "kg"}
              onChange={(v) => setUnits(v)}
            />
          </div>
        </Row>
      </SettingGroup>

      {/* Workout */}
      <SettingGroup title="Workout">
        <Row icon={<Timer className="h-5 w-5" />} label="Default rest" desc="Auto-starts after each set">
          <div className="w-28">
            <SegmentedControl
              columns={3}
              options={[60, 90, 120].map((n) => ({ label: `${n}`, value: n }))}
              value={settings.defaultRestSeconds}
              onChange={(v) => setSetting("defaultRestSeconds", v)}
            />
          </div>
        </Row>
        {notificationsSupported() && (
          <Row icon={<Bell className="h-5 w-5" />} label="Reminders" desc="Local workout nudges">
            <Toggle on={settings.remindersEnabled} onClick={toggleReminders} />
          </Row>
        )}
      </SettingGroup>

      {/* Smart rep counter */}
      <SettingGroup title="Smart rep counter">
        <Row
          icon={<Activity className="h-5 w-5" />}
          label="Sensitivity"
          desc="Accelerometer auto-count tuning"
        >
          <div className="w-32">
            <SegmentedControl
              columns={3}
              options={[
                { label: "Low", value: "low" as const },
                { label: "Med", value: "medium" as const },
                { label: "High", value: "high" as const },
              ]}
              value={settings.repSensitivity}
              onChange={(v) => setSetting("repSensitivity", v)}
            />
          </div>
        </Row>
        <Row icon={<Volume2 className="h-5 w-5" />} label="Rep tick sound" desc="Audible cue on each rep">
          <Toggle on={settings.repSound} onClick={() => setSetting("repSound", !settings.repSound)} />
        </Row>
      </SettingGroup>

      {/* Nutrition */}
      <SettingGroup title="Nutrition">
        <div className="p-4">
          <CuisineSelector
            title="Default cuisine"
            bleed={false}
            value={profile?.cuisine ?? "standard"}
            onSelect={setCuisine}
          />
          <p className="mt-2.5 px-1 text-xs text-muted-foreground">
            Your default culinary style for AI meal suggestions. Applied the next time your
            nutrition plan is generated.
          </p>
        </div>
      </SettingGroup>

      {/* Equipment Preferences — collapsed by default */}
      <CollapsibleGroup title="Equipment Preferences" icon={<Dumbbell className="h-4 w-4" />}>
        <div className="space-y-4 p-4">
          <p className="text-xs text-muted-foreground">
            Fine-tune extra equipment for AI-generated exercises, on top of your main setup
            from onboarding. Leave anything on <b className="font-medium text-foreground">No pref</b> to
            change nothing.
          </p>
          <EquipmentPrefRow
            label="Resistance / tension bands"
            category="bands"
            prefs={profile?.equipmentPrefs}
            onChange={setEquipmentPref}
          />
          <EquipmentPrefRow
            label="Dumbbells & free weights"
            category="freeWeights"
            prefs={profile?.equipmentPrefs}
            onChange={setEquipmentPref}
          />
          <EquipmentPrefRow
            label="Machines"
            category="machines"
            prefs={profile?.equipmentPrefs}
            onChange={setEquipmentPref}
          />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3 text-[11px] text-muted-foreground">
            <span><b className="font-semibold text-destructive">Never</b> — hard exclude</span>
            <span><b className="font-semibold text-foreground">No pref</b> — default, no change</span>
            <span><b className="font-semibold text-success">Maybe</b> — AI may use it if it wants</span>
          </div>
        </div>
      </CollapsibleGroup>

      {/* AI Coach */}
      <SettingGroup title="AI Coach">
        <button
          onClick={() => navigate("/ai-coach?restart=1")}
          className="flex w-full items-center gap-3 p-4 text-left tap"
        >
          <Sparkles className="h-5 w-5 text-primary" />
          <div>
            <p className="font-medium">Rebuild program with AI</p>
            <p className="text-xs text-muted-foreground">Re-run the setup interview from scratch</p>
          </div>
        </button>
      </SettingGroup>

      {/* Account actions */}
      <SettingGroup title="Account">
        <button
          onClick={() => setEmailModal(true)}
          className="flex w-full items-center gap-3 p-4 text-left tap"
        >
          <Mail className="h-5 w-5 text-muted-foreground" />
          <p className="font-medium">Change email</p>
        </button>
        <button
          onClick={() => setPasswordModal(true)}
          className="flex w-full items-center gap-3 p-4 text-left tap"
        >
          <KeyRound className="h-5 w-5 text-muted-foreground" />
          <p className="font-medium">Change password</p>
        </button>
        <button
          onClick={() => setConfirmLogout(true)}
          className="flex w-full items-center gap-3 p-4 text-left tap"
        >
          <LogOut className="h-5 w-5 text-muted-foreground" />
          <p className="font-medium">Log out</p>
        </button>
        <button
          onClick={() => setConfirmReset(true)}
          className="flex w-full items-center gap-3 p-4 text-left text-destructive tap"
        >
          <Trash2 className="h-5 w-5" />
          <div>
            <p className="font-medium">Clear local data</p>
            <p className="text-xs opacity-70">Logs out and wipes this device’s cache</p>
          </div>
        </button>
        <button
          onClick={() => setDeleteModal(true)}
          className="flex w-full items-center gap-3 p-4 text-left text-destructive tap"
        >
          <UserX className="h-5 w-5" />
          <div>
            <p className="font-medium">Delete account</p>
            <p className="text-xs opacity-70">Permanently erases your account and all data</p>
          </div>
        </button>
      </SettingGroup>

      <p className="pb-4 text-center text-xs text-muted-foreground">ForgeFit · v{__APP_VERSION__} · PWA</p>

      <Modal open={confirmLogout} onClose={() => setConfirmLogout(false)} title="Log out?">
        <p className="text-sm text-muted-foreground">
          Your data stays safely in the cloud — you can log back in anytime.
        </p>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => setConfirmLogout(false)}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            onClick={() => {
              logout();
              location.href = "/login";
            }}
          >
            Log out
          </Button>
        </div>
      </Modal>

      <Modal open={confirmReset} onClose={() => setConfirmReset(false)} title="Clear local data?">
        <p className="text-sm text-muted-foreground">
          This logs you out and clears the cached copy on this device. Your account and
          history remain in the cloud and re-download when you log back in.
        </p>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => setConfirmReset(false)}>
            Cancel
          </Button>
          <Button variant="destructive" className="flex-1" onClick={resetAll}>
            Clear & log out
          </Button>
        </div>
      </Modal>

      <ChangeEmailModal
        open={emailModal}
        currentEmail={user?.email ?? ""}
        onClose={() => setEmailModal(false)}
        onSave={async (email) => {
          await updateAccount({ email });
          toast.success("Email updated.");
        }}
      />

      <ChangePasswordModal
        open={passwordModal}
        onClose={() => setPasswordModal(false)}
        onSave={async (password) => {
          await changePassword(password);
          toast.success("Password updated.");
        }}
      />

      <DeleteAccountModal
        open={deleteModal}
        onClose={() => setDeleteModal(false)}
        onConfirm={async () => {
          await deleteAccount();
          location.href = "/login";
        }}
      />
    </div>
  );
}

function ChangeEmailModal({
  open, currentEmail, onClose, onSave,
}: {
  open: boolean;
  currentEmail: string;
  onClose: () => void;
  onSave: (email: string) => Promise<void>;
}) {
  const [email, setEmail] = useState(currentEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave(email.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update email");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Change email">
      <Label htmlFor="new-email">New email</Label>
      <Input
        id="new-email" type="email" autoComplete="email" className="mt-1.5"
        value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
      />
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      <div className="mt-4 flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button className="flex-1" onClick={submit} disabled={busy || !email.trim()}>
          {busy ? <Spinner /> : null} Save
        </Button>
      </div>
    </Modal>
  );
}

function ChangePasswordModal({
  open, onClose, onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setPassword(""); setConfirm(""); setError(null); };

  const submit = async () => {
    if (password.length < 6) { setError("Password must be at least 6 characters"); return; }
    if (password !== confirm) { setError("Passwords don't match"); return; }
    setBusy(true);
    setError(null);
    try {
      await onSave(password);
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="Change password">
      <Label htmlFor="new-password">New password</Label>
      <Input
        id="new-password" type="password" autoComplete="new-password" className="mt-1.5"
        value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
      />
      <Label htmlFor="confirm-password" className="mt-3 block">Confirm password</Label>
      <Input
        id="confirm-password" type="password" autoComplete="new-password" className="mt-1.5"
        value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••"
      />
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      <div className="mt-4 flex gap-2">
        <Button variant="outline" className="flex-1" onClick={() => { reset(); onClose(); }} disabled={busy}>Cancel</Button>
        <Button className="flex-1" onClick={submit} disabled={busy}>
          {busy ? <Spinner /> : null} Save
        </Button>
      </div>
    </Modal>
  );
}

function DeleteAccountModal({
  open, onClose, onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete account");
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={() => { setConfirmText(""); onClose(); }} title="Delete account?">
      <p className="text-sm text-muted-foreground">
        This permanently deletes your account, cancels any subscription, and erases all your
        programs, routines, workouts, and nutrition data. This cannot be undone.
      </p>
      <Label htmlFor="delete-confirm" className="mt-4 block">
        Type <b className="font-semibold text-foreground">DELETE</b> to confirm
      </Label>
      <Input
        id="delete-confirm" className="mt-1.5" value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)} placeholder="DELETE"
      />
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      <div className="mt-4 flex gap-2">
        <Button variant="outline" className="flex-1" onClick={() => { setConfirmText(""); onClose(); }} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="destructive" className="flex-1"
          onClick={submit} disabled={busy || confirmText !== "DELETE"}
        >
          {busy ? <Spinner /> : null} Delete account
        </Button>
      </div>
    </Modal>
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-checked={on}
      role="switch"
      className={`relative h-7 w-12 rounded-full transition-colors duration-200 tap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        on ? "bg-primary" : "bg-secondary"
      }`}
    >
      <span
        className={`absolute left-0 top-1 h-5 w-5 rounded-full shadow-md transition-transform duration-200 ${
          on ? "translate-x-[26px] bg-white" : "translate-x-[4px] bg-muted-foreground/60"
        }`}
      />
    </button>
  );
}

function SettingGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-2 px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <Card className="divide-y divide-border overflow-hidden">{children}</Card>
    </div>
  );
}

// Same header styling as SettingGroup, but starts closed and toggles on tap —
// used for sections that are useful but not something most people need to
// see every time (Equipment Preferences).
function CollapsibleGroup({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="mb-2 flex w-full items-center gap-1.5 px-1 tap"
      >
        {icon && <span className="text-muted-foreground">{icon}</span>}
        <h2 className="flex-1 text-left text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>
      {open && <Card className="divide-y divide-border overflow-hidden">{children}</Card>}
    </div>
  );
}

// One equipment-category row inside "Equipment Preferences": a label plus the
// exclude/neutral/include tri-toggle, mapped to/from the profile's stored
// `equipmentPrefs[category]` (undefined ⇒ "neutral").
function EquipmentPrefRow({
  label,
  category,
  prefs,
  onChange,
}: {
  label: string;
  category: EquipmentPrefCategory;
  prefs: Partial<Record<EquipmentPrefCategory, "include" | "exclude">> | undefined;
  onChange: (category: EquipmentPrefCategory, value: "include" | "exclude" | undefined) => void;
}) {
  const value: TriState = prefs?.[category] ?? "neutral";
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{label}</p>
      <TriToggle
        value={value}
        onChange={(v) => onChange(category, v === "neutral" ? undefined : v)}
      />
    </div>
  );
}

function Row({
  icon,
  label,
  desc,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 p-4">
      <div className="rounded-lg bg-secondary p-2 text-muted-foreground">{icon}</div>
      <div className="flex-1">
        <p className="font-medium">{label}</p>
        {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
      </div>
      {children}
    </div>
  );
}
