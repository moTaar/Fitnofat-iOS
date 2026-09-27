# Fitnofat — AI Workout, Nutrition & Coaching Tracker (iPhone app + PWA)

A minimalist, dark-mode-first, mobile-optimized training app with AI-driven
program personalization, adaptive progression, an AI coach, macro-matched
nutrition planning, and full offline-capable PWA support.

> **This repository is the iPhone edition.** The same React app ships as a
> native iOS app (Capacitor, in `web/ios/`) that talks to Supabase directly,
> keeps your data on the phone, and adds local notifications — so the hosted
> services are only needed for AI, billing and account admin.
> **To install it on your iPhone, start with [IOS.md](IOS.md).**

Four deployable pieces, with **Supabase Postgres** for data + auth, designed to
deploy on **Render**.

```
                     ┌──────────────┐  service-role  ┌────────────┐
        ┌───────────▶│ server/  API │───────────────▶│            │
        │   JWT      │ workouts,    │                │  Supabase  │
        │            │ programs,    │                │  Postgres  │
┌───────┴────┐       │ nutrition,AI │                │  + Auth    │
│  web/  PWA │       └──────┬───────┘                │            │
│ (static)   │              │ server-side            │            │
│            │              ▼                        │            │
│            │        Google Gemini                  │            │
│            │                                       │            │
│            │       ┌──────────────────┐            │            │
│            ├──────▶│ accounts/ service│───────────▶│            │
└────────────┘  JWT  │ auth, billing,   │            └────────────┘
                     │ admin            │                  ▲
┌────────────┐       └────────┬─────────┘                  │
│ admin/ SPA │────────────────┘         Stripe ◀───────────┘
│ (static)   │  ADMIN_API_KEY            webhooks
└────────────┘
```

The client (browser or iOS app) talks to **Supabase directly** for sign-in and
for every read and write of the user's own rows — row-level security is the
access control (see `supabase/migrations/native_client_access.sql`, guarded by
`web/src/lib/rls.test.ts`). It **never** touches Gemini, YouTube or Stripe: the
two services are the only holders of those keys and of the Supabase service
role, so every AI call, the shared AI caches, the AI quota, sign-up, billing
and account deletion still go through them.

## Repository layout
| Path | What |
| --- | --- |
| `web/` | Vite + React + TS app (Tailwind, shadcn-style UI, Zustand, Recharts) — the PWA and the iOS app |
| `web/ios/` | Capacitor iOS project (Xcode, Swift Package Manager) — see [IOS.md](IOS.md) |
| `server/` | Express + TS data API (Supabase + Gemini, zod-validated) |
| `accounts/` | Express + TS auth / account / Stripe-billing microservice |
| `admin/` | Vite + React admin panel (talks to `accounts/`, gated on `ADMIN_API_KEY`) |
| `supabase/schema.sql` | Postgres schema + RLS policies |
| `supabase/migrations/` | Incremental migrations, applied in filename order |
| `render.yaml` | Render Blueprint for all four services |

`server/` and `web/` are npm workspaces of the repo root; `accounts/` and
`admin/` are standalone npm projects. Every package also carries its own
lockfile, because Render builds each service from its own `rootDir`.

## Local development

### 1. Database (Supabase)
1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL editor, run `supabase/schema.sql`, then every file in
   `supabase/migrations/` in filename order.
3. Grab **Project Settings → API**: the URL, the `anon` key, the `service_role`
   key, and (optionally, see below) the **JWT Secret**.

### 2. Backend
```bash
cd server
cp .env.example .env     # fill in SUPABASE_* (and optionally GEMINI_API_KEY)
npm install
npm run dev              # http://localhost:8080  (GET /health to check)
```
Without `GEMINI_API_KEY` the API uses a built-in deterministic program generator,
so the whole flow works offline / key-free.

### 3. Accounts service
```bash
cd accounts
cp .env.example .env     # SUPABASE_*, STRIPE_*, ADMIN_API_KEY
npm install
npm run dev              # http://localhost:8090
```

### 4. Frontend
```bash
cd web
cp .env.example .env     # VITE_SUPABASE_URL/ANON_KEY, VITE_API_URL, VITE_ACCOUNTS_URL
npm install
npm run dev              # http://localhost:5173
```

