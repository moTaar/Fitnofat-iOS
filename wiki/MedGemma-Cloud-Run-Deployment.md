# Deploying MedGemma on Cloud Run (the medical desk)

How to replace the general-purpose model behind `/api/health/*` with
[MedGemma](https://developers.google.com/health-ai-developer-foundations/medgemma/model-card) —
Google's open-weights medical model — hosted on Cloud Run with a GPU, and point
the app at it.

**What you end up with**

```
PWA ──► fitnofat-api (Render) ──► Cloud Run: vLLM + MedGemma (L4 GPU, scales to zero)
                │                         ▲
                │  Google-signed ID token │  private service, invoker = fitnofat-sa
                └─────────────────────────┘
```

The weights and the inference both sit in your own GCP project. Nothing about
the medical record reaches a shared API endpoint.

**What it costs.** An L4 on Cloud Run is ~$0.67/hour, billed *per second*, and
scales to zero between requests. At ~30 min of real inference a day that is
roughly **$10–15/month**. The number that would hurt is `--min-instances 1`
(~$480/month) — step 3 deliberately does not set it.

---

## Before you start

You need:

- `gcloud` installed and logged in (`gcloud auth login`), project `azwertyweb`
- Docker, to build the image
- A Hugging Face account, for the MedGemma weights
- The `fitnofat-sa` service-account key JSON you already created

Enable the APIs (note that Vertex AI is listed as "Gemini Enterprise Agent
Platform" since April 2026 — the service name is unchanged):

```bash
gcloud config set project azwertyweb

gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com
```

Pick a region that actually has L4 GPUs. As of 2026 that is `europe-west1`,
`europe-west4`, `us-central1`, `us-east4`, `asia-southeast1`, `asia-south1`.
The rest of this doc uses `europe-west1` — closest to EU users, and it keeps the
health data in the EU.

```bash
export REGION=europe-west1
export PROJECT=azwertyweb
export SA=fitnofat-sa@azwertyweb.iam.gserviceaccount.com
```

---

## Which variant

**`google/medgemma-1.5-4b-it`** — multimodal, 128K context, and the one this doc
deploys.

The family has four members. Only one of them is a sensible fit here:

| Variant | Fits an L4 (24 GB)? | Reads images? | Verdict |
|---|---|---|---|
| **`medgemma-1.5-4b-it`** | Yes — ~8 GB bf16, plenty left for KV cache | Yes | **Use this** |
| `medgemma-4b-it` | Yes | Yes | Superseded by 1.5 |
| `medgemma-27b-text-it` | No — ~54 GB bf16 | **No** | Breaks photo attachments |
| `medgemma-27b-it` | No — ~54 GB bf16 | Yes | Needs a bigger, pricier GPU |

Three reasons the 1.5 4B is the right call for *this* app specifically, beyond
being the newest:

- **Lab-report extraction.** It turns a lab report into structured JSON at 91.0
  macro-F1 — which is exactly the `[RECORD]` path in `server/src/medical.ts`,
  where a photo of a blood panel becomes a `health_records` row.
- **Longitudinal EHR reasoning** (89.6% on EHRQA). `POST /api/health/review`
  reasons over the whole record across time — tracked issues, their check-in
  history, past records — which is the task 1.5 was specifically improved on.
- **Multimodal.** The health desk accepts photos. The 27B *text* variant would
  silently break that, and it's the variant people reach for first because it's
  the biggest number.

Don't chase the 27B. At bf16 it needs ~54 GB, so an L4 can't hold it: you'd be
into 4-bit quantization (~15 GB, tight, with quality loss) or an L40S/A100 at
several times the hourly rate. For a personal health desk, a 4B that fits
comfortably and cold-starts in under a minute beats a 27B that is quantized,
slow to load, and expensive to keep available.

Suffixes: `-it` is instruction-tuned (what you want for chat); `-pt` is the
pretrained base and will not follow the system prompt.

---

## Step 0 — Decide whether MedGemma is worth hosting (30 min, ~$0)

Do this before you pay for anything. Open a
[Colab](https://colab.research.google.com) notebook with a T4 and run:

```python
!pip install -q transformers accelerate
from huggingface_hub import login; login()          # accept the MedGemma licence first

from transformers import pipeline
import torch
pipe = pipeline("image-text-to-text", model="google/medgemma-1.5-4b-it",
                torch_dtype=torch.bfloat16, device="cuda")

msgs = [{"role": "user", "content": [{"type": "text", "text":
  "A 34-year-old with hypothyroidism on levothyroxine 50µg trains 4x/week. "
  "Ferritin 18 ng/mL, haemoglobin normal. What is worth investigating, and what "
  "should they bring to their clinician?"}]}]
print(pipe(text=msgs, max_new_tokens=400)[0]["generated_text"][-1]["content"])
```

Run ten prompts that look like your real traffic — a nutrition question, a
symptom description, a lab result, a medication interaction. Compare the answers
to what the current desk gives you.

If MedGemma 4B isn't clearly better for *your* questions, stop here: the honest
outcome is that hosting isn't worth $10/month plus the ops. The 27B text variant
is stronger but won't fit comfortably on an L4, which changes the cost picture
entirely.

---

## Step 1 — Get the weights

1. Sign in to Hugging Face, open
   [`google/medgemma-1.5-4b-it`](https://huggingface.co/google/medgemma-1.5-4b-it) and
   accept the Health AI Developer Foundations terms. Downloads 403 until you do.
2. Create a **read** token at Settings → Access Tokens.
3. Put it in Secret Manager rather than in the Dockerfile:

```bash
gcloud services enable secretmanager.googleapis.com
printf 'hf_xxxxxxxxxxxxxxxxx' | gcloud secrets create hf-token --data-file=-
```

---

## Step 2 — Build the container

The weights are **baked into the image**. The alternative — downloading ~8 GB
from Hugging Face on every cold start — turns a 40-second start into a
multi-minute one and makes your health desk depend on hf.co being up.

`medgemma/Dockerfile`:

```dockerfile
FROM vllm/vllm-openai:v0.11.0

ENV HF_HOME=/model-cache

# Bake the weights in at build time. The secret is mounted for this layer only
# and never lands in the image.
RUN --mount=type=secret,id=HF_TOKEN \
    HF_TOKEN=$(cat /run/secrets/HF_TOKEN) \
    huggingface-cli download google/medgemma-1.5-4b-it

ENV HF_HUB_OFFLINE=1

# Cloud Run injects $PORT; shell form so it expands.
ENTRYPOINT python3 -m vllm.entrypoints.openai.api_server \
  --model google/medgemma-1.5-4b-it \
  --served-model-name medgemma-1.5-4b-it \
  --host 0.0.0.0 --port ${PORT:-8080} \
  --max-model-len 8192 \
  --gpu-memory-utilization 0.90
```

`--served-model-name` is what the app sends in the request body — pin it so the
value is stable and short.

Build and push:

```bash
gcloud artifacts repositories create fitnofat \
  --repository-format=docker --location=$REGION

gcloud auth configure-docker $REGION-docker.pkg.dev

export IMAGE=$REGION-docker.pkg.dev/$PROJECT/fitnofat/medgemma:1.5-4b-it

docker build --secret id=HF_TOKEN,env=HF_TOKEN -t $IMAGE medgemma/
docker push $IMAGE
```

(Export `HF_TOKEN` in your shell for the build. The image will be ~15 GB — the
push is the slow part, once.)

---

## Step 3 — Deploy

```bash
gcloud run deploy medgemma \
  --image=$IMAGE \
  --region=$REGION \
  --gpu=1 --gpu-type=nvidia-l4 --no-gpu-zonal-redundancy \
  --cpu=8 --memory=32Gi \
  --min-instances=0 --max-instances=1 \
  --concurrency=4 \
  --timeout=600 \
  --no-allow-unauthenticated \
  --no-cpu-throttling \
  --service-account=$SA
```

Why each flag matters:

| Flag | Why |
|---|---|
| `--no-gpu-zonal-redundancy` | ~$0.67/hr instead of ~$1.05/hr. You are not running a hospital; a zone outage means retry. |
| `--min-instances=0` | The whole point. Idle costs nothing. |
| `--max-instances=1` | A runaway loop can't spawn ten GPUs. Raise it only when you measure a need. |
| `--concurrency=4` | vLLM batches; one request at a time wastes the GPU, and too many blow up latency. |
| `--timeout=600` | Cold start + a long medical answer can exceed the 300s default. |
| `--no-allow-unauthenticated` | **Do not skip.** An open LLM endpoint is someone else's free GPU. |
| `--no-cpu-throttling` | Keeps the model resident between requests inside an instance's life. |

L4 quota for a first-time region is granted automatically (3 GPUs). If the
deploy fails on quota, request it in IAM → Quotas.

---

## Step 4 — Lock it to your backend

The service is private; grant exactly one caller:

```bash
gcloud run services add-iam-policy-binding medgemma \
  --region=$REGION \
  --member="serviceAccount:$SA" \
  --role="roles/run.invoker"

export MEDGEMMA_URL=$(gcloud run services describe medgemma \
  --region=$REGION --format='value(status.url)')
echo $MEDGEMMA_URL
```

`fitnofat-sa` now needs **two** roles: `roles/run.invoker` (here) and, if you
also use the Vertex path, `roles/aiplatform.user`.

---

## Step 5 — Prove it works before touching the app

```bash
# Authenticated proxy on localhost — no token juggling.
gcloud run services proxy medgemma --region=$REGION --port=8080 &

curl -s localhost:8080/v1/models | jq .

curl -s localhost:8080/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"medgemma-1.5-4b-it","messages":[
        {"role":"user","content":"In one sentence: what does a ferritin of 18 ng/mL suggest in a menstruating endurance athlete?"}],
      "max_tokens":150}' | jq -r '.choices[0].message.content'
```

The first call pays the cold start — expect **40–90 seconds**. The second should
be a few seconds. If you don't see that pattern, fix it here, not later.

---

## Step 6 — Point the app at it

On the `fitnofat-api` service (Render → Environment):

```bash
MEDICAL_AI_PROVIDER=cloudrun
MEDICAL_AI_BASE_URL=https://medgemma-xxxxxxxx.europe-west1.run.app/v1   # note the /v1
MEDICAL_AI_SELF_HOSTED_MODEL=medgemma-1.5-4b-it
VERTEX_SERVICE_ACCOUNT_JSON=<the fitnofat-sa key JSON>                   # already set
```

`VERTEX_SERVICE_ACCOUNT_JSON` is doing double duty: `server/src/vertex.ts` uses
the same key to mint the **ID token** that Cloud Run checks (audience = the
service URL, no `/v1`). No extra credential, nothing new to rotate.

Leave `GEMINI_API_KEY` set. If the Cloud Run service is down, the desk falls
back rather than failing the request — and says so, because every reply carries
the model that answered. `medgemma-1.5-4b-it (self-hosted)` in the chat footer means
you got what you paid for; `(Gemini)` means you didn't.

To force the self-hosted model and never fall back, keep
`MEDICAL_AI_PROVIDER=cloudrun` — with it set explicitly, an unconfigured base URL
reports "unavailable" instead of silently downgrading.

Redeploy the API service, then check:

```bash
curl -s https://<your-api>.onrender.com/health
```

---

## Step 7 — Verify end to end

1. Open the app → **Medical** tab. The header should read
   `medgemma-1.5-4b-it (self-hosted)`.
2. Health desk in the coach chat → ask a nutrition question. First message after
   an idle period will be slow (cold start); the next ones fast.
3. Tap **Review** on the Medical tab and confirm the worklist regenerates.
4. `gcloud run services logs read medgemma --region=$REGION --limit=50` should
   show the requests.

---

## The cold-start gotcha

`AI_REQUEST_TIMEOUT_MS` in `web/src/lib/api.ts` is **60 s**, while
`MEDICAL_AI_TIMEOUT_MS` on the server defaults to 90 s. A 70-second cold start
therefore fails in the browser while the server call is still healthy — the user
sees an error on a request that was fine.

Three options, cheapest first:

1. **Raise the client timeout** for health routes (edit that constant, or give
   `medicalChat`/`reviewHealth` their own). Costs nothing.
2. **Warn instead of hanging** — the chat already shows a typing bubble; a "first
   answer of the day takes a minute" note sets the expectation honestly.
3. **`--min-instances=1`** — kills cold starts and the ~$10/month price tag
   along with them. Only if this becomes a product, not a personal app.

Do not paper over it with a Cloud Scheduler ping every few minutes: each ping
restarts the idle timer, so you pay nearly the full 24/7 rate for the privilege.

---

## Keeping the bill honest

```bash
# What's actually deployed and scaled to
gcloud run services describe medgemma --region=$REGION \
  --format='value(status.traffic,spec.template.spec.containers[0].resources)'
```

Set a budget alert (Billing → Budgets & alerts) at ~$30/month. The failure mode
worth catching is an accidental `--min-instances=1` or `--max-instances=10`, and
a budget alert finds it in a day rather than on the invoice.

To stop paying entirely without losing the setup:

```bash
gcloud run services update medgemma --region=$REGION --max-instances=0   # off
gcloud run services delete medgemma --region=$REGION                     # gone
```

Then unset `MEDICAL_AI_BASE_URL` on Render (or set
`MEDICAL_AI_PROVIDER=gemini`), and the desk goes back to the hosted model.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Chat footer says `(Gemini)` | Self-hosted call failed, fallback fired | `gcloud run services logs read medgemma`; check `MEDICAL_AI_BASE_URL` ends in `/v1` |
| 403 from Cloud Run | `fitnofat-sa` lacks invoker, or the ID-token audience is wrong | Step 4; audience must be the service URL **without** `/v1` — `vertex.ts` strips it, so don't add a path |
| 401 `Invalid token` | Clock skew, or the wrong service-account key | Verify the key in `VERTEX_SERVICE_ACCOUNT_JSON` is `fitnofat-sa`'s |
| Request fails at ~60 s in the browser, server log looks fine | Client timeout during cold start | See the cold-start section |
| Deploy fails: GPU quota | First L4 in a new region | IAM → Quotas → request Cloud Run L4 |
| vLLM OOM at startup | `--max-model-len` too high for 24 GB | Lower to 4096, or drop `--gpu-memory-utilization` to 0.85 |
| Model 404 from vLLM | Request's `model` ≠ `--served-model-name` | Match `MEDICAL_AI_SELF_HOSTED_MODEL` to it |

---

## What this does not give you

MedGemma is **not clinical-grade** — Google says so plainly, and it is not
cleared as a medical device. Hosting it yourself changes where the inference
runs, not what the output is worth. The parts of this app that make the health
desk defensible are still the code around it: the red-flag screen in
`detectRedFlags`, the no-diagnosis/no-prescribing prompt rules, the consent gate,
and the model attribution on every reply. Those hold whichever model is behind
them, and they're the reason a model swap is a config change rather than a
rewrite.
