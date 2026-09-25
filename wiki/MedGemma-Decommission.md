# Removing MedGemma (decommission runbook)

> **Status (2026-09-24): done for `azwertyweb`.** Steps 1 and 3–9 were carried
> out, and Vertex AI was retired at the same time: `fitnofat-sa`, its
> `roles/aiplatform.user` grant and both of its keys are deleted, and the
> medical desk is Gemini-only (see the last section). Kept as the record of
> what was removed and how to undo it.

How to take the self-hosted MedGemma model out of Fitnofat completely: stop the
app calling it, delete everything it left in Google Cloud, revoke the credentials
it needed, and prove nothing is still billing.

The code side is already done: the `cloudrun` provider, `/api/health/warm`, the
`medgemma/` build files and the deployment runbook were removed, and the medical
desk now reasons on Gemini over a **brief** built on the server (see
"Medical & health" in the README). This page is the infrastructure side.

**Why the order matters.** Work from the app outwards. If you delete the Cloud Run
service while Render still points at it, every health question first fails
against a service that no longer exists and only then falls back. It works, but
slowly, and the logs fill with errors. Cut the app over first, then delete.

```
1. Render env      ─► the app stops calling MedGemma            (instant, reversible)
2. Deploy code     ─► the app can no longer call it              (reversible: git revert)
3. Cloud Run       ─► no GPU can ever start again                (reversible while the image exists)
4. Image + repo    ─► the ~26 GB image is gone                   ◄── point of no return
5. Secret + HF     ─► the Hugging Face token is dead
6. Build leftovers ─► source uploads removed
7. Credentials     ─► the invoker grant and spare SA key are gone
8. APIs            ─► services only MedGemma used are switched off
9. Local           ─► nothing left on your machine
10. Verify         ─► inventory is empty, the bill shows no Cloud Run GPU
```

---

## What exists (inventory as of 2026-09-24)

| Resource | Name | Cost while it exists |
|---|---|---|
| Cloud Run service | `medgemma`, region `us-east4`, L4 GPU, 8 CPU / 32 GiB, min 0 / max 1 | $0 idle; ~$0.67/h per instance while awake. Anyone holding `run.invoker` can wake it |
| Invoker grant | `fitnofat-sa` → `roles/run.invoker` on `medgemma` | — |
| Artifact Registry repo | `fitnofat` (Docker, `us-east4`), image `medgemma:1.5-4b-it`, **~25.9 GB** | **~$2.50/month**, the one cost that never stops by itself |
| Secret Manager | `hf-token`, readable by the Compute and Cloud Build service accounts | pennies |
| Cloud Build | 2 builds (2026-09-22), source uploads in `gs://azwertyweb_cloudbuild/source/` | pennies |
| Service account | `fitnofat-sa`, holds `roles/aiplatform.user`, 2 user-managed keys | — |
| APIs enabled for this | `run`, `artifactregistry`, `cloudbuild`, `secretmanager` | — |
| Outside GCP | Hugging Face read token, licence acceptance on `google/medgemma-1.5-4b-it`, maybe a Colab notebook | — |
| Render (`fitnofat-api`) | `MEDICAL_AI_PROVIDER`, `MEDICAL_AI_BASE_URL`, `MEDICAL_AI_SELF_HOSTED_MODEL`, maybe `MEDICAL_AI_API_KEY`, `MEDICAL_AI_WARM_PROBE_MS`, `MEDICAL_AI_TIMEOUT_MS=180000` | — |

`fitnofat-sa` also holds `roles/aiplatform.user`, the Vertex AI path. What to do
with it depends on the decision in the last section. In the event, it was deleted.

---

## Before you start

Run everything **on your own machine**, in a terminal where `gcloud` is signed in
to project `azwertyweb`. Commands are given for PowerShell first and bash second.
They are the same commands, only the variable syntax differs.

