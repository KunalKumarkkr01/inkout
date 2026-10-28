# Releasing Inkout

After the one-time setup below, a release is: raise the version, merge, push a tag, approve.

## Every release

1. Raise `version` in `manifest.json` (for example `1.0.0` → `1.0.1`). The store refuses a package whose version isn't higher than the live one.
2. Merge that change into `main` through a pull request, as usual.
3. Tag the merged commit and push the tag:

   ```bash
   git switch main
   git pull --ff-only
   git tag v1.0.1
   git push origin v1.0.1
   ```

4. The **Release** workflow (`.github/workflows/release.yml`) then:
   - checks the tag is `v` + the version in `manifest.json`, and stops if not;
   - runs every test;
   - builds `dist/inkout-1.0.1.zip` and attaches it to a new GitHub release;
   - waits for your approval.
5. Approve it: open the run under the repository's **Actions** tab and click **Review deployments** → **chrome-web-store** → **Approve and deploy**.
6. The workflow uploads the zip to the Chrome Web Store and submits it for review. Google reviews it, then publishes it on its own; the dashboard and Google's emails show the progress.

**If the publish job fails:**
- **Before the upload:** fix the cause, then use **Re-run failed jobs**.
- **After the upload:** the store already holds this version and refuses the same version twice, so a re-run fails. Finish in the developer dashboard with **Submit for review**.

## One-time setup

Do this after the first version has been submitted by hand in the developer dashboard. The API can only update an item that already exists.

### 1. Note the two store IDs

- **Extension ID:** the 32-letter ID on the item's page in the [developer dashboard](https://chrome.google.com/webstore/devconsole), also in its address.
- **Publisher ID:** in the dashboard under **Publisher** → **Settings**.

### 2. Create the Google Cloud side

GitHub signs in to Google with Workload Identity Federation: Google checks a short-lived token that GitHub issues for each run, so no key or password is stored anywhere. Only a run of this repository, from a `v…` tag, in the approved `chrome-web-store` environment, is let in.

Run these in [Cloud Shell](https://shell.cloud.google.com), which has `gcloud` ready. Pick your own project ID; it must be unique across Google Cloud.

```bash
PROJECT_ID=inkout-release-12345
REPO_ID=1436922110   # GitHub's ID for KunalKumarkkr01/inkout

gcloud projects create "$PROJECT_ID"
gcloud config set project "$PROJECT_ID"
gcloud services enable chromewebstore.googleapis.com iamcredentials.googleapis.com sts.googleapis.com

gcloud iam service-accounts create inkout-release --display-name="Inkout release"

gcloud iam workload-identity-pools create github --location=global --display-name="GitHub Actions"
gcloud iam workload-identity-pools providers create-oidc inkout \
  --location=global \
  --workload-identity-pool=github \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id" \
  --attribute-condition="assertion.repository_id == '$REPO_ID' && assertion.environment == 'chrome-web-store' && assertion.ref.startsWith('refs/tags/v')"

PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
gcloud iam service-accounts add-iam-policy-binding "inkout-release@$PROJECT_ID.iam.gserviceaccount.com" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository_id/$REPO_ID"

echo "GCP_WORKLOAD_IDENTITY_PROVIDER=projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/inkout"
echo "GCP_SERVICE_ACCOUNT=inkout-release@$PROJECT_ID.iam.gserviceaccount.com"
```

The repository ID is used instead of the name so that a renamed or re-created repository can't take its place. Google says new access can take up to 5 minutes to work.

### 3. Let the service account manage the item

In the developer dashboard, open **Account** and add the service account's email (`inkout-release@<project>.iam.gserviceaccount.com`). A publisher can have only one service account.

### 4. Give the workflow the four values

The `chrome-web-store` environment already exists in the repository. It requires your approval and only accepts `v*` tags. Add the values to it; none of them is a secret.

```bash
gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --env chrome-web-store --repo KunalKumarkkr01/inkout --body "projects/…/providers/inkout"
gh variable set GCP_SERVICE_ACCOUNT --env chrome-web-store --repo KunalKumarkkr01/inkout --body "inkout-release@….iam.gserviceaccount.com"
gh variable set CWS_PUBLISHER_ID --env chrome-web-store --repo KunalKumarkkr01/inkout --body "<publisher ID>"
gh variable set CWS_EXTENSION_ID --env chrome-web-store --repo KunalKumarkkr01/inkout --body "<extension ID>"
```

## Why it's set up this way

Inkout reads every page its users open, so whoever can publish an update to it could read those pages too. The setup has no stored key that could leak. Google only lets in this repository's tag runs, and nothing reaches the store without your approval.
