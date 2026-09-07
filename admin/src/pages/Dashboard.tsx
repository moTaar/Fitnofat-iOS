import { useEffect, useState, useCallback } from "react";
import {
  Users, Crown, UserX, AlertTriangle,
  Search, RefreshCw, LogOut, Trash2,
  ChevronUp, ChevronDown, X, Check,
} from "lucide-react";
import { api, type AdminUser, type Plan, type Stats } from "../api";

interface Props {
  onLogout: () => void;
}

type SortKey = "email" | "plan" | "status" | "createdAt";
type SortDir = "asc" | "desc";

// ── small helpers ─────────────────────────────────────────────────────────────

function PlanBadge({ plan }: { plan: Plan }) {
  return plan === "pro" ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium
                     bg-amber-500/15 text-amber-400 border border-amber-500/20">
      <Crown className="w-3 h-3" /> Pro
    </span>
  ) : (
    <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium
                     bg-zinc-800 text-zinc-400 border border-zinc-700">
      Free
    </span>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "active" || status === "trialing" ? "bg-green-500" :
    status === "past_due" ? "bg-yellow-500" :
    "bg-zinc-600";
  return (
    <span className="flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full ${color}`} />
      <span className="capitalize text-zinc-400 text-xs">{status}</span>
    </span>
  );
}

function StatCard({
  icon: Icon, label, value, color,
}: { icon: React.ElementType; label: string; value: number; color: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center gap-4">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-2xl font-bold leading-none">{value}</p>
        <p className="text-xs text-zinc-500 mt-1">{label}</p>
      </div>
    </div>
  );
}

// ── Delete confirm modal ──────────────────────────────────────────────────────