```powershell
gcloud config list          # account = you, project = azwertyweb
$PROJECT = "azwertyweb"
$REGION  = "us-east4"
$SA      = "fitnofat-sa@azwertyweb.iam.gserviceaccount.com"
```

```bash
gcloud config list
export PROJECT=azwertyweb REGION=us-east4 SA=fitnofat-sa@azwertyweb.iam.gserviceaccount.com
```

Variables don't survive a new terminal. If a `gcloud` command prints a numbered
list of regions and waits, `$REGION` is empty. Set it again.

---

## Step 0 — Inventory (read-only, safe to run any time)

Nothing here changes anything. Run it now, then again at the end as the proof.

```powershell
gcloud run services list
gcloud artifacts repositories list
gcloud artifacts docker images list "$REGION-docker.pkg.dev/$PROJECT/fitnofat" --include-tags
gcloud secrets list
gcloud storage ls "gs://${PROJECT}_cloudbuild/source/"
gcloud iam service-accounts keys list --iam-account=$SA --managed-by=user
gcloud services list --enabled --format="value(config.name)"
```

Before step 4, check that the `fitnofat` repository holds nothing but
`medgemma`. If you ever pushed anything else there, delete the image in step 4
rather than the whole repository.

---

## Step 1 — Stop the app calling MedGemma (Render)

Render → **fitnofat-api** → **Environment**:

| Variable | Action |
|---|---|
| `MEDICAL_AI_BASE_URL` | **Delete.** This is the switch: with it gone, even the old code stops choosing MedGemma |
| `MEDICAL_AI_SELF_HOSTED_MODEL` | Delete |
| `MEDICAL_AI_API_KEY` | Delete if present |
| `MEDICAL_AI_WARM_PROBE_MS` | Delete if present |
| `MEDICAL_AI_PROVIDER` | Set to `auto` (or delete; `auto` is the default). If it says `cloudrun`, the old code would report the desk "unavailable" |
| `MEDICAL_AI_TIMEOUT_MS` | Delete, or set `90000`. 180 s only existed to wait out a GPU cold start |
| `VERTEX_SERVICE_ACCOUNT_JSON` | Keep only if you stay on Vertex; see the end of this page |

Save. Render redeploys with the new environment.

**Check:** open the app → **Medical** tab. The model line should no longer say
`medgemma-1.5-4b-it (self-hosted)`; it should name a Gemini model. Ask the health
desk one question and confirm the answer's footer says the same.

*Undo:* put the variables back.

---

## Step 2 — Deploy the code that removes it

Merge the branch that removes MedGemma (the one that adds this page) into `main`.
Render auto-deploys `fitnofat-api`, and the web app picks up the build too.

**Check:** the Render deploy log's startup lines include

```
Medical desk: gemini-2.5-pro (Gemini) · timeout 90000ms
```

If a line starts `[config] No longer used`, it names MedGemma/Vertex variables
still set on Render. They are ignored, but delete them.

`curl -s -X POST https://<your-api>/api/health/warm` should now return 404: the
warm-up route is gone.

*Undo:* `git revert` the merge commit.

---

## Step 3 — Delete the Cloud Run service

This is the step that makes a GPU impossible to start. It also removes the
`run.invoker` grant, because IAM bindings on a service are deleted with it.

```powershell
gcloud run services delete medgemma --region=$REGION
```

It asks `Do you want to continue (Y/n)?`. Answer `Y`. It takes about 30 seconds.

**Check:**

```powershell
gcloud run services list        # → Listed 0 items.
```

*Undo (only until step 4):* the image still exists, so
`gcloud run deploy medgemma --image=$REGION-docker.pkg.dev/$PROJECT/fitnofat/medgemma:1.5-4b-it ...`
with the original flags brings it back. Get the old runbook with
`git show <commit-before-removal>:wiki/MedGemma-Cloud-Run-Deployment.md`.

---

## Step 4 — Delete the image and the repository  ◄ point of no return

This stops the only charge that never stops by itself (~26 GB of storage).
After this, bringing MedGemma back means rebuilding the image, about 30–45
minutes of Cloud Build plus a new Hugging Face token.

