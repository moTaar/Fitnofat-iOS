# ForgeFit — AI Workout & Exercise Tracker (PWA)

A minimalist, dark-mode-first, mobile-optimized workout tracker with AI-driven
program personalization, dynamic progression, and full offline-capable PWA support.

Separated **frontend** (React PWA) and **backend** (Express API), with **Supabase
Postgres** for data + auth. Designed to deploy on **Render**.

```
┌────────────┐     HTTPS / JWT      ┌──────────────┐     service-role     ┌────────────┐
│  web/  PWA │ ──────────────────▶ │ server/  API │ ───────────────────▶ │  Supabase  │
│ (Render    │   (Bearer token)    │ (Render web  │   (Postgres + Auth)  │  Postgres  │
│  static)   │ ◀────────────────── │  service)    │ ◀─────────────────── │            │
└────────────┘      JSON            └──────┬───────┘                       └────────────┘
                                           │ server-side
                                           ▼
                                     Google Gemini
```

The browser **never** touches Supabase or Gemini directly — the API is the sole
gateway and holds the service-role + Gemini keys.

## Repository layout
| Path | What |
| --- | --- |
| `web/` | Vite + React + TS PWA (Tailwind, shadcn-style UI, Zustand, Recharts) |
| `server/` | Express + TS API (Supabase + Gemini, zod-validated) |
| `supabase/schema.sql` | Postgres schema + RLS policies |
| `render.yaml` | Render Blueprint for both services |

## Local development

### 1. Database (Supabase)
1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL editor, run `supabase/schema.sql`.
3. Grab **Project Settings → API**: the URL, the `anon` key, and the `service_role` key.

### 2. Backend
```bash
cd server
cp .env.example .env     # fill in SUPABASE_* (and optionally GEMINI_API_KEY)
npm install
npm run dev              # http://localhost:8080  (GET /health to check)
```
Without `GEMINI_API_KEY` the API uses a built-in deterministic program generator,
so the whole flow works offline / key-free.

### 3. Frontend
```bash
cd web
cp .env.example .env     # VITE_API_URL=http://localhost:8080
npm install
npm run dev              # http://localhost:5173
```

## Auth
Email/password via **Supabase Auth**. The API (`/api/auth/*`) signs users up
(auto-confirmed) and in, returning an access + refresh token. The frontend stores
the session and sends the access token as a `Bearer` header; the API verifies it on
every request and the client transparently refreshes once on a 401.

## Key behaviors
- **Backend is the only gateway** — all CRUD + AI flows go through the Express API,
  which scopes every query to the authenticated `user_id`.
- **AI program generation** (`POST /api/program/generate`) and **adaptive refresh**
  (`POST /api/program/refresh`) run server-side. Refresh compiles a per-exercise 1RM /
  consistency summary from history and asks Gemini to apply progressive overload and
  swap stalled lifts. Strict JSON schema → deterministic mapping onto routines.
- **Offline resilience** — the PWA caches the app shell (Workbox) and mirrors all data
  to `localStorage`. The active workout (incl. rest-timer `endsAt`) survives a refresh.
  Workouts finished offline are queued with a `clientId` and **auto-synced** (idempotent
  upsert) when connectivity returns.
- **Installable** — manifest (`standalone`/`portrait`), maskable icons, and a custom
  A2HS banner (Android `beforeinstallprompt` + guided iOS steps).

## API surface (all under `/api`, auth required except `/auth/*`)
| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/auth/signup` `/auth/login` `/auth/refresh` | session management |
| GET | `/bootstrap` | hydrate profile + program + routines + exercises + history |
| PUT | `/profile` | update profile |
| POST | `/program/generate` `/program/refresh` | AI generate / evolve |
| POST/PUT/DELETE | `/routines[/:id]` | routine CRUD |
| POST | `/exercises` | create custom exercise |
| POST/DELETE | `/workouts[/:id]` | save (bulk, idempotent) / delete history |

## Deploy to Render
1. Push this repo to GitHub.
2. Render → **New → Blueprint** → select the repo (`render.yaml` is detected).
3. Fill the secrets on **forgefit-api**: `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, and `CORS_ORIGIN` (the web URL).
4. Set `VITE_API_URL` on **forgefit-web** to the API URL.
5. Deploy. Update `CORS_ORIGIN` once the web URL is final, then redeploy the API.

## Tech stack
**Frontend:** Vite, React, TypeScript, Tailwind, Lucide, Zustand, Recharts, vite-plugin-pwa.
**Backend:** Node, Express, TypeScript, @supabase/supabase-js, zod.
**Data/Auth:** Supabase (Postgres + Auth). **AI:** Google Gemini.
