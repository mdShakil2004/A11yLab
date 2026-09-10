# Scripts

Automation scripts for bootstrapping the AODA WCAG compliance project in both GitHub and Azure DevOps.

## Azure DevOps: Full Setup and Deployment Guide

### Prerequisites

- Azure CLI authenticated (`az login`)
- Azure DevOps CLI extension (`az extension add --name azure-devops`)
- PowerShell 7+
- Permissions: Entra ID Application Administrator, ADO Project Admin

### Step 1: Bootstrap (One Command)

```powershell
az login
./scripts/bootstrap-demo-apps-ado.ps1
```

This single script does everything:

1. Calls `setup-oidc-ado.ps1` automatically (creates app registration, service principal, Contributor role)
2. Auto-detects AZURE_CLIENT_ID, TENANT_ID, and SUBSCRIPTION_ID from the app registration and Azure CLI
3. Creates all ADO resources:

| Resource | Count | Details |
|----------|-------|---------|
| Azure Repos | 6 | Scanner + 5 demo apps, with code pushed from monorepo |
| Variable Groups | 3 | `a11y-oidc-config`, `a11y-scan-config`, `a11y-app-urls` |
| Service Connections | 6 | WIF-based, with federated credentials auto-created |
| Environments | 13 | `deploy-001..005`, `teardown-001..005`, `deploy`, `deploy-scanner`, `teardown` |
| Pipelines | 16 | 6 scanner + 10 demo app (ci-cd + a11y-scan per app) |
| Wiki | 1 | AODA WCAG Wiki |

The script is fully idempotent. Re-running it skips resources that already exist.

### Step 2: Verify Service Connections

After bootstrap completes, verify the WIF service connections can authenticate:

1. Go to **Project Settings** > **Service connections**
2. Select each connection (e.g., `a11y-scanner-ado`) > click **Verify**

### Step 3: Deploy Everything

Run the **scanner-deploy-all** pipeline to deploy all 5 demo apps + the scanner app to Azure in parallel:

**Option A: ADO Portal**

1. Go to **Pipelines** > **Scanner** folder > **scanner-deploy-all**
2. Click **Run pipeline**
3. Leave `teardown = false`, `teardownScanDemo = false`
4. Click **Run**

**Option B: CLI**

```powershell
az pipelines run --name 'scanner-deploy-all' --branch main
```

This pipeline:
- Deploys all 5 demo apps in parallel (Bicep infra + Docker build + ACR push + Web App deploy)
- Deploys the scanner app in parallel with demo apps
- Each app gets its own resource group (`rg-a11y-demo-app-001` through `005`, `rg-a11y-scan-demo`)
- Uses environment approval gates on `deploy-001..005` and `deploy-scanner`

**Yes, deploy-all deploys the scanner app too** — matching the GitHub workflow behavior.

### Step 4: Update Variable Groups with Real URLs

After the first deployment completes, update the placeholder URLs with actual deployment URLs:

```powershell
# Get scanner URL
$scannerUrl = az deployment group show `
  --resource-group rg-a11y-scan-demo `
  --name infra-deploy `
  --query 'properties.outputs.webAppUrl.value' -o tsv

# Update variable group
$groupId = (az pipelines variable-group list --query "[?name=='a11y-scan-config'].id" -o tsv)
az pipelines variable-group variable update --group-id $groupId --name SCANNER_URL --value $scannerUrl

# Update demo app URLs
$urlGroupId = (az pipelines variable-group list --query "[?name=='a11y-app-urls'].id" -o tsv)
for ($i = 1; $i -le 5; $i++) {
    $num = $i.ToString('000')
    $appUrl = az deployment group show `
      --resource-group "rg-a11y-demo-app-$num" `
      --name infra-deploy `
      --query 'properties.outputs.webAppUrl.value' -o tsv
    az pipelines variable-group variable update --group-id $urlGroupId --name "APP_URL_$num" --value $appUrl
}
```

### Step 5: Run Accessibility Scans

**Option A: Scan all demo apps** (uses scanner API to test each deployed demo app)

```powershell
az pipelines run --name 'scanner-scan-all' --branch main
```

**Option B: Scan external targets** (scanner's own scheduled scan — CodePen, Ontario.ca, etc.)

```powershell
az pipelines run --name 'scanner-a11y-scan' --branch main
```

Both produce SARIF artifacts in the pipeline run. The `scanner-a11y-scan` pipeline also runs automatically every Monday at 06:00 UTC.

### Step 6: Teardown (When Done)

Run deploy-all again with the teardown parameters:

**Option A: ADO Portal**

1. Go to **Pipelines** > **Scanner** folder > **scanner-deploy-all**
2. Click **Run pipeline**
3. Set `teardown = true` and optionally `teardownScanDemo = true`
4. Click **Run**
5. Approve the teardown when prompted (environment gate)

**Option B: CLI**

```powershell
az pipelines run --name 'scanner-deploy-all' --branch main `
  --parameters 'teardown=true' 'teardownScanDemo=true'
```

This deletes all resource groups (`rg-a11y-demo-app-001..005` and optionally `rg-a11y-scan-demo`).

### Pipeline Reference

| Pipeline | Folder | Trigger | Purpose |
|----------|--------|---------|---------|
| `scanner-ci` | Scanner | Push to main, PRs | Lint, test, build, a11y e2e tests |
| `scanner-deploy` | Scanner | Push to main | Deploy scanner app only |
| `scanner-deploy-all` | Scanner | Manual | Deploy all 5 demo apps + scanner in parallel |
| `scanner-a11y-scan` | Scanner | Weekly + manual | Scan external targets (CodePen, Ontario.ca) |
| `scanner-scan-all` | Scanner | Manual | Scan all 5 deployed demo apps |
| `scanner-scan-and-store` | Scanner | Manual | Scan + store results in Azure Blob for Power BI |
| `ci-cd-a11y-demo-app-NNN` | Demo Apps | Push to main | Build and deploy individual demo app |
| `a11y-scan-a11y-demo-app-NNN` | Demo Apps | Weekly + manual | Scan individual demo app |

### Manual Steps (One-Time)

These are the only manual steps after running bootstrap:

1. **Add approval checks** on environments (optional but recommended for teardown):
   Project Settings > Environments > select `teardown` > Approvals and checks

2. **Verify service connections** (Step 2 above)

3. **Update placeholder URLs** after first deployment (Step 4 above)

## GitHub Setup

For the GitHub-based workflow:

```powershell
az login
./scripts/setup-oidc.ps1
./scripts/bootstrap-demo-apps.ps1
```

## Script Reference

| Script | Platform | Purpose |
|--------|----------|---------|
| `setup-oidc.ps1` | GitHub | Create app registration with GitHub federated credentials |
| `setup-oidc-ado.ps1` | ADO | Create app registration for ADO WIF (called by bootstrap) |
| `bootstrap-demo-apps.ps1` | GitHub | Create GitHub repos, secrets, environments |
| `bootstrap-demo-apps-ado.ps1` | ADO | Create Azure Repos, service connections, pipelines, environments |
| `scan-and-store.ps1` | ADO | Scan sites and upload results to Azure Blob Storage |