If step 0 showed **only** `medgemma` in `fitnofat`, delete the whole repository:

```powershell
gcloud artifacts repositories delete fitnofat --location=$REGION
```

If anything else lives there, delete just the image and keep the repository:

```powershell
gcloud artifacts docker images delete "$REGION-docker.pkg.dev/$PROJECT/fitnofat/medgemma" --delete-tags
```

Both ask for confirmation. Deleting a 26 GB repository can take a few minutes.

**Check:**

```powershell
gcloud artifacts repositories list      # fitnofat gone (or empty)
```

---

## Step 5 — Delete the secret, then revoke the token at Hugging Face

The secret's IAM bindings (the Compute and Cloud Build service accounts'
`secretAccessor`) are deleted with it.

```powershell
gcloud secrets delete hf-token
```

Then, **yourself**, in a browser: <https://huggingface.co/settings/tokens> → find
the read token you created for MedGemma → **Delete**. Deleting the secret only
removes Google's copy. The token itself stays valid until Hugging Face revokes
it.

Optional: the licence you accepted on `google/medgemma-1.5-4b-it` grants access
and costs nothing, so there's no need to act on it. If you tested in Colab (the
old runbook's step 0), delete that notebook from Google Drive → *Colab
Notebooks*.

**Check:** `gcloud secrets list` no longer shows `hf-token`.

---

## Step 6 — Clean up Cloud Build leftovers

`gcloud builds submit` uploaded the `medgemma/` folder as a tarball for each
build. They are small, but they are MedGemma's.

```powershell
gcloud storage rm "gs://${PROJECT}_cloudbuild/source/**"
```

If nothing else in the project uses Cloud Build (true as of this inventory), you
can remove the whole bucket. Cloud Build recreates it the next time it's needed:

```powershell
gcloud storage rm --recursive "gs://${PROJECT}_cloudbuild"
```

Build history (the list in `gcloud builds list`) can't be deleted and costs
nothing. It ages out on its own.

---

## Step 7 — Credentials

**The invoker grant** went away with the service in step 3. Confirm nothing
else grants `run.invoker` at project level:

```powershell
gcloud projects get-iam-policy $PROJECT --flatten="bindings[].members" --filter="bindings.role:roles/run.invoker" --format="value(bindings.members)"
```

An empty result is what you want.

**The spare key.** `fitnofat-sa` has two user-managed keys. The old runbook's
step 6 suggested minting a second one ("Lost the key file? Mint another"), so
one of them is probably a MedGemma-era duplicate. **Only one key should remain:
the one in Render's `VERTEX_SERVICE_ACCOUNT_JSON`.** Find out which one that
is. Decode the value if it's base64, open the JSON, and read `private_key_id`.
Then delete the **other** one:

```powershell
gcloud iam service-accounts keys list --iam-account=$SA --managed-by=user
gcloud iam service-accounts keys delete <THE_OTHER_KEY_ID> --iam-account=$SA
```

Deleting the key that Render uses breaks Vertex auth. The app then falls back to
Gemini, which works but not as intended. So check `private_key_id` first. If you
still have a downloaded `fitnofat-sa*.json` anywhere on disk (Downloads, the
project folder), delete that file too: it is a full credential.

**Leave `fitnofat-sa` and its `roles/aiplatform.user` role alone** if you stay
on Vertex. If you go Gemini-only, the whole account goes instead (last section).

---

## Step 8 — Switch off the APIs only MedGemma used

As of the inventory, nothing else in `azwertyweb` uses these four. Check
first, because disabling an API that something else relies on breaks it:

```powershell
gcloud run services list                # must be empty
gcloud run jobs list                    # must be empty
gcloud artifacts repositories list      # must be empty (or you kept the repo on purpose)
gcloud secrets list                     # must be empty
```

Then:

```powershell
gcloud services disable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com
```

