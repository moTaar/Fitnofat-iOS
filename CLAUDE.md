# Fitnofat — working notes

AI-driven workout / nutrition / coaching PWA. See `README.md` for the full
architecture, API surface and environment reference; this file covers the things
that are easy to get wrong when changing the code.

## Layout and install
Four packages. `server/` and `web/` are npm workspaces of the repo root;
`accounts/` and `admin/` are standalone. **Every package also has its own
lockfile**, because `render.yaml` builds each service from its own `rootDir`.

Consequence: running `npm install <pkg>` inside `server/` or `web/` updates the
**root** lockfile, not the package's own — npm resolves them as workspace
members. To refresh a child lockfile, the root `package.json` has to be moved
aside for the duration of the install. Keep both in sync when adding a dependency
to `server/` or `web/`, or CI (`npm ci` per package) will fail while local dev
passes.

## Commands
```bash
npm test --workspace=server      # vitest
npm test --workspace=web
npm run typecheck --workspace=server
npm run lint --workspace=web     # tsc --noEmit
```
CI runs typecheck + test + build for all four packages on every PR.

## Things that will bite you

**Two services verify the same tokens.** `server/src/jwt.ts` and
`accounts/src/jwt.ts` are intentional copies (separate npm projects, no shared
package). Change one, change the other.

**The entitlement map is mirrored three times**: `accounts/src/entitlements.ts`
(authority), `server/src/entitlements.ts`, and `web/src/lib/entitlements.ts`
(UI hints only). Adding a Feature means touching all three (plus the `Feature`
union in `web/src/lib/types.ts`).

**Plans are cached for 60s** in the data API (`resolvePlan`). A Stripe upgrade
can take up to a minute to unlock a feature; that's deliberate, not a bug.

**Never make an AI route reachable without a meter.** Every route that can reach
Gemini must carry `aiLimiter` plus *either* `requireEntitlement` (Pro-only) or
`aiQuota` (free-reachable). `/program/generate` and `/ai/chat` are deliberately
quota-gated rather than entitlement-gated so free users keep their first program
and onboarding.

**Body limits are per-route.** Only `/api/ai/coach` gets 25mb (image
attachments); everything else is capped at 512kb in `server/src/index.ts`.

**`/bootstrap` returns a history window, not everything.** Older sessions come
from `GET /workouts`. Code that assumes `store.history` is the complete archive
is wrong — check `historyHasMore`.

**localStorage is not reliable storage.** `resilientStorage` in
`web/src/lib/store.ts` sheds old *synced* history when the quota is hit.
Unsynced sessions are never dropped — they exist nowhere else.

**Equipment enforcement is load-bearing.** The AI will program gear the athlete
doesn't own if the constraint chain in `server/src/gemini.ts` breaks, and nothing
downstream catches it. `__equipment` is exported purely as a test seam; the
tests in `gemini.equipment.test.ts` are the guard.

**Gemini output is not guaranteed JSON.** Parse it through `parseJson`, which
throws `GEMINI_BAD_JSON`. Recoverable failures (`NO_API_KEY`, `GEMINI_TIMEOUT`,
`GEMINI_BAD_JSON`) fall back to the local deterministic generator via
`isRecoverable` — don't let them surface as 500s.

**Error messages from upstream are not client-safe.** Supabase/Gemini/Stripe
messages can carry key fragments and row contents. Throw `HttpError` for anything
the client should read verbatim; everything else becomes a generic 500 when
`NODE_ENV=production`.

**Medical AI has a consent gate, and it is server-side.** `/api/health/chat` and
`/api/health/review` refuse with 403 `medical_consent_required` until
`health_profile.ai_consent_at` is set. That flag is the only thing standing
between the user's medical record and a model provider — never bypass it, and
never move the check into the client.

**The medical model is pluggable and the fallback is visible.** `server/src/medical.ts`
picks the first configured of cloudrun → vertex → gemini and falls back down that
chain per request. `cloudrun` is any OpenAI-compatible server (vLLM/Ollama/TGI),
authenticated with a Google ID token minted by `googleIdToken()` from the same
service-account key Vertex uses — audience is the Cloud Run URL WITHOUT the `/v1`
path, so don't "helpfully" pass the full base URL.
[`wiki/MedGemma-Cloud-Run-Deployment.md`](wiki/MedGemma-Cloud-Run-Deployment.md) is the deployment
runbook.
Every reply carries the model that actually answered and the UI prints it — don't
drop that field to tidy a payload, it's the only thing telling the user which
model replied. `usesPredictShape()` picks the contract from the model id:
`medlm-*`/`text-bison` take the PaLM-era `:predict` shape (no system role, no
JSON mode, no images), `gemini-*` take `:generateContent`. Keep both paths —
MedLM itself was retired in Sept 2025, but the `:predict` branch is what lets a
medical-tuned publisher model be swapped in by env var alone.

**Vertex AI is now called "Gemini Enterprise Agent Platform"** (renamed April
2026). Only the branding moved: `aiplatform.googleapis.com`, model ids, IAM role
ids and auth are unchanged, so `server/src/vertex.ts` needs no follow-up. It does
mean the console API Library has no "Vertex AI API" entry to search for.

**Red flags are screened in code, not delegated to the prompt.** `detectRedFlags`
runs on the user's message *and* the model's reply, and still fires when the model
call fails. Widening `RED_FLAGS` is cheap; a miss is not.

**A health review must not clobber the user's progress.** `reconcileIssues` is the
contract: the AI may rewrite an issue's wording/plan/severity under the same
`key`, but `status` and `progress` are user-owned, ticked steps stay ticked,
metric readings survive, and resolved/dismissed issues are never reopened.
`server/src/medical.test.ts` is the guard.

**Health data never reaches localStorage.** The store's `partialize` allowlist
deliberately omits `health`/`healthIssues`/`healthRecords`, and `logout` clears
them. Adding them to the persisted set would leave medical data on a shared
device and compete with workout history for the same 5MB.

**Keep the eager route bundle small.** `web/src/App.tsx` lazy-loads every page
except Dashboard and ActiveWorkout, which are the in-gym critical path. A static
import of a heavy page from an always-mounted component silently undoes this —
that's how `AiCoach` originally ended up in the entry chunk via `CoachBubble`.

## Database
`supabase/schema.sql` is the base; `supabase/migrations/*.sql` apply in filename
order on top. `ai_usage` and `exercise_guides` are service-role-only (RLS on, no
policies) — the client never reads them directly.

The medical tables (`add_medical.sql`) are ordinary owner-RLS tables:
`health_profile` (background + AI consent), `health_issues` (the tracker, unique
on `(user_id, key)` — that uniqueness is what lets a re-review update instead of
duplicate), `health_issue_events` (check-ins/measurements) and `health_records`
(medical history).