### Tests
```bash
npm test --workspace=server
npm test --workspace=web
```

## Auth
Email/password via **Supabase Auth**. The client signs in with supabase-js
directly and supabase-js owns the session (refresh included); on iOS it is kept
in native Preferences. Sign-up still goes through `accounts/`, which creates the
user pre-confirmed and seeds the profile, free subscription and Stripe customer
with the service role. Calls to the services send the access token as a
`Bearer` header; both services verify it on every request and the client
refreshes once on a 401.

Token verification is **local by default**: the services check the JWT signature
in-process rather than calling Supabase on every request, which removes a network
round trip from the hot path of every single API call.

- Projects on Supabase's newer **asymmetric** signing keys need no configuration —
  the services fetch and cache the project's published JWKS.
- Projects on the legacy shared secret should set `SUPABASE_JWT_SECRET`.
- Anything that can't be verified locally falls back to `supabase.auth.getUser()`,
  so a missing or misconfigured secret degrades to the old behavior rather than
  locking anyone out.

The tradeoff: a token stays valid until it expires (1h by default) even if the
session is revoked server-side. Refreshing still goes through Supabase.

## Key behaviors
- **Supabase for data, services for secrets** — plain CRUD goes straight to
  Postgres under owner-only RLS (no hosted hop); AI flows go through the
  services, which scope every query to the authenticated `user_id`.
- **AI program generation** (`POST /api/program/generate`) and **adaptive refresh**
  (`POST /api/program/refresh`) run server-side. Refresh compiles a per-exercise 1RM /
  consistency summary from history and asks Gemini to apply progressive overload and
  swap stalled lifts. Strict JSON schema → deterministic mapping onto routines.
- **Equipment constraints are enforced, not just requested** — the athlete's
  available gear is fed to the model as a hard constraint (prompt + JSON enum),
  then the response is verified, re-prompted to repair violations, and finally
  filtered deterministically. Covered by unit tests in `server/src/gemini.equipment.test.ts`.
- **AI coach** (`POST /api/ai/coach`) answers questions, logs workouts from natural
  language, and proposes routine updates, grounded in the user's real recent history.
- **Nutrition planning** re-scales with the training program — a program refresh
  regenerates the diet plan against the new metabolic demand.
- **AI nutritionist + medical helper** (`POST /api/health/chat`) is the coach chat's
  second desk. It answers against the user's own medical record, and can add to
  that record from the conversation: `[ISSUE]` starts tracking something that needs
  fixing, `[RECORD]` files a fact into the medical history, and `[RULES]` writes
  standing do & don't rules. `POST /api/health/review`
  compiles the whole record into a ranked worklist for the **Medical dashboard**.
