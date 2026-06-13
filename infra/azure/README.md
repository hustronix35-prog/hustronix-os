# Azure Container Apps deployment

Deploys the Hustronix unified server (Express API + WebSocket + Next.js UI) to
**Azure Container Apps** behind a managed TLS hostname (`app.hustronix.online`)
with secrets stored in **Azure Key Vault**.

Files in this folder:

| File | Purpose |
| --- | --- |
| `containerapp.bicep` | Declarative Container App definition (image, env, secrets, ingress, volume, probes). |
| `containerapp.parameters.json` | Per-environment overrides (subscription ids, ACR URL, Key Vault secret URIs). |
| `deploy.sh` | One-command build (via ACR Tasks) + roll out. |

---

## 1. One-time bootstrap (do this once per environment)

These resources outlive any single deploy. Create them in the Azure CLI or
Portal; the names are referenced from `containerapp.parameters.json`.

```bash
# 0. Variables (edit these once, then paste the rest)
SUB="<subscription-id>"
RG="hustronix-prod"
LOC="eastus"
ACR="hustronixprod"        # globally unique, lowercase
ENV="hustronix-env"
KV="hustronix-vault"        # globally unique
STORAGE="hustronixstg"      # globally unique, lowercase 3-24 chars
FILESHARE="hustronix-files"
UAMI="hustronix-uami"

az account set --subscription "$SUB"
az group create -n "$RG" -l "$LOC"

# 1. Container Apps environment + Log Analytics (Container Apps requires it)
az monitor log-analytics workspace create -g "$RG" -n hustronix-logs -l "$LOC"
WORKSPACE_ID=$(az monitor log-analytics workspace show -g "$RG" -n hustronix-logs --query customerId -o tsv)
WORKSPACE_KEY=$(az monitor log-analytics workspace get-shared-keys -g "$RG" -n hustronix-logs --query primarySharedKey -o tsv)
az containerapp env create -g "$RG" -n "$ENV" -l "$LOC" \
  --logs-workspace-id "$WORKSPACE_ID" --logs-workspace-key "$WORKSPACE_KEY"

# 2. Azure Container Registry (Basic tier is plenty)
az acr create -g "$RG" -n "$ACR" --sku Basic --admin-enabled false

# 3. Azure Files share for SQLite persistence
az storage account create -g "$RG" -n "$STORAGE" -l "$LOC" --sku Standard_LRS
STG_KEY=$(az storage account keys list -g "$RG" -n "$STORAGE" --query "[0].value" -o tsv)
az storage share-rm create -g "$RG" --storage-account "$STORAGE" -n "$FILESHARE" --quota 20

# Bind the share to the Container Apps env (named "$FILESHARE" so Bicep can mount it)
az containerapp env storage set -g "$RG" -n "$ENV" \
  --storage-name "$FILESHARE" \
  --azure-file-account-name "$STORAGE" \
  --azure-file-account-key "$STG_KEY" \
  --azure-file-share-name "$FILESHARE" \
  --access-mode ReadWrite

# 4. User-assigned managed identity (the Container App uses this to read Key Vault)
az identity create -g "$RG" -n "$UAMI"
UAMI_ID=$(az identity show -g "$RG" -n "$UAMI" --query id -o tsv)
UAMI_PRINCIPAL=$(az identity show -g "$RG" -n "$UAMI" --query principalId -o tsv)

# 5. Key Vault + access policy for the identity
az keyvault create -g "$RG" -n "$KV" -l "$LOC" --enable-rbac-authorization true
KV_ID=$(az keyvault show -g "$RG" -n "$KV" --query id -o tsv)
az role assignment create \
  --assignee-object-id "$UAMI_PRINCIPAL" --assignee-principal-type ServicePrincipal \
  --role "Key Vault Secrets User" --scope "$KV_ID"

# 6. Seed secrets (repeat for every var in the parameters file)
#    Generate cryptographic secrets first:
OAUTH_KEY=$(openssl rand -hex 32)
TOTP_KEY=$(openssl rand -hex 32)
MC_KEY=$(openssl rand -hex 32)

az keyvault secret set --vault-name "$KV" -n OAUTH-TOKEN-ENCRYPTION-KEY  --value "$OAUTH_KEY"
az keyvault secret set --vault-name "$KV" -n TOTP-ENCRYPTION-KEY         --value "$TOTP_KEY"
az keyvault secret set --vault-name "$KV" -n MISSION-CONTROL-API-KEY     --value "$MC_KEY"
# Anthropic + per-provider OAuth / webhook secrets — paste real values:
az keyvault secret set --vault-name "$KV" -n ANTHROPIC-API-KEY           --value "<paste>"
az keyvault secret set --vault-name "$KV" -n SLACK-CLIENT-ID             --value "<paste>"
# … repeat for SLACK-CLIENT-SECRET, SLACK-SIGNING-SECRET, GITHUB-*, GOOGLE-*,
#    MICROSOFT-*, NOTION-*, JIRA-*, LINEAR-*, SMTP-USER, SMTP-PASS.
```