If gcloud refuses because another service depends on one of them, it names the
dependent. Read it, and leave that one on unless you are sure. **Do not**
disable `youtube.googleapis.com` (exercise demo videos) or anything `storage*`.

This step is optional: an enabled API with nothing in it costs nothing. Its only
benefit is that nobody can recreate a GPU service here by accident.

---

## Step 9 — Local cleanup

```powershell
gcloud config unset run/region          # was pinned to us-east4 for the old runbook
docker images | Select-String -Pattern "medgemma|vllm"
```

If `docker images` lists anything (only if you ever built locally), remove it
with `docker rmi <image>`. Then `docker system prune` reclaims the layers, which
are 15 GB or more.

Your repo checkout no longer has `medgemma/` once you pull the merged branch.

---

## Step 10 — Verify

Re-run step 0. You should see:

```
gcloud run services list                      → Listed 0 items.
gcloud artifacts repositories list            → no fitnofat (or empty)
gcloud secrets list                           → Listed 0 items.
gcloud iam service-accounts keys list ...     → exactly one user-managed key
```

Then **24–48 hours later** (billing data lags): Cloud Console → **Billing →
Reports** → filter *Service = Cloud Run* and *Artifact Registry*. Both should
read $0 from today onwards. Keep the budget alert you set for MedGemma, or lower
it. It's still the cheapest early warning for anything in the project.

---

## Stopping partway

Every step is safe to stop after, and the app is healthy at each point once
steps 1–2 are done. Where you can stop, and what stays behind:

| Stopped after | App | Leftover cost / risk |
|---|---|---|
| Step 1 | Gemini/Vertex, old code | GPU service still exists and can be woken by `fitnofat-sa`; ~$2.50/mo storage |
| Step 2 | Gemini/Vertex, new code | Same as above |
| Step 3 | ✓ | ~$2.50/mo storage only |
| Step 4 | ✓ | None worth mentioning. A live Hugging Face token remains, so finish step 5 |
| Step 5+ | ✓ | None |

To bring MedGemma back later, all the source is in git history:
`git log --all -- medgemma/Dockerfile` finds it. Restore the `medgemma/` folder,
the runbook and the `cloudrun` provider with a revert of the removal commit.

---

## After: Vertex or Gemini? (decided: Gemini)

The inventory showed `fitnofat-sa` holding `roles/aiplatform.user` while
`aiplatform.googleapis.com` was **not enabled**, so every medical question tried
Vertex, was refused, and only then answered on Gemini. The decision was
**Gemini only**, and Vertex was removed from the code as well as the project.

What was run:

```powershell
$SA = "fitnofat-sa@azwertyweb.iam.gserviceaccount.com"
gcloud projects remove-iam-policy-binding azwertyweb --member="serviceAccount:$SA" --role="roles/aiplatform.user" --condition=None
gcloud iam service-accounts keys list --iam-account=$SA --managed-by=user
gcloud iam service-accounts keys delete <KEY_ID> --iam-account=$SA     # each key
gcloud iam service-accounts delete $SA
```

Deleting the keys first makes the credential in Render's
`VERTEX_SERVICE_ACCOUNT_JSON` dead everywhere at once. A deleted service account
can be restored for 30 days (`gcloud iam service-accounts undelete <UNIQUE_ID>`),
but its keys cannot.

Then, on Render → **fitnofat-api** → **Environment**, delete
`VERTEX_SERVICE_ACCOUNT_JSON`, `VERTEX_PROJECT_ID`, `VERTEX_LOCATION`,
`MEDICAL_AI_PROVIDER` and `MEDICAL_AI_MODEL`. The server ignores them now, and
names any it still finds in a startup warning (`[config] No longer used …`).

**The Gemini key must be on a paid tier.** Google's terms for the **unpaid**
Gemini API tier allow prompts to be used to improve its products. That is a
poor fit for a medical brief, however minimised. In Google AI Studio → *API
keys*, check that the project behind `GEMINI_API_KEY` has billing enabled.
