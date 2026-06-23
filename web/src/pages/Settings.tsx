import { useState } from "react";
import {
  Moon, Sun, Timer, Bell, Trash2, Weight, User, LogOut, Mail, Sparkles,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/hooks";
import { requestNotificationPermission, notificationsSupported } from "@/lib/notifications";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";

export function SettingsPage() {
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const setUnits = useStore((s) => s.setUnits);
  const profile = useStore((s) => s.profile);
  const user = useStore((s) => s.user);
  const logout = useStore((s) => s.logout);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);

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
    </div>
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
