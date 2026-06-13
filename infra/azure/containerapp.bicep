// Azure Container Apps deployment for Hustronix unified server.
//
// One container, one port, sticky volume for SQLite, all secrets pulled from
// Key Vault. The web origin and API live on the same hostname behind ACA's
// front-door TLS (Slack/GitHub/Microsoft/Google webhooks all hit
// `https://<custom-domain>/api/ingest/*`).
//
// Usage:
//   az deployment group create \
//     --resource-group hustronix-prod \
//     --template-file infra/azure/containerapp.bicep \
//     --parameters @infra/azure/containerapp.parameters.json
//
// Prereqs: a Container Apps Environment exists, an ACR exists, and a Key Vault
// holds the secret references named below. See infra/azure/README.md.

@description('Container App name (becomes the default FQDN prefix).')
param name string = 'hustronix-app'

@description('Region — must match the Container Apps Environment.')
param location string = resourceGroup().location

@description('Fully qualified container image, e.g. <acr>.azurecr.io/hustronix:1.0.0')
param image string

@description('Resource ID of the Container Apps Environment.')
param environmentId string

@description('Resource ID of an Azure File Share volume to persist SQLite/data.')
param sqliteVolumeStorageName string

@description('Min replicas — keep at 1 for sticky SQLite. Scale to 0 only after Postgres cutover.')
param minReplicas int = 1

@description('Max replicas — Container Apps scales WS connections per-instance.')
param maxReplicas int = 3

@description('CPU cores per replica.')
param cpu string = '1.0'

@description('Memory per replica.')
param memory string = '2Gi'

@description('Public origin used for OAuth callbacks (e.g. https://app.hustronix.online).')
param appOrigin string

@description('Comma-separated allowed origins for browser CORS (e.g. https://app.hustronix.online).')
param allowedOrigins string

@description('Secret references pulled from Key Vault via managed identity. Each value must be a Key Vault secretUri.')
param keyVaultSecretRefs object = {
  oauthEncryptionKey: ''
  anthropicApiKey: ''
  missionControlApiKey: ''
  totpEncryptionKey: ''
  slackClientId: ''
  slackClientSecret: ''
  slackSigningSecret: ''
  githubOauthClientId: ''
  githubOauthClientSecret: ''
  githubWebhookSecret: ''
  googleOauthClientId: ''
  googleOauthClientSecret: ''
  microsoftOauthClientId: ''
  microsoftOauthClientSecret: ''
  microsoftWebhookClientState: ''
  notionOauthClientId: ''
  notionOauthClientSecret: ''
  jiraOauthClientId: ''
  jiraOauthClientSecret: ''
  jiraWebhookSecret: ''
  linearOauthClientId: ''
  linearOauthClientSecret: ''
  linearWebhookSecret: ''
  smtpUser: ''
  smtpPass: ''
}

@description('User-assigned managed identity resource ID with Key Vault Secrets User role on every secret above.')
param managedIdentityResourceId string

