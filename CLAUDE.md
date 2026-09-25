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

`ios/Fitnofat` is the native SwiftUI client (Swift package, iOS 17). It is not an
npm package and can't be built on Windows; see "Web and iOS" below.

## Commands
```bash
npm test --workspace=server      # vitest
npm test --workspace=web
npm run typecheck --workspace=server
npm run lint --workspace=web     # tsc --noEmit
npm run parity                   # web ⇄ iOS drift check; --backlog lists known gaps
```
CI runs typecheck + test + build for all four packages, plus the parity check,
on every PR.

## Web and iOS are two clients of one API

`web/` and `ios/Fitnofat` share no code, so nothing keeps them in step except
this rule: **a change to what users can do, or to what data crosses the API,
lands on both clients or is recorded in `parity.json`.** `pending` is the
lagging platform's backlog; `skip` is a deliberate difference, with the reason.
The `port-feature` skill has the web ↔ Swift file map and the porting steps.

- **Run `npm run parity` after touching either client or any route.** It
  compares server/accounts routes against both clients' calls, web string
  unions against Swift enums, Swift `Codable` structs against web's interfaces,
  and every copy of the entitlement map. CI fails on anything unrecorded, and on
  a `parity.json` entry that no longer differs, so ported work has to be
  crossed off.
- **iOS decoding is all-or-nothing.** One unknown enum value or one missing
  required field fails the whole response, so a server change that is harmless
  to web can blank the iOS app. A field the API may omit must be `T?` in Swift
  (`var x: T = default` is still required), and an enum over values the server
  doesn't control needs an `init(from:)` fallback. Entries marked DECODE BREAK
  in `parity.json` are live iOS failures of exactly this kind.
- **Web's types are the contract the check reads.** If web's type for a
  response is looser or stricter than what the server really sends, fix the
  type rather than recording around it.
- A Stop hook (`.claude/hooks/parity-reminder.mjs`) sends Claude back once per
  session when the work changed one client but not the other, or left the check
  failing. Answering "no iOS counterpart" in one line is a valid response for
  styling or platform plumbing.
- Swift written here is uncompiled. Say so when handing off iOS changes.

## Things that will bite you

**Two services verify the same tokens.** `server/src/jwt.ts` and
`accounts/src/jwt.ts` are intentional copies (separate npm projects, no shared
package). Change one, change the other.

**The entitlement map is mirrored four times**: `accounts/src/entitlements.ts`
(authority), `server/src/entitlements.ts`, `web/src/lib/entitlements.ts` and
`ios/Fitnofat/Sources/Services/EntitlementService.swift` (the last two are UI
hints only). Adding a Feature means touching all four, plus the `Feature` union
in `web/src/lib/types.ts`, the `Feature` enum in `Models/Types.swift` and the
`switch` in `ProUpgradeView.swift`. `npm run parity` fails if the copies
disagree, and this is the one gap `parity.json` can't excuse.

**Plans are cached for 60s** in the data API (`resolvePlan`). A Stripe upgrade
can take up to a minute to unlock a feature; that's deliberate, not a bug.

**Never make an AI route reachable without a meter.** Every route that can reach
Gemini must carry `aiLimiter` plus *either* `requireEntitlement` (Pro-only) or
`aiQuota` (free-reachable). `/program/generate` and `/ai/chat` are deliberately
quota-gated rather than entitlement-gated so free users keep their first program
and onboarding.

**Body limits are per-route.** Only `/api/ai/coach` gets 25mb (image
attachments); everything else is capped at 512kb in `server/src/index.ts`.

**The YouTube quota is global, not per-user.** `search.list` costs 100 units of
a default 10,000/day project allocation — about **100 searches per day for the
entire user base**. Three things keep `/exercises/videos` inside that and all
three are load-bearing: results cache per movement in `exercise_guides.videos`
(a search describes the lift, not the athlete), `claimYoutubeSearch` meters a
global daily budget in Postgres, and `dedupeSearch` collapses concurrent misses
on the same slug. Per-user rate limiting alone does **not** protect this — 50
users each politely searching three times exhausts the day. Unlike `aiQuota`,
the budget check fails *closed*: a broken meter that lets searches through burns
an allowance that can't be topped up before midnight Pacific.

**Demo videos degrade, they never 500.** The written guide is the primary
content and the video is an enhancement, so `/exercises/videos` returns
`{ videos: [], unavailable }` for a missing key, an exhausted budget or a
YouTube outage, and serves stale cached results in preference to nothing.

**The stick figure is a fallback now, and only renders when the archetype is
actually known.** `knownArchetype` returns `undefined` rather than guessing; it
used to default to `"squat"`, which is why a Pallof press and a farmer's carry
both animated as a barbell squat. A confidently wrong demo teaches bad form and
casts doubt on the correct written steps beside it — if you add a caller, branch
on `knownArchetype` rather than rendering whatever `animationFor` returns.

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