function DeleteModal({
  user,
  onConfirm,
  onCancel,
}: {
  user: AdminUser;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [input, setInput] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-md">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-9 h-9 rounded-lg bg-red-500/15 flex items-center justify-center shrink-0">
            <Trash2 className="w-4 h-4 text-red-400" />
          </div>
          <div>
            <h3 className="font-semibold">Delete user</h3>
            <p className="text-sm text-zinc-400 mt-0.5">
              This permanently deletes <span className="text-zinc-200">{user.email}</span> and all their
              data. Stripe subscription will be cancelled.
            </p>
          </div>
        </div>
        <label className="block text-xs text-zinc-500 mb-1.5">
          Type <span className="font-mono text-zinc-300">DELETE</span> to confirm
        </label>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm
                     focus:outline-none focus:border-red-500 mb-4 transition-colors"
          placeholder="DELETE"
        />
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 bg-zinc-800 hover:bg-zinc-700 rounded-lg py-2 text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            disabled={input !== "DELETE"}
            onClick={onConfirm}
            className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed
                       rounded-lg py-2 text-sm font-medium transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ── User detail drawer ────────────────────────────────────────────────────────

function UserDrawer({
  user,
  onClose,
  onPlanChange,
  onDelete,
}: {
  user: AdminUser;
  onClose: () => void;
  onPlanChange: (id: string, plan: Plan) => Promise<void>;
  onDelete: (user: AdminUser) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");

  async function togglePlan() {
    setBusy(true);
    try {
      await onPlanChange(user.id, user.plan === "pro" ? "free" : "pro");
      setToast(user.plan === "pro" ? "Reverted to Free" : "Upgraded to Pro");
    } catch (e) {
      setToast("Error: " + (e instanceof Error ? e.message : "unknown"));
    } finally {
      setBusy(false);
      setTimeout(() => setToast(""), 2500);
    }
  }

  const fields: [string, React.ReactNode][] = [
    ["User ID", <span className="font-mono text-xs break-all">{user.id}</span>],
    ["Email", user.email],
    ["Name", user.name || <span className="text-zinc-600">—</span>],
    ["Joined", new Date(user.createdAt).toLocaleDateString()],
    ["Plan", <PlanBadge plan={user.plan} />],
    ["Status", <StatusDot status={user.status} />],
    ["Period end", user.currentPeriodEnd
      ? new Date(user.currentPeriodEnd).toLocaleDateString()
      : <span className="text-zinc-600">—</span>],
    ["Stripe customer", user.stripeCustomerId
      ? <span className="font-mono text-xs">{user.stripeCustomerId}</span>
      : <span className="text-zinc-600">—</span>],
  ];

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md bg-zinc-900 border-l border-zinc-800 h-full overflow-y-auto flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 shrink-0">
          <h2 className="font-semibold text-sm">User details</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 flex-1">
          <dl className="space-y-3">
            {fields.map(([label, value]) => (
              <div key={label} className="flex flex-col gap-0.5">
                <dt className="text-xs text-zinc-500">{label}</dt>
                <dd className="text-sm text-zinc-200">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="px-5 py-4 border-t border-zinc-800 space-y-2 shrink-0">
          {toast && (
            <p className="text-xs text-center text-zinc-400 py-1">{toast}</p>
          )}
          <button
            onClick={togglePlan}
            disabled={busy}
            className={`w-full rounded-lg py-2.5 text-sm font-medium transition-colors disabled:opacity-50
              ${user.plan === "pro"
                ? "bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                : "bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 border border-amber-500/30"
              }`}
          >
            {busy ? "Saving…" : user.plan === "pro" ? "Revoke Pro → Free" : "Grant Pro access"}
          </button>
          <button
            onClick={() => onDelete(user)}
            className="w-full rounded-lg py-2.5 text-sm font-medium bg-zinc-900 hover:bg-red-950/40
                       text-red-400 border border-zinc-800 hover:border-red-900/50 transition-colors"
          >
            Delete user…
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────

export default function Dashboard({ onLogout }: Props) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState<Plan | "all">("all");

  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [statsRes, usersRes] = await Promise.all([
        api.stats(),
        api.users({
          plan: planFilter !== "all" ? planFilter : undefined,
          email: search.trim() || undefined,
        }),
      ]);
      setStats(statsRes);
      setUsers(usersRes.users);
      setTotal(usersRes.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [planFilter, search]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }

  const sorted = [...users].sort((a, b) => {
    let va = a[sortKey] ?? "";
    let vb = b[sortKey] ?? "";
    if (typeof va === "string") va = va.toLowerCase();
    if (typeof vb === "string") vb = vb.toLowerCase();
    const cmp = va < vb ? -1 : va > vb ? 1 : 0;
    return sortDir === "asc" ? cmp : -cmp;
  });

  async function handlePlanChange(id: string, plan: Plan) {
    await api.setPlan(id, plan);
    setUsers((prev) =>
      prev.map((u) =>
        u.id === id
          ? { ...u, plan, status: plan === "pro" ? "active" : "inactive" }
          : u
      )
    );
    if (selected?.id === id) {
      setSelected((s) => s ? { ...s, plan, status: plan === "pro" ? "active" : "inactive" } : s);
    }
    setStats((s) =>
      s
        ? {
            ...s,
            proUsers: s.proUsers + (plan === "pro" ? 1 : -1),
            freeUsers: s.freeUsers + (plan === "free" ? 1 : -1),
          }
        : s
    );
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await api.deleteUser(deleteTarget.id);
    setUsers((prev) => prev.filter((u) => u.id !== deleteTarget.id));
    setTotal((n) => n - 1);
    setDeleteTarget(null);
    if (selected?.id === deleteTarget.id) setSelected(null);
    setStats((s) => s ? { ...s, totalUsers: s.totalUsers - 1 } : s);
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return null;
    return sortDir === "asc"
      ? <ChevronUp className="w-3 h-3 inline ml-0.5 text-primary" />
      : <ChevronDown className="w-3 h-3 inline ml-0.5 text-primary" />;
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-bold text-sm">Fitnofat</span>
          <span className="text-zinc-600 text-sm">/</span>
          <span className="text-zinc-400 text-sm">Admin</span>
        </div>
        <button
          onClick={onLogout}
          className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" /> Sign out
        </button>
      </header>

      <main className="flex-1 px-6 py-6 max-w-7xl w-full mx-auto">
        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <StatCard icon={Users} label="Total users" value={stats.totalUsers} color="bg-zinc-800 text-zinc-300" />
            <StatCard icon={Crown} label="Pro users" value={stats.proUsers} color="bg-amber-500/15 text-amber-400" />
            <StatCard icon={UserX} label="Free users" value={stats.freeUsers} color="bg-zinc-800 text-zinc-400" />
            <StatCard icon={AlertTriangle} label="Past due" value={stats.pastDueUsers} color="bg-red-500/15 text-red-400" />
          </div>
        )}

        {/* Controls */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by email…"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-9 pr-3 py-2 text-sm
                         placeholder:text-zinc-600 focus:outline-none focus:border-primary transition-colors"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1">
            {(["all", "pro", "free"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPlanFilter(p)}
                className={`px-3 py-1 rounded-md text-xs font-medium capitalize transition-colors ${
                  planFilter === p
                    ? "bg-zinc-700 text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 bg-zinc-900 border border-zinc-800
                       rounded-lg text-xs text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 px-4 py-3 bg-red-950/30 border border-red-900/40 rounded-lg text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Table */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800">
                  {([
                    ["email", "Email"],
                    ["name", null],
                    ["plan", "Plan"],
                    ["status", "Status"],
                    ["createdAt", "Joined"],
                  ] as [SortKey | "name", string | null][]).map(([key, label]) => (
                    <th
                      key={key}
                      onClick={key !== "name" ? () => toggleSort(key as SortKey) : undefined}
                      className={`text-left px-4 py-3 text-xs font-medium text-zinc-500
                        ${key !== "name" ? "cursor-pointer hover:text-zinc-300 select-none" : ""}`}
                    >
                      {label}
                      {key !== "name" && <SortIcon k={key as SortKey} />}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-xs font-medium text-zinc-500 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && users.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-zinc-600 text-xs">
                      Loading…
                    </td>
                  </tr>
                ) : sorted.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-zinc-600 text-xs">
                      No users found
                    </td>
                  </tr>
                ) : sorted.map((user) => (
                  <tr
                    key={user.id}
                    onClick={() => setSelected(user)}
                    className="border-b border-zinc-800/60 hover:bg-zinc-800/40 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-zinc-200">{user.email}</td>
                    <td className="px-4 py-3 text-zinc-500 text-xs">{user.name}</td>
                    <td className="px-4 py-3"><PlanBadge plan={user.plan} /></td>
                    <td className="px-4 py-3"><StatusDot status={user.status} /></td>
                    <td className="px-4 py-3 text-zinc-500 text-xs">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handlePlanChange(user.id, user.plan === "pro" ? "free" : "pro")}
                          title={user.plan === "pro" ? "Revoke Pro" : "Grant Pro"}
                          className={`p-1.5 rounded-md transition-colors ${
                            user.plan === "pro"
                              ? "text-amber-500 hover:bg-amber-500/10"
                              : "text-zinc-500 hover:bg-zinc-800 hover:text-amber-400"
                          }`}
                        >
                          <Crown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(user)}
                          title="Delete user"
                          className="p-1.5 rounded-md text-zinc-600 hover:bg-red-950/40 hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!loading && total > 0 && (
            <div className="px-4 py-2 border-t border-zinc-800 text-xs text-zinc-600">
              {total} user{total !== 1 ? "s" : ""}
              {search && ` matching "${search}"`}
              {planFilter !== "all" && ` on ${planFilter} plan`}
            </div>
          )}
        </div>
      </main>

      {/* User detail drawer */}
      {selected && (
        <UserDrawer
          user={selected}
          onClose={() => setSelected(null)}
          onPlanChange={handlePlanChange}
          onDelete={(u) => { setDeleteTarget(u); }}
        />
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <DeleteModal
          user={deleteTarget}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
