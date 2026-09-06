#!/usr/bin/env bash
#
# Provisions the infrastructure for the Telegraph Track 3 deployment.
#
# Everything created here lives under the nemesis-telegraph-* namespace and is
# isolated from the frozen original NEMESIS submission: a separate Firestore
# database, a separate Pub/Sub topic and subscription, a separate scheduler job,
# a separate runtime identity and separate secrets. Nothing in this script reads
# or modifies a resource belonging to that deployment.
#
# The one setting that matters most is FIRESTORE_DATABASE. The application uses
# a single Firestore client, so naming a separate database keeps every
# collection apart: cases, branches, timeline, graph, processed events and
# Telegraph receipts.
set -euo pipefail

: "${GOOGLE_CLOUD_PROJECT:?Set GOOGLE_CLOUD_PROJECT}"
REGION="${GOOGLE_CLOUD_REGION:-us-central1}"
FIRESTORE_LOCATION="${FIRESTORE_LOCATION:-us-central1}"
FIRESTORE_DATABASE="${FIRESTORE_DATABASE:-nemesis-telegraph}"
API_URL="${TELEGRAPH_API_URL:?Set TELEGRAPH_API_URL to the deployed nemesis-telegraph-api URL}"

RUNTIME_ACCOUNT="nemesis-telegraph@${GOOGLE_CLOUD_PROJECT}.iam.gserviceaccount.com"
PROJECT_NUMBER="$(gcloud projects describe "${GOOGLE_CLOUD_PROJECT}" --format='value(projectNumber)')"
BUILD_ACCOUNT="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"

if [[ "${FIRESTORE_DATABASE}" == "(default)" ]]; then
  echo "Refusing to run against the default Firestore database, which belongs to the original deployment." >&2
  exit 1
fi

gcloud config set project "${GOOGLE_CLOUD_PROJECT}"
gcloud services enable \
  aiplatform.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  firestore.googleapis.com \
  iam.googleapis.com \
  run.googleapis.com \
  secretmanager.googleapis.com \
  pubsub.googleapis.com \
  cloudscheduler.googleapis.com

gcloud artifacts repositories describe nemesis --location "${REGION}" >/dev/null 2>&1 || \
  gcloud artifacts repositories create nemesis --repository-format docker --location "${REGION}"

# Isolated database. Creating it does not touch (default).
gcloud firestore databases describe --database="${FIRESTORE_DATABASE}" >/dev/null 2>&1 || \
  gcloud firestore databases create --database="${FIRESTORE_DATABASE}" \
    --location="${FIRESTORE_LOCATION}" --type=firestore-native

gcloud iam service-accounts describe "${RUNTIME_ACCOUNT}" >/dev/null 2>&1 || \
  gcloud iam service-accounts create nemesis-telegraph \
    --display-name "NEMESIS Telegraph Track 3 runtime"

for role in roles/datastore.user roles/aiplatform.user roles/pubsub.publisher; do
  gcloud projects add-iam-policy-binding "${GOOGLE_CLOUD_PROJECT}" \
    --member "serviceAccount:${RUNTIME_ACCOUNT}" --role "${role}" --condition=None >/dev/null
done

# Secrets are namespaced rather than shared, so the original deployment's
# secret IAM policies are never modified. Provider values are copied in, not
# referenced across.
for secret in \
  nemesis-telegraph-ethereum-rpc \
  nemesis-telegraph-base-rpc \
  nemesis-telegraph-alchemy-api-key \
  nemesis-telegraph-bitquery-token \
  nemesis-telegraph-chainabuse-api-key \
  nemesis-telegraph-internal-token \
  nemesis-telegraph-payer-key; do
  gcloud secrets describe "${secret}" >/dev/null 2>&1 || \
    gcloud secrets create "${secret}" --replication-policy automatic
  gcloud secrets add-iam-policy-binding "${secret}" \
    --member "serviceAccount:${RUNTIME_ACCOUNT}" \
    --role roles/secretmanager.secretAccessor >/dev/null
done

gcloud pubsub topics describe nemesis-telegraph-case-events >/dev/null 2>&1 || \
  gcloud pubsub topics create nemesis-telegraph-case-events

# A deep trace runs for minutes, so the default ten second acknowledgement
# deadline redelivers work that is still in progress. Without a retry policy it
# also redelivers failures immediately, aiming a burst of traffic at whichever
# provider just refused the last request.
gcloud pubsub subscriptions describe nemesis-telegraph-case-events-push >/dev/null 2>&1 || \
  gcloud pubsub subscriptions create nemesis-telegraph-case-events-push \
    --topic nemesis-telegraph-case-events \
    --push-endpoint "${API_URL}/internal/events/pubsub" \
    --push-auth-service-account "${RUNTIME_ACCOUNT}" \
    --push-auth-token-audience "${API_URL}" \
    --ack-deadline=600 --min-retry-delay=10s --max-retry-delay=600s

gcloud pubsub subscriptions update nemesis-telegraph-case-events-push \
  --ack-deadline=600 --min-retry-delay=10s --max-retry-delay=600s >/dev/null

# Created paused. Background rechecks against an active address spend real
# money on Telegraph enrichment, so enabling this is a deliberate decision.
gcloud scheduler jobs describe nemesis-telegraph-monitor-tick --location "${REGION}" >/dev/null 2>&1 || {
  gcloud scheduler jobs create http nemesis-telegraph-monitor-tick \
    --location "${REGION}" --schedule "*/5 * * * *" \
    --uri "${API_URL}/internal/monitoring/tick" \
    --http-method POST --oidc-service-account-email "${RUNTIME_ACCOUNT}" \
    --oidc-token-audience "${API_URL}"
  gcloud scheduler jobs pause nemesis-telegraph-monitor-tick --location "${REGION}"
}

for role in roles/run.admin roles/artifactregistry.writer; do
  gcloud projects add-iam-policy-binding "${GOOGLE_CLOUD_PROJECT}" \
    --member "serviceAccount:${BUILD_ACCOUNT}" --role "${role}" --condition=None >/dev/null
done
gcloud iam service-accounts add-iam-policy-binding "${RUNTIME_ACCOUNT}" \
  --member "serviceAccount:${BUILD_ACCOUNT}" --role roles/iam.serviceAccountUser >/dev/null

cat <<'DONE'
Telegraph infrastructure ready.

Next:
  1. Add one version to each nemesis-telegraph-* provider secret.
  2. Add the Base Sepolia burner key to nemesis-telegraph-payer-key.
  3. Add a random shared secret to nemesis-telegraph-internal-token.
  4. Deploy: cloudbuild.gateway.yaml, then cloudbuild.telegraph.yaml,
     then cloudbuild.telegraph-frontend.yaml.

The scheduler job is created paused on purpose. Enable it only when background
monitoring should be allowed to spend on Telegraph enrichment.
DONE