Edit `containerapp.parameters.json` to point at the resources you just created:

- Replace `<subscription-id>` and `<rg>` everywhere.
- Replace `<acr-name>.azurecr.io/hustronix:latest` — `deploy.sh` overrides the tag, but the registry host must be correct.
- Replace `<env-name>` and `<uami-name>` with the values above.
- Set `sqliteVolumeStorageName` to `hustronix-files` (the storage binding name from step 3).
- Replace `<vault>` with the Key Vault name (step 5) in all `keyVaultSecretRefs` URIs.

## 2. Deploy

```bash
export ACR_NAME="$ACR"
export RESOURCE_GROUP="$RG"
chmod +x infra/azure/deploy.sh
./infra/azure/deploy.sh
```

`deploy.sh` will:

1. `az acr login` (uses your current Azure CLI session).
2. `az acr build` — multi-stage build runs **inside Azure**, no Docker required locally.
3. `az deployment group create` — applies the Bicep template with the new image tag.

Re-running picks up new image tags and rolls a new revision (single active revision mode).

## 3. Custom domain (`app.hustronix.online`)

After the first successful deploy the app gets a default FQDN like
`hustronix-app.<env-id>.azurecontainerapps.io`. To attach `app.hustronix.online`:

```bash
az containerapp hostname add  -g "$RG" -n hustronix-app --hostname app.hustronix.online
# Add the DNS records the command prints (asuid TXT + CNAME).
az containerapp hostname bind -g "$RG" -n hustronix-app --hostname app.hustronix.online \
  --environment "$ENV" --validation-method CNAME
```

Then update **APP_ORIGIN** and **ALLOWED_ORIGINS** in `containerapp.parameters.json`
(if you used placeholders) and redeploy so cookies and OAuth callbacks resolve to the
new hostname.

## 4. Operate

```bash
# Tail logs
az containerapp logs show -g "$RG" -n hustronix-app --follow --tail 100

# Health
curl https://app.hustronix.online/api/health

# Restart (rare — usually a no-op redeploy is preferred)
az containerapp revision restart -g "$RG" -n hustronix-app --revision <name>
```

## 5. Cost notes

Default settings (`minReplicas: 1`, `cpu: 1.0`, `memory: 2Gi`) cost roughly
**$60–100/month** at the time of writing, well inside the $10k Azure credit.
Scale to zero is intentionally **disabled** because:

- SQLite is single-writer and lives on Azure Files; bouncing replicas mid-write
  is safe but the renewal workers (Microsoft Graph 50-min, Notion poll 5-min)
  must be running to keep webhooks alive.
- Cold-start of a 700MB image is ~12s; first-byte latency on a sleeping app
  would frustrate users hitting `/mission-control` from a marketing click.

Once the Postgres cutover lands (see `infra/db/postgres/`), revisit:

- `minReplicas: 0` becomes possible (no sticky filesystem).
- Push the worker schedule into a separate Container App Job so HTTP replicas
  can scale to zero independently.

## 6. Mapping to env vars

The Bicep template owns the **non-secret** env vars (NODE_ENV, PORT, HOST,
UNIFIED_SERVER, SQLITE_PATH, REQUIRE_HTTPS, APP_ORIGIN, ALLOWED_ORIGINS,
WEBHOOK_PUBLIC_BASE_URL) and pulls **every** secret from Key Vault.

Want to add a new env var?

- **Non-secret** → edit the `env: [...]` array in `containerapp.bicep`.
- **Secret** → add a new `keyVaultSecretRefs.<key>` entry, a new entry to the
  `secretBindings` array, and an `env` row with `secretRef`. Update
  `containerapp.parameters.json` with the Key Vault URI.
