# Fitnofat — AI Workout, Nutrition & Coaching Tracker (PWA)

A minimalist, dark-mode-first, mobile-optimized training app with AI-driven
program personalization, adaptive progression, an AI coach, macro-matched
nutrition planning, and full offline-capable PWA support.

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

The browser **never** touches Supabase, Gemini or Stripe directly — the two
services are the sole gateways and hold the service-role, Gemini and Stripe keys.

## Repository layout
| Path | What |
| --- | --- |
| `web/` | Vite + React + TS PWA (Tailwind, shadcn-style UI, Zustand, Recharts) |
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
cp .env.example .env     # VITE_API_URL, VITE_ACCOUNTS_URL
npm install
npm run dev              # http://localhost:5173
```

### Tests
```bash
npm test --workspace=server
npm test --workspace=web
```

## Auth
Email/password via **Supabase Auth**, handled by `accounts/`. The frontend stores
the session and sends the access token as a `Bearer` header; both services verify
it on every request and the client transparently refreshes once on a 401.

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
- **Backend is the only gateway** — all CRUD + AI flows go through the services,
  which scope every query to the authenticated `user_id`.
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
- **Offline resilience** — the PWA caches the app shell (Workbox) and mirrors data
  to `localStorage`. The active workout (incl. rest-timer `endsAt`) survives a refresh.
  Workouts finished offline are queued with a `clientId` and **auto-synced** (idempotent
  upsert) when connectivity returns. When the cache exceeds the browser's storage
  quota, old *synced* history is shed first — unsynced sessions are never dropped.
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
| POST | `/ai/chat` `/ai/coach` | onboarding chat / ongoing coaching |
| POST/DELETE | `/workouts[/:id]` | save (bulk, idempotent) / delete history |

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
| `BOOTSTRAP_HISTORY_DAYS` | server | `120` | history window returned on cold start |

## Deploy to Render
1. Push this repo to GitHub.
2. Render → **New → Blueprint** → select the repo (`render.yaml` is detected).
3. Fill the secrets marked `sync: false` on each service.
4. Set `VITE_API_URL` and `VITE_ACCOUNTS_URL` on **fitnofat-web**.
5. Deploy. Update `CORS_ORIGIN` once the web URL is final, then redeploy.
6. Point the Stripe webhook at `<accounts URL>/webhooks/stripe`.

## Tech stack
**Frontend:** Vite, React, TypeScript, Tailwind, Lucide, Zustand, Recharts, vite-plugin-pwa.
**Backend:** Node, Express, TypeScript, @supabase/supabase-js, zod, helmet, express-rate-limit.
**Data/Auth:** Supabase (Postgres + Auth). **AI:** Google Gemini. **Billing:** Stripe.
**Tests:** Vitest (`server/`, `web/`), GitHub Actions CI across all four packages.