- **The do & don't list** (`health_rules`) is where the conversation turns into
  something actionable. Work out over a few turns that late-night acidic food is
  driving someone's reflux, and "avoid tomato sauce within 3h of bed" lands on
  their list by name — not "avoid acidic foods", which nobody can act on. Rules
  carry a direction (start / more / less / avoid / keep), a domain and the reason
  they exist, and the user can edit, pause, archive or add their own.
  See [Medical & health](#medical--health) for the safety and consent rules.
- **Offline resilience** — the PWA caches the app shell (Workbox) and mirrors data
  to `localStorage`. The active workout (incl. rest-timer `endsAt`) survives a refresh.
  Workouts finished offline are queued with a `clientId` and **auto-synced** (idempotent
  upsert) when connectivity returns. When the cache exceeds the browser's storage
  quota, old *synced* history is shed first — unsynced sessions are never dropped.
  In the iOS app the store lives in files in the app sandbox instead
  (`web/src/lib/deviceStorage.ts`): no quota, split per slice so a logged set
  doesn't rewrite the history, and older sessions stay on the phone once loaded.
- **Local notifications (iOS)** — rest-over alerts, training-day reminders that
  skip days you've trained, and a weekly health check-in with deliberately
  generic wording. Scheduled on the device; no push service.
- **Installable** — manifest (`standalone`/`portrait`), maskable icons, and a custom
  A2HS banner (Android `beforeinstallprompt` + guided iOS steps).
- **Controlled updates** — the service worker runs in `prompt` mode: a new build
  is downloaded and precached in the background, then *waits*. The app surfaces
  "A new version is ready — Reload" and only swaps over on a full reload, when
  the user accepts. Long-lived tabs re-check for a new build hourly and whenever
  the app returns to the foreground. The prompt is held back while a workout is
  in progress, and reappears once the session ends.

## Cost and abuse controls
Gemini calls are the only per-request cost in the app, so every route that can
reach one is metered:

| Control | Where | What it does |
| --- | --- | --- |
| Per-IP / per-user burst limit | all routes | coarse ceiling, `RATE_LIMIT_MAX` per window |
| Tighter AI burst limit | every AI route | `AI_RATE_LIMIT_MAX` per window |
| Daily quota | free-reachable AI routes | persisted in `ai_usage`, per plan (`QUOTA_*` env vars) |
| Entitlement gate | Pro-only AI routes | 402 unless the plan unlocks the feature |
| Credential limiter | `accounts/` `/auth/*` | long-window per-IP cap on signup/login/reset |

Free accounts keep their "first AI program" allowance — the quota layer meters it
rather than blocking it, which is why `/program/generate` is quota-gated rather
than entitlement-gated.

Generated exercise guides, classifications and MET values are cached **globally**
in `exercise_guides`, keyed on the exercise slug, so the same movement is only
ever generated once across the whole user base.

`GET /api/ai/usage` returns the caller's allowance and consumption for today.

The medical routes are the one place all three layers stack: a burst limit, the
`ai_medical` entitlement **and** a daily quota, because they run the priciest
model over the largest context in the app.

## API surface
### Data API (`server/`, all under `/api`, auth required)
| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/bootstrap` | hydrate profile + program + routines + exercises + recent history |
| GET | `/workouts?before=&limit=` | paged older history, outside the bootstrap window |
| GET | `/ai/usage` | today's AI allowance and usage |
| PUT | `/profile` | update profile |
| POST | `/program/generate` `/program/refresh` | AI generate / evolve |
| POST | `/nutrition/generate` `/nutrition/lookup` | diet plan / food lookup |
| POST/PUT/DELETE | `/routines[/:id]` | routine CRUD |
| POST | `/exercises` `/exercises/ai-assist` `/exercises/guide` `/exercises/met` | library + AI assist |
| GET | `/exercises/videos?name=&force=` | ranked YouTube demos for the how-to picker |
| POST | `/exercises/video` | remember the chosen demo (tallies the community default) |
| POST | `/ai/chat` `/ai/coach` | onboarding chat / ongoing coaching |
| POST/DELETE | `/workouts[/:id]` | save (bulk, idempotent) / delete history |
| GET | `/health/overview` | health profile + tracked issues + medical history |
| PUT/POST | `/health/profile` `/health/consent` | medical background / AI opt-in |
| POST/PATCH/DELETE | `/health/issues[/:id]` | the "things to work on" tracker |
| POST | `/health/issues/:id/events` | check-in or measurement on an issue |
| POST/DELETE | `/health/records[/:id]` | medical history entries |
| POST/PATCH/DELETE | `/health/rules[/:id]` | the do & don't list |
| POST | `/health/review` `/health/chat` | AI health review / medical + nutrition chat |

`/exercises/videos` is served from a global cache keyed on the exercise slug.
A YouTube `search.list` costs 100 units of a default 10,000/day allocation — a
**global** ~100 searches per day for the whole service — so the cache, the
`YOUTUBE_DAILY_BUDGET` meter and in-flight deduplication are what make the
feature affordable rather than merely fast. With a warm cache the steady-state
cost is zero. Unset `YOUTUBE_API_KEY` disables the picker; the written how-to
guide still renders on its own.

`/bootstrap` returns only the last `BOOTSTRAP_HISTORY_DAYS` (default 120) of
sessions plus a `history` block describing the window; the client loads older
sessions on demand. This keeps cold start fast and the `localStorage` mirror
inside the browser's quota for long-time users.

### Accounts service (`accounts/`)
| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/auth/signup` `/auth/login` `/auth/refresh` | session management |
| * | `/account/*` | profile / account management |
| * | `/billing/*` | Stripe checkout + portal |
| POST | `/webhooks/stripe` | Stripe webhook (raw body, signature-verified) |
| * | `/admin/*` | admin panel API, gated on `ADMIN_API_KEY` |

## Medical & health
The Medical tab and the coach chat's **Health** desk share one record, stored in
the same database as everything else (`health_profile`, `health_issues`,
`health_issue_events`, `health_records`, `health_rules`). The code is split into
six layers, five of them in `server/src/health/`:

| Layer | Where | Job |
| --- | --- | --- |
| 1. Health memory | `memory.ts`, `memoryStore.ts` | the longitudinal record, its persistence, and who owns which fields |
| 2. Reasoning | `reasoning.ts` | the cloud model: prompts, provider fallback, parsing replies |
| 3. Safety | `safety.ts` | red-flag escalation, disclaimers, clamping model output before it is stored |
| 4. Anatomy & mobility | `anatomy.ts` | body regions, metric trends, check-in staleness, BMI and similar |
| 5. Chat + logging | `routes/health.ts`, web UI | HTTP, validation, the tracker and history CRUD |
| 6. Privacy | `privacy.ts` (+ consent gate in the route) | what may leave the server, and in what form |

```
user ─► health app ─► TLS ─► Postgres (owner RLS, encrypted at rest)
                                │
                     local memory (one request)
                ┌───────────────┴────────────────┐
        local processing                     cloud AI
  anatomy: trends, BMI, regions      reasons over the BRIEF only:
  privacy: relevance, scrubbing      conversation, synthesis,
  safety:  red flags, clamping       difficult questions
                └───────────────┬────────────────┘
                            AI coach
```

**The cloud model never receives the health record.** Each request loads the
whole record into memory on the server; the privacy layer then builds a brief of
only what the question is about. A knee question carries the knee issue and its
trend, the matching history and rules, past surgeries and sleep, and not the
lipid panel, the family history or last year's dermatology note. Trends are
computed locally and sent as conclusions ("pain 7 → 4 over 3 weeks, improving;
target < 2 not yet met"), dates become relative, and the person's name, emails,
phone and ID numbers and links are scrubbed from both the brief and the
transcript. Only the last 12 turns are re-sent, with photos kept on the newest
turn only. One deliberate exception: conditions, medications and allergies are
always sent, because deciding whether one bears on a question is itself a
clinical judgement. A review gets more (every open issue, six months of
history), but older history travels only as counts, closed issues as a key and a
title, and the rules not at all. Every reply carries a `disclosure` of what was
sent and held back, and the UI prints it under the reply.

**Consent gates the model, not the data.** The CRUD routes always work — it is the
user's record, in the user's database. The two AI routes (`/health/review`,
`/health/chat`) return 403 `medical_consent_required` until the user opts in,
because those are the only paths that send anything derived from health data to
a model provider. Consent is a timestamp on `health_profile` and can be revoked
from the Medical tab.

**The medical desk runs on the Gemini API**, with `GEMINI_API_KEY` and
`MEDICAL_AI_GEMINI_MODEL` (default: the coach model). Every reply reports the
model that answered, and the UI prints it. Self-hosted MedGemma and Vertex AI
were both supported once and were removed in Sept 2026;
[`wiki/MedGemma-Decommission.md`](wiki/MedGemma-Decommission.md) records how
their Google Cloud resources were torn down. Because the brief is health data,
however minimised, the Gemini key should belong to a **paid** (billing-enabled)
project: Google's terms for the unpaid tier allow prompts to be used to improve
its products.

**Emergencies are screened for in code, not left to the model.** `detectRedFlags`
runs over both the user's message and the model's reply; a hit prepends emergency
guidance and marks the turn urgent regardless of what the model said — and still
fires when the model call fails outright. The system prompt additionally forbids
diagnosing, prescribing, and any dosing of prescription medication.

**The do & don't list follows the same contract.** The AI may refresh a rule it
wrote — re-wording it, or upgrading "less" to "avoid" as it learns more — under
the same `key`. It may not touch a rule the user has edited (`user_edited`, set
by any PATCH), and it may not resurrect one they archived. Both are skipped
silently, so the list stays theirs.

**The AI never owns the tracker.** A review updates an issue's wording, plan and
severity by reusing its `key`; `status` and `progress` stay user-owned, ticked
steps stay ticked, metric readings survive a rewrite, and issues the user resolved
or dismissed are never reopened. "This looks resolved" comes back as a suggestion
the user confirms with one tap. The rules live in `reconcileIssues`
(`server/src/health/memory.ts`) and are covered by `server/src/health/medical.test.ts`.

Health data is also the one thing the client does **not** persist on the
device — not to `localStorage` on the web, not to the app's files on iOS. It is
fetched per session (straight from Supabase) and dropped on logout.

## Environment reference
Beyond the obvious `SUPABASE_*`, `GEMINI_API_KEY` and `STRIPE_*` values:

| Var | Service | Default | Purpose |
| --- | --- | --- | --- |
| `NODE_ENV` | both | `development` | `production` returns generic 500 messages instead of upstream error text |
| `SUPABASE_JWT_SECRET` | both | — | enables local HS256 token verification |
| `ADMIN_API_KEY` | both | — | gates `/admin/*` and `/internal/ai-test` |
| `GEMINI_TIMEOUT_MS` | server | `45000` | hard deadline on Gemini calls |
| `GEMINI_COACH_TIMEOUT_MS` | server | `90000` | longer deadline for the search-grounded coach model |
| `RATE_LIMIT_MAX` | both | `300` / `200` | requests per window per user/IP |
| `AI_RATE_LIMIT_MAX` | server | `20` | AI requests per window per user |
| `AUTH_RATE_LIMIT_MAX` | accounts | `30` | auth attempts per 15 min per IP |
| `QUOTA_PROGRAM_FREE` / `_PRO` | server | `3` / `30` | daily program generations |
| `QUOTA_ONBOARD_FREE` / `_PRO` | server | `60` / `300` | daily onboarding chat turns |
| `QUOTA_LOOKUP_FREE` / `_PRO` | server | `25` / `250` | daily food lookups |
| `QUOTA_MEDICAL_FREE` / `_PRO` | server | `0` / `60` | daily medical AI calls (Pro-only feature) |
| `BOOTSTRAP_HISTORY_DAYS` | server | `120` | history window returned on cold start |
| `MEDICAL_AI_GEMINI_MODEL` | server | coach model | Gemini model for the medical desk |
| `MEDICAL_AI_TIMEOUT_MS` | server | `90000` | hard deadline per medical model attempt |
| `YOUTUBE_API_KEY` | server | — | YouTube Data API v3 key; unset disables the demo-video picker |
| `YOUTUBE_DAILY_BUDGET` | server | `90` | **global** searches per UTC day (Google's hard ceiling is ~100) |
| `YOUTUBE_CHANNEL_ALLOWLIST` | server | — | channel IDs promoted to the top of every result set |
| `YOUTUBE_REGION` / `YOUTUBE_RELEVANCE_LANGUAGE` | server | `US` / `en` | search locale |
| `YOUTUBE_CACHE_DAYS` | server | `180` | how long cached demo results stay fresh |
| `YOUTUBE_RATE_LIMIT_MAX` | server | `12` | video requests per window per user |

## Deploy to Render
1. Push this repo to GitHub.
2. Render → **New → Blueprint** → select the repo (`render.yaml` is detected).
3. Fill the secrets marked `sync: false` on each service.
4. Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL` and `VITE_ACCOUNTS_URL` on **fitnofat-web** (only needed if you use the browser version too).
5. Deploy. Update `CORS_ORIGIN` once the web URL is final, then redeploy.
6. Point the Stripe webhook at `<accounts URL>/webhooks/stripe`.

## Tech stack
**Frontend:** Vite, React, TypeScript, Tailwind, Lucide, Zustand, Recharts, vite-plugin-pwa, supabase-js.
**iOS:** Capacitor 8 (App, Filesystem, Preferences, Local Notifications, Haptics, Browser, Network, Status Bar, Splash Screen, Keyboard).
**Backend:** Node, Express, TypeScript, @supabase/supabase-js, zod, helmet, express-rate-limit.
**Data/Auth:** Supabase (Postgres + Auth). **AI:** Google Gemini. **Billing:** Stripe.
**Tests:** Vitest (`server/`, `web/`), GitHub Actions CI across all four packages.