**Health code is six layers; keep them apart.** `server/src/health/`: `memory.ts`
+ `memoryStore.ts` (the record, persistence, field ownership), `reasoning.ts`
(the cloud model), `safety.ts` (red flags, output clamping), `anatomy.ts`
(regions, trends, calculations), `privacy.ts` (what leaves the server); the
chat/logging interface is `routes/health.ts` plus the web UI. `memory.ts`,
`anatomy.ts`, `privacy.ts` and `safety.ts` are pure on purpose — they must not
import `supabase.ts`, or their tests need a live client.

**The cloud model gets a brief, never the record.** `reasoning.ts` is only ever
handed `buildChatBrief` / `buildReviewBrief` output from `privacy.ts` — never a
`HealthMemory`, never the raw transcript. Do not add a code path that
serialises the record into a prompt, and do not "improve an answer" by widening
what the brief carries without weighing it: every item added to a brief is
health data sent to a third party. Conditions, medications and allergies are
the one always-sent set (interaction safety); everything else is chosen by
relevance. The `disclosure` on each reply says what was sent, and the UI shows
it — like `model`, don't drop it to tidy a payload. `privacy.test.ts` is the
guard, including the scrubber tests that keep lab values and dates intact.

**The medical desk is Gemini-only, and the model label is visible.**
`server/src/health/reasoning.ts` calls the Gemini API with `GEMINI_API_KEY`.
Self-hosted MedGemma and Vertex AI were removed in Sept 2026 (their GCP
resources, service account and keys are deleted — see
`wiki/MedGemma-Decommission.md`); leftover `MEDICAL_AI_PROVIDER`/`VERTEX_*`
env vars are ignored and named in a boot warning. Every reply carries the model
that actually answered and the UI prints it — don't drop that field to tidy a
payload, it's the only thing telling the user which model replied.

**Red flags are screened in code, not delegated to the prompt.** `detectRedFlags`
runs on the user's message *and* the model's reply, and still fires when the model
call fails. Widening `RED_FLAGS` is cheap; a miss is not.

**The browser must outlast the server.** `MEDICAL_AI_TIMEOUT_MS` is 90s; the
web client's `MEDICAL_REQUEST_TIMEOUT_MS` (120s) sits above it for the health
routes only. Lower it below the server's deadline and the browser aborts a
request the server is still answering.

**Rules are the user's list, not the AI's.** `upsertAiRules` in
`health/memoryStore.ts` may refresh a rule the AI wrote under the same `(user_id,
key)`, but skips any rule with `user_edited` set or `status = 'archived'` —
silently, so an edit or an archive is permanent against later chat turns. Any
PATCH to `/health/rules/:id` sets `user_edited`; that is the whole mechanism.

**`[RULES]` can ride along with `[ISSUE]` or `[RECORD]` in one reply**, unlike
those two, which stay mutually exclusive. `parseMedicalReply` therefore pulls the
rules array out first with `extractJsonArrayAfter` — a bracket-counting scan
rather than `lastIndexOf("]")`, because the array may be followed by another
marker and the naive version would swallow it.

**A health review must not clobber the user's progress.** `reconcileIssues` is the
contract: the AI may rewrite an issue's wording/plan/severity under the same
`key`, but `status` and `progress` are user-owned, ticked steps stay ticked,
metric readings survive, and resolved/dismissed issues are never reopened.
It lives in `server/src/health/memory.ts`; `server/src/health/medical.test.ts`
is the guard.

**Health data never reaches localStorage.** The store's `partialize` allowlist
deliberately omits `health`/`healthIssues`/`healthRecords`, and `logout` clears
them. Adding them to the persisted set would leave medical data on a shared
device and compete with workout history for the same 5MB.

**The service worker is in `prompt` mode, not `autoUpdate`.** A new build
installs and then *waits*; `UpdatePrompt` offers "A new version is ready" and the
swap happens on a full reload when the user accepts. Do not switch this back to
`autoUpdate` — with code-split chunks plus `cleanupOutdatedCaches`, an
auto-activating worker deletes the hashed chunks the open tab still references,
so the next lazy-route navigation fails to load.

**The update banner defers to an active workout.** `useUpdateBannerVisible()` is
the single source of truth for whether it's on screen; `InstallPrompt` and the
dock-less full-height pages (login, reset, onboarding) both read it so they can
yield the slot or reserve space. Any new bottom-anchored banner should too.

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
duplicate), `health_issue_events` (check-ins/measurements), `health_records`
(medical history) and `health_rules` (the do & don't list, also unique on
`(user_id, key)` for the same update-don't-duplicate reason).
