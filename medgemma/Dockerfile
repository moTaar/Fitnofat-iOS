# MedGemma served by vLLM, for Cloud Run with an L4 GPU.
# Deployment runbook: wiki/MedGemma-Cloud-Run-Deployment.md
#
# Build with Cloud Build (recommended) — see medgemma/cloudbuild.yaml — or
# locally with BuildKit, which the --mount=type=secret below requires:
#   DOCKER_BUILDKIT=1 docker build --secret id=HF_TOKEN,env=HF_TOKEN -t $IMAGE medgemma/

FROM vllm/vllm-openai:v0.11.0

ENV HF_HOME=/model-cache

# Bake the weights in at build time. Downloading ~8 GB on every cold start would
# turn a 40-second start into minutes and make the health desk depend on hf.co
# being reachable. The secret is mounted for this layer only and never lands in
# the image.
RUN --mount=type=secret,id=HF_TOKEN \
    HF_TOKEN=$(cat /run/secrets/HF_TOKEN) \
    huggingface-cli download google/medgemma-1.5-4b-it

# Nothing to fetch at runtime — fail loudly rather than reaching for the network.
ENV HF_HUB_OFFLINE=1

# Cloud Run injects $PORT; shell form so it expands.
# --served-model-name is what the app sends as `model` in the request body:
# it must match MEDICAL_AI_SELF_HOSTED_MODEL on the API service.
ENTRYPOINT python3 -m vllm.entrypoints.openai.api_server \
  --model google/medgemma-1.5-4b-it \
  --served-model-name medgemma-1.5-4b-it \
  --host 0.0.0.0 --port ${PORT:-8080} \
  --max-model-len 8192 \
  --gpu-memory-utilization 0.90
