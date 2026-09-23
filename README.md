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
| POST | `/health/warm` | wake a scaled-to-zero self-hosted model |

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
`health_issue_events`, `health_records`). Four rules shape the design:

**Consent gates the model, not the data.** The CRUD routes always work — it is the
user's record, in the user's database. The two AI routes (`/health/review`,
`/health/chat`) return 403 `medical_consent_required` until the user opts in,
because those are the only paths that send health data to a model provider.
Consent is a timestamp on `health_profile` and can be revoked from the Medical tab.

**The model is pluggable and the fallback is visible.** `MEDICAL_AI_PROVIDER=auto`
picks the first configured of **cloudrun → vertex → gemini**, and falls back down
that chain per request when one fails (or when the turn carries a photo the
text-only `:predict` contract can't take). Every reply reports the model that
actually answered, so a fallback is never silent — `medgemma-1.5-4b-it (self-hosted)`
in the chat footer means the medical model answered, `(Gemini)` means it didn't.

**`cloudrun` is the option to reach for if you don't want a general model.**
It points at any OpenAI-compatible server you host — vLLM, Ollama, TGI — so the
weights and the inference both stay on infrastructure you control.
[`wiki/MedGemma-Cloud-Run-Deployment.md`](wiki/MedGemma-Cloud-Run-Deployment.md) is a full runbook for
MedGemma (Google's open-weights medical model) on Cloud Run with an L4 GPU:
~$10–15/month because it scales to zero, authenticated with a Cloud Run ID token
minted from the same service-account key Vertex uses.

Running on Vertex is worth the setup even for a Gemini model: the request stays
inside your own Google Cloud project, under your IAM and data-residency rules,
instead of going to a shared API-key endpoint. Point `MEDICAL_AI_MODEL` at a
medical-tuned publisher model if your project serves one — `usesPredictShape()`
picks the request contract from the model id, so no code changes. Note that
MedLM, the productized Med-PaLM 2 (`medlm-medium`/`medlm-large`), was
[retired by Google on 2025-09-29](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/release-notes),
which is why the default is a general Gemini model.

Vertex needs OAuth rather than an API key; `server/src/vertex.ts` mints tokens
from the service-account key directly, with no Google SDK. Two setup gotchas:
the service account needs `roles/aiplatform.user` (**not** the Vertex AI Service
Agent role, which is for Google's own service agents), and since Vertex AI was
[renamed to Gemini Enterprise Agent Platform in April 2026](https://cloud.google.com/products/gemini-enterprise-agent-platform)
searching the console API Library for "vertex" finds nothing — the service name
is unchanged, so enable it directly at
`console.cloud.google.com/apis/library/aiplatform.googleapis.com`.

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
(`server/src/medical.ts`) and are covered by `server/src/medical.test.ts`.

**A self-hosted model is woken before it is needed.** A Cloud Run GPU that has
scaled to zero takes 1–2 minutes to load, which is longer than anyone will wait
at a chat box. Opening the health desk (or the Medical tab, once the AI is
usable) calls `POST /health/warm`, so the boot overlaps with the user typing
instead of following it. That route runs no inference and sends nothing about
the user — so unlike every other route here it carries no consent gate — but it
does cost GPU time, so it is rate-limited and Pro-gated. Warming is per-visit by
design: pinging from app start would keep the instance from ever sleeping and
quietly cost `--min-instances=1` money (~$480/month) without the reliability of
having chosen it.

Health data is also the one thing the web client does **not** mirror to
`localStorage` — it is fetched per session and dropped on logout.

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
| `MEDICAL_AI_PROVIDER` | server | `auto` | `auto` / `cloudrun` / `vertex` / `gemini` — who answers medical questions |
| `MEDICAL_AI_BASE_URL` | server | — | self-hosted OpenAI-compatible endpoint, incl. `/v1` (turns on `cloudrun`) |
| `MEDICAL_AI_SELF_HOSTED_MODEL` | server | `MEDICAL_AI_MODEL` | model name the self-hosted server expects |
| `MEDICAL_AI_API_KEY` | server | — | static bearer for a self-hosted endpoint that isn't on Cloud Run |
| `MEDICAL_AI_MODEL` | server | coach model | Vertex publisher model for the medical desk |
| `MEDICAL_AI_GEMINI_MODEL` | server | coach model | model used when the medical desk runs on Gemini |
| `MEDICAL_AI_TIMEOUT_MS` | server | `180000` | hard deadline on medical model calls (must exceed a cold start) |
| `MEDICAL_AI_WARM_PROBE_MS` | server | `8000` | how long `/health/warm` waits before reporting "warming" |
| `VERTEX_PROJECT_ID` / `VERTEX_LOCATION` | server | — / `us-central1` | Vertex AI project and region |
| `VERTEX_SERVICE_ACCOUNT_JSON` | server | — | service-account key JSON (raw or base64) for Vertex OAuth |
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
4. Set `VITE_API_URL` and `VITE_ACCOUNTS_URL` on **fitnofat-web**.
5. Deploy. Update `CORS_ORIGIN` once the web URL is final, then redeploy.
6. Point the Stripe webhook at `<accounts URL>/webhooks/stripe`.

## Tech stack
**Frontend:** Vite, React, TypeScript, Tailwind, Lucide, Zustand, Recharts, vite-plugin-pwa.
**Backend:** Node, Express, TypeScript, @supabase/supabase-js, zod, helmet, express-rate-limit.
**Data/Auth:** Supabase (Postgres + Auth). **AI:** Google Gemini. **Billing:** Stripe.
**Tests:** Vitest (`server/`, `web/`), GitHub Actions CI across all four packages.
