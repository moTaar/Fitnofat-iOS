// The iOS app talks to Supabase directly, so row-level security is no longer
// defense in depth — it IS the access control. This runs the real schema and
// every migration in an embedded Postgres (PGlite) with a minimal stand-in for
// Supabase's auth schema and roles, then checks what an end user can and can't
// do to the tables the app touches.

import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const SUPABASE = path.resolve(__dirname, "../../../supabase");
const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";

/** Migrations in apply order. */
function migrationOrder(): string[] {
  const files = readdirSync(path.join(SUPABASE, "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  // add_health_rules.sql references health_issues from add_medical.sql but
  // sorts before it; apply it right after its dependency (see IOS.md).
  const rest = files.filter((f) => f !== "add_health_rules.sql");
  rest.splice(rest.indexOf("add_medical.sql") + 1, 0, "add_health_rules.sql");
  return rest;
}

let db: PGlite;

type Role = "anon" | "authenticated" | "service_role";

async function as(role: Role, sub: string | null, sql: string, params: unknown[] = []) {
  const claims = JSON.stringify({ sub, role }).replace(/'/g, "''");
  await db.exec(`reset role; select set_config('request.jwt.claims', '${claims}', false); set role ${role};`);
  try {
    return await db.query<Record<string, unknown>>(sql, params);
  } finally {
    await db.exec("reset role;");
  }
}

async function rejects(role: Role, sub: string | null, sql: string, params: unknown[] = []) {
  try {
    await as(role, sub, sql, params);
    return false;
  } catch {
    return true;
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $$;
    create function auth.role() returns text language sql stable as
      $$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') $$;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    insert into auth.users values ('${A}'), ('${B}');
  `);
  // PGlite has no pgcrypto; gen_random_uuid() is core Postgres anyway.
  const schema = readFileSync(path.join(SUPABASE, "schema.sql"), "utf8").replace(
    /create extension[^;]*;/i,
    ""
  );
  await db.exec(schema);
  for (const f of migrationOrder()) {
    await db.exec(readFileSync(path.join(SUPABASE, "migrations", f), "utf8"));
  }
  // Supabase grants table privileges to these roles; RLS does the filtering.
  await db.exec(`
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant all on all tables in schema public to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
  `);
  await as(
    "service_role",
    null,
    `insert into subscriptions (user_id, plan, status) values ($1,'free','inactive'), ($2,'pro','active')`,
    [A, B]
  );
}, 60_000);

describe("subscriptions (written only by the accounts service)", () => {
  it("lets the owner read their own row and nobody else's", async () => {
    const r = await as("authenticated", A, `select user_id, plan from subscriptions`);
    expect(r.rows).toEqual([{ user_id: A, plan: "free" }]);
  });

  it("does not let a user upgrade themselves", async () => {
    const r = await as("authenticated", A, `update subscriptions set plan='pro', status='active' where user_id=$1`, [A]);
    expect(r.affectedRows).toBe(0);
    expect(await rejects("authenticated", A, `insert into subscriptions (user_id, plan, status) values ($1,'pro','active')`, [A])).toBe(true);
    const after = await as("service_role", null, `select plan from subscriptions where user_id=$1`, [A]);
    expect(after.rows[0].plan).toBe("free");
  });
});

describe("health_rules: the list stays the user's", () => {
  it("forces source=user and user_edited on anything a user inserts", async () => {
    const r = await as(
      "authenticated",
      A,
      `insert into health_rules (user_id, key, subject, source, user_edited) values ($1,'k1','Late coffee','ai',false) returning source, user_edited`,
      [A]
    );
    expect(r.rows[0]).toEqual({ source: "user", user_edited: true });
  });

  it("marks a rule user_edited on any user update, and leaves AI writes alone", async () => {
    await as("service_role", null, `insert into health_rules (user_id, key, subject, source) values ($1,'ai1','Acid late','ai')`, [A]);
    await as("service_role", null, `update health_rules set subject='Acidic food after 20:00' where key='ai1'`);
    let r = await as("service_role", null, `select user_edited from health_rules where key='ai1'`);
    expect(r.rows[0].user_edited).toBe(false);

    await as("authenticated", A, `update health_rules set status='paused', user_edited=false where key='ai1'`);
    r = await as("service_role", null, `select user_edited, status from health_rules where key='ai1'`);
    expect(r.rows[0]).toEqual({ user_edited: true, status: "paused" });
  });
});

describe("health_issues: status history is kept in the database", () => {
  let issueId: string;

  beforeAll(async () => {
    const r = await as(
      "authenticated",
      A,
      `insert into health_issues (user_id, key, title, source) values ($1,'knee','Knee pain','ai') returning id, source`,
      [A]
    );
    issueId = r.rows[0].id as string;
    expect(r.rows[0].source).toBe("user");
  });

  const events = async () =>
    (await as("service_role", null, `select kind, body from health_issue_events where issue_id=$1 order by created_at`, [issueId])).rows;

  it("stamps resolved_at and logs the change when a user resolves an issue", async () => {
    await as("authenticated", A, `update health_issues set status='resolved' where id=$1`, [issueId]);
    const r = await as("service_role", null, `select resolved_at from health_issues where id=$1`, [issueId]);
    expect(r.rows[0].resolved_at).not.toBeNull();
    expect(await events()).toEqual([{ kind: "status_change", body: "Status changed to resolved" }]);
  });

  it("clears resolved_at on reopen, and ignores non-status edits", async () => {
    await as("authenticated", A, `update health_issues set status='open' where id=$1`, [issueId]);
    await as("authenticated", A, `update health_issues set progress=40 where id=$1`, [issueId]);
    const r = await as("service_role", null, `select resolved_at from health_issues where id=$1`, [issueId]);
    expect(r.rows[0].resolved_at).toBeNull();
    expect(await events()).toHaveLength(2);
  });

  it("doesn't double the event the data API writes for its own status changes", async () => {
    await as("service_role", null, `update health_issues set status='monitoring' where id=$1`, [issueId]);
    expect(await events()).toHaveLength(2);
  });

  it("keeps one user's record invisible and read-only to another", async () => {
    expect((await as("authenticated", B, `select * from health_issues`)).rows).toEqual([]);
    const r = await as("authenticated", B, `update health_issues set title='x' where id=$1`, [issueId]);
    expect(r.affectedRows).toBe(0);
    expect(
      await rejects("authenticated", B, `insert into health_issue_events (user_id, issue_id, kind) values ($1,$2,'note')`, [A, issueId])
    ).toBe(true);
  });
});

describe("everything else", () => {
  it("shows the anon key nothing", async () => {
    expect((await as("anon", null, `select * from profiles`)).rows).toEqual([]);
    expect((await as("anon", null, `select * from workouts`)).rows).toEqual([]);
  });

  it("keeps the service-only tables closed", async () => {
    expect((await as("authenticated", A, `select * from ai_usage`)).rows).toEqual([]);
    expect(
      await rejects("authenticated", A, `insert into ai_usage (user_id, day, feature, count) values ($1, current_date, 'medical_ai', -100)`, [A])
    ).toBe(true);
    expect(await rejects("authenticated", A, `insert into exercise_guides (slug, name) values ('x','x')`)).toBe(true);
    expect(await rejects("authenticated", A, `insert into youtube_budget (day, count) values (current_date, -1000)`)).toBe(true);
  });

  it("supports the idempotent workout upsert, for the owner only", async () => {
    const upsert = `insert into workouts (user_id, client_id, routine_name, started_at) values ($1,'c1',$2,'2026-01-01')
      on conflict (user_id, client_id) do update set routine_name = excluded.routine_name returning routine_name`;
    await as("authenticated", A, upsert, [A, "Push"]);
    const r = await as("authenticated", A, upsert, [A, "Push v2"]);
    expect(r.rows[0].routine_name).toBe("Push v2");
    expect(await rejects("authenticated", A, upsert, [B, "Nope"])).toBe(true);
  });
});
