export type Plan = "free" | "pro";
export type Status = "active" | "trialing" | "past_due" | "canceled" | "inactive";

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  plan: Plan;
  status: Status;
  currentPeriodEnd: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

export interface Stats {
  totalUsers: number;
  freeUsers: number;
  proUsers: number;
  pastDueUsers: number;
}

export interface UsersResponse {
  total: number;
  users: AdminUser[];
}

let _base = "";
let _key = "";

export function setCredentials(base: string, key: string) {
  _base = base.replace(/\/$/, "");
  _key = key;
}

export function getCredentials() {
  return { base: _base, key: _key };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${_base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Key": _key,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  stats: () => request<Stats>("/admin/stats"),

  users: (params?: { plan?: Plan; email?: string }) => {
    const q = new URLSearchParams();
    if (params?.plan) q.set("plan", params.plan);
    if (params?.email) q.set("email", params.email);
    return request<UsersResponse>(`/admin/users?${q}`);
  },

  user: (id: string) => request<AdminUser>(`/admin/users/${id}`),

  setPlan: (id: string, plan: Plan, status?: string) =>
    request<{ ok: boolean; plan: Plan; status: string }>(
      `/admin/users/${id}/plan`,
      { method: "PATCH", body: JSON.stringify({ plan, ...(status ? { status } : {}) }) }
    ),

  deleteUser: (id: string) => request<void>(`/admin/users/${id}`, { method: "DELETE" }),
};