var secretBindings = [
  { name: 'oauth-encryption-key', keyVaultUrl: keyVaultSecretRefs.oauthEncryptionKey, identity: managedIdentityResourceId }
  { name: 'anthropic-api-key', keyVaultUrl: keyVaultSecretRefs.anthropicApiKey, identity: managedIdentityResourceId }
  { name: 'mission-control-api-key', keyVaultUrl: keyVaultSecretRefs.missionControlApiKey, identity: managedIdentityResourceId }
  { name: 'totp-encryption-key', keyVaultUrl: keyVaultSecretRefs.totpEncryptionKey, identity: managedIdentityResourceId }
  { name: 'slack-client-id', keyVaultUrl: keyVaultSecretRefs.slackClientId, identity: managedIdentityResourceId }
  { name: 'slack-client-secret', keyVaultUrl: keyVaultSecretRefs.slackClientSecret, identity: managedIdentityResourceId }
  { name: 'slack-signing-secret', keyVaultUrl: keyVaultSecretRefs.slackSigningSecret, identity: managedIdentityResourceId }
  { name: 'github-oauth-client-id', keyVaultUrl: keyVaultSecretRefs.githubOauthClientId, identity: managedIdentityResourceId }
  { name: 'github-oauth-client-secret', keyVaultUrl: keyVaultSecretRefs.githubOauthClientSecret, identity: managedIdentityResourceId }
  { name: 'github-webhook-secret', keyVaultUrl: keyVaultSecretRefs.githubWebhookSecret, identity: managedIdentityResourceId }
  { name: 'google-oauth-client-id', keyVaultUrl: keyVaultSecretRefs.googleOauthClientId, identity: managedIdentityResourceId }
  { name: 'google-oauth-client-secret', keyVaultUrl: keyVaultSecretRefs.googleOauthClientSecret, identity: managedIdentityResourceId }
  { name: 'microsoft-oauth-client-id', keyVaultUrl: keyVaultSecretRefs.microsoftOauthClientId, identity: managedIdentityResourceId }
  { name: 'microsoft-oauth-client-secret', keyVaultUrl: keyVaultSecretRefs.microsoftOauthClientSecret, identity: managedIdentityResourceId }
  { name: 'microsoft-webhook-client-state', keyVaultUrl: keyVaultSecretRefs.microsoftWebhookClientState, identity: managedIdentityResourceId }
  { name: 'notion-oauth-client-id', keyVaultUrl: keyVaultSecretRefs.notionOauthClientId, identity: managedIdentityResourceId }
  { name: 'notion-oauth-client-secret', keyVaultUrl: keyVaultSecretRefs.notionOauthClientSecret, identity: managedIdentityResourceId }
  { name: 'jira-oauth-client-id', keyVaultUrl: keyVaultSecretRefs.jiraOauthClientId, identity: managedIdentityResourceId }
  { name: 'jira-oauth-client-secret', keyVaultUrl: keyVaultSecretRefs.jiraOauthClientSecret, identity: managedIdentityResourceId }
  { name: 'jira-webhook-secret', keyVaultUrl: keyVaultSecretRefs.jiraWebhookSecret, identity: managedIdentityResourceId }
  { name: 'linear-oauth-client-id', keyVaultUrl: keyVaultSecretRefs.linearOauthClientId, identity: managedIdentityResourceId }
  { name: 'linear-oauth-client-secret', keyVaultUrl: keyVaultSecretRefs.linearOauthClientSecret, identity: managedIdentityResourceId }
  { name: 'linear-webhook-secret', keyVaultUrl: keyVaultSecretRefs.linearWebhookSecret, identity: managedIdentityResourceId }
  { name: 'smtp-user', keyVaultUrl: keyVaultSecretRefs.smtpUser, identity: managedIdentityResourceId }
  { name: 'smtp-pass', keyVaultUrl: keyVaultSecretRefs.smtpPass, identity: managedIdentityResourceId }
]

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: name
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${managedIdentityResourceId}': {}
    }
  }
  properties: {
    environmentId: environmentId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
        traffic: [
          { latestRevision: true, weight: 100 }
        ]
        // Sticky cookie keeps a WebSocket client pinned to one replica so signals
        // dispatched via broadcast() reach the same socket the client opened on.
        stickySessions: {
          affinity: 'sticky'
        }
      }
      secrets: [for s in secretBindings: {
        name: s.name
        keyVaultUrl: s.keyVaultUrl
        identity: s.identity
      }]
    }
    template: {
      containers: [
        {
          name: 'app'
          image: image
          resources: {
            cpu: json(cpu)
            memory: memory
          }
          volumeMounts: [
            {
              volumeName: 'sqlite-data'
              mountPath: '/app/data'
            }
          ]
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'PORT', value: '3000' }
            { name: 'HOST', value: '0.0.0.0' }
            { name: 'UNIFIED_SERVER', value: '1' }
            { name: 'SQLITE_PATH', value: '/app/data/hustronix.db' }
            { name: 'REQUIRE_HTTPS', value: 'true' }
            { name: 'APP_ORIGIN', value: appOrigin }
            { name: 'ALLOWED_ORIGINS', value: allowedOrigins }
            { name: 'WEBHOOK_PUBLIC_BASE_URL', value: appOrigin }

            // Secrets — wired through Key Vault references above.
            { name: 'OAUTH_TOKEN_ENCRYPTION_KEY', secretRef: 'oauth-encryption-key' }
            { name: 'ANTHROPIC_API_KEY', secretRef: 'anthropic-api-key' }
            { name: 'MISSION_CONTROL_API_KEY', secretRef: 'mission-control-api-key' }
            { name: 'TOTP_ENCRYPTION_KEY', secretRef: 'totp-encryption-key' }

            { name: 'SLACK_CLIENT_ID', secretRef: 'slack-client-id' }
            { name: 'SLACK_CLIENT_SECRET', secretRef: 'slack-client-secret' }
            { name: 'SLACK_SIGNING_SECRET', secretRef: 'slack-signing-secret' }
            { name: 'GITHUB_OAUTH_CLIENT_ID', secretRef: 'github-oauth-client-id' }
            { name: 'GITHUB_OAUTH_CLIENT_SECRET', secretRef: 'github-oauth-client-secret' }
            { name: 'GITHUB_WEBHOOK_SECRET', secretRef: 'github-webhook-secret' }
            { name: 'GOOGLE_OAUTH_CLIENT_ID', secretRef: 'google-oauth-client-id' }
            { name: 'GOOGLE_OAUTH_CLIENT_SECRET', secretRef: 'google-oauth-client-secret' }
            { name: 'MICROSOFT_OAUTH_CLIENT_ID', secretRef: 'microsoft-oauth-client-id' }
            { name: 'MICROSOFT_OAUTH_CLIENT_SECRET', secretRef: 'microsoft-oauth-client-secret' }
            { name: 'MICROSOFT_WEBHOOK_CLIENT_STATE', secretRef: 'microsoft-webhook-client-state' }
            { name: 'NOTION_OAUTH_CLIENT_ID', secretRef: 'notion-oauth-client-id' }
            { name: 'NOTION_OAUTH_CLIENT_SECRET', secretRef: 'notion-oauth-client-secret' }
            { name: 'JIRA_OAUTH_CLIENT_ID', secretRef: 'jira-oauth-client-id' }
            { name: 'JIRA_OAUTH_CLIENT_SECRET', secretRef: 'jira-oauth-client-secret' }
            { name: 'JIRA_WEBHOOK_SECRET', secretRef: 'jira-webhook-secret' }
            { name: 'LINEAR_OAUTH_CLIENT_ID', secretRef: 'linear-oauth-client-id' }
            { name: 'LINEAR_OAUTH_CLIENT_SECRET', secretRef: 'linear-oauth-client-secret' }
            { name: 'LINEAR_WEBHOOK_SECRET', secretRef: 'linear-webhook-secret' }
            { name: 'SMTP_USER', secretRef: 'smtp-user' }
            { name: 'SMTP_PASS', secretRef: 'smtp-pass' }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/api/health', port: 3000, scheme: 'HTTP' }
              initialDelaySeconds: 30
              periodSeconds: 30
              timeoutSeconds: 5
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: { path: '/api/health', port: 3000, scheme: 'HTTP' }
              initialDelaySeconds: 5
              periodSeconds: 10
              timeoutSeconds: 5
              failureThreshold: 3
            }
          ]
        }
      ]
      volumes: [
        {
          name: 'sqlite-data'
          storageType: 'AzureFile'
          storageName: sqliteVolumeStorageName
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        rules: [
          {
            name: 'http-scale'
            http: {
              metadata: {
                concurrentRequests: '100'
              }
            }
          }
        ]
      }
    }
  }
}

output appFqdn string = app.properties.configuration.ingress.fqdn
output principalId string = app.identity.principalId
