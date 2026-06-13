#!/usr/bin/env bash
# Build, push, and roll out Hustronix to Azure Container Apps.
#
# Idempotent: re-running picks up new image tags and updates the running app.
# Designed to spend Azure credits efficiently — see infra/azure/README.md.
#
# Required env (or args):
#   ACR_NAME                 — e.g. "hustronixprod"  (without .azurecr.io)
#   RESOURCE_GROUP           — e.g. "hustronix-prod"
#   IMAGE_TAG                — e.g. "1.0.0" or git SHA. Defaults to UTC date.
#   PARAMETERS_FILE          — path to containerapp.parameters.json (defaults below)
#
# Usage:
#   ACR_NAME=hustronixprod RESOURCE_GROUP=hustronix-prod ./infra/azure/deploy.sh

set -euo pipefail

ACR_NAME="${ACR_NAME:?ACR_NAME is required}"
RESOURCE_GROUP="${RESOURCE_GROUP:?RESOURCE_GROUP is required}"
IMAGE_TAG="${IMAGE_TAG:-$(date -u +%Y%m%d-%H%M%S)}"
PARAMETERS_FILE="${PARAMETERS_FILE:-infra/azure/containerapp.parameters.json}"
IMAGE_NAME="hustronix"
IMAGE_URI="${ACR_NAME}.azurecr.io/${IMAGE_NAME}:${IMAGE_TAG}"

echo "🔧 Hustronix → Azure Container Apps deploy"
echo "   ACR:           ${ACR_NAME}.azurecr.io"
echo "   Resource group: ${RESOURCE_GROUP}"
echo "   Image:          ${IMAGE_URI}"
echo "   Parameters:     ${PARAMETERS_FILE}"

# --- 1. Authenticate ACR. Uses the current `az login` context.
echo "🔑 Logging in to ACR…"
az acr login --name "${ACR_NAME}"

# --- 2. Build & push the multi-stage image using ACR Tasks (no local Docker daemon needed).
#     Runs the build inside Azure, which is faster and uses zero local egress.
echo "📦 Building image in ACR (Linux/amd64)…"
az acr build \
  --registry "${ACR_NAME}" \
  --image "${IMAGE_NAME}:${IMAGE_TAG}" \
  --file infra/docker/Dockerfile \
  --platform linux/amd64 \
  .

# --- 3. Apply the Bicep template. Updates only the image tag on subsequent runs.
echo "🚀 Deploying Container App revision…"
az deployment group create \
  --resource-group "${RESOURCE_GROUP}" \
  --template-file infra/azure/containerapp.bicep \
  --parameters "@${PARAMETERS_FILE}" \
  --parameters image="${IMAGE_URI}" \
  --query "properties.outputs.appFqdn.value" \
  --output tsv

echo "✅ Deploy complete."
echo "   Tail logs:  az containerapp logs show -g ${RESOURCE_GROUP} -n hustronix-app --follow --tail 100"
echo "   Open URL:   https://<fqdn>/api/health"
