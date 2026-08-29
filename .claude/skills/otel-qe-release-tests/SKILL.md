---
name: otel-qe-release-tests
description: Set up OpenTelemetry release stage testing by creating a PR to openshift/release with IIBs from konflux release payloads. Use when starting stage testing for a new product release or updating IIB images after a Konflux FBC build.
argument-hint: 'version: RHOSDT release version (e.g., "3.11", "3.12")'
---

# OpenTelemetry Release Testing

Set up stage testing for Red Hat build of OpenTelemetry release by creating a PR to the `openshift/release` repository with correct IIB (Index Image Build) mappings from the Konflux release payload.

## Prerequisites

1. The `konflux` GitLab repository must be cloned in the workspace
2. The `release` GitHub repository must be cloned in the workspace  
3. Your GitHub fork of `openshift/release` must be configured as a remote
4. The `gh` CLI must be authenticated

## CI Jobs in Release Repository

The OpenShift CI jobs for OpenTelemetry stage testing are defined in the `release` repository:

**Location:** `ci-operator/config/openshift/open-telemetry-opentelemetry-operator/`

**File naming pattern:**
```
openshift-open-telemetry-opentelemetry-operator-main__opentelemetry-product-ocp-{VERSION}-{VARIANT}-stage.yaml
```

**Examples:**
- `openshift-open-telemetry-opentelemetry-operator-main__opentelemetry-product-ocp-4.19-stage.yaml`
- `openshift-open-telemetry-opentelemetry-operator-main__opentelemetry-product-ocp-4.22-fips-stage.yaml`
- `openshift-open-telemetry-opentelemetry-operator-main__opentelemetry-product-ocp-4.14-arm-stage.yaml`

**List all stage test configs:**
```bash
ls release/ci-operator/config/openshift/open-telemetry-opentelemetry-operator/*stage.yaml
```

**Variants:**
- **Regular:** `ocp-4.XX-stage.yaml` - Standard x86_64 tests
- **FIPS:** `ocp-4.XX-fips-stage.yaml` - FIPS-enabled clusters
- **ARM:** `ocp-4.XX-arm-stage.yaml` - ARM64 architecture tests

**Job naming pattern:**
```
periodic-ci-openshift-open-telemetry-opentelemetry-operator-main-opentelemetry-product-ocp-{VERSION}-{VARIANT}-stage-opentelemetry-stage-tests
```

## Steps

### Step 1: Extract IIB Mappings from Konflux Release Payload

Read the release payload file `konflux/release-payloads/otel-stage-{VERSION}.yaml` and extract all IIB mappings.

Look for sections like:
```yaml
- ocp_version: v4.19
  index_image: registry-proxy.engineering.redhat.com/rh-osbs/iib:1201672
```

Create a mapping of OCP version to IIB number for all versions in the payload.

### Step 2: Update CI Configuration Files

For each OCP version in the IIB mapping, update the corresponding stage test configuration file in `release/ci-operator/config/openshift/open-telemetry-opentelemetry-operator/`.

**File pattern:** `openshift-open-telemetry-opentelemetry-operator-main__opentelemetry-product-ocp-{VERSION}-{VARIANT}-stage.yaml`

**Changes to make:**
1. Update `MULTISTAGE_PARAM_OVERRIDE_OTEL_INDEX_IMAGE` to `brew.registry.redhat.io/rh-osbs/iib:{IIB_NUMBER}`

**IMPORTANT:**
- Only update files for OCP versions that exist in the IIB mapping
- Do NOT create configs for versions not in the mapping
- Update BOTH regular and variant configs (e.g., 4.22-stage AND 4.22-fips-stage AND 4.22-arm-stage)
- Preserve all other configuration settings

### Step 3: Create Git Branch and Commit

```bash
cd release
git checkout -b otel-{VERSION}-stage-tests
git add ci-operator/config/openshift/open-telemetry-opentelemetry-operator/*stage.yaml
git commit -s -m "OTEL RHOSDT {VERSION}: Stage tests

Stage testing for RHOSDT: OTEL {VERSION}

- Updated IIB images from konflux release payload"
```

### Step 4: Push to Fork

### Step 5: Create Pull Request

### Step 6: Trigger Rehearsal Jobs

Add a comment to the PR to trigger all rehearsal jobs:

```bash
gh pr comment {PR_NUMBER} --body "/pj-rehearse {job-list}"
```

Where `{job-list}` is a space-separated list of all job names from the updated configs. Job name pattern:
```
periodic-ci-openshift-open-telemetry-opentelemetry-operator-main-opentelemetry-product-ocp-{VERSION}-{VARIANT}-stage-opentelemetry-stage-tests
```

**Example:**
```
/pj-rehearse periodic-ci-openshift-open-telemetry-opentelemetry-operator-main-opentelemetry-product-ocp-4.19-stage-opentelemetry-stage-tests periodic-ci-openshift-open-telemetry-opentelemetry-operator-main-opentelemetry-product-ocp-4.20-stage-opentelemetry-stage-tests
```

### Step 7: Report Results

Provide the user with:
1. PR URL
2. List of updated config files
3. IIB mappings used
4. Rehearsal jobs triggered

## Browsing CI Job Logs and Artifacts

### Understanding Test Structure in CI Configs

The CI configuration files define tests in the `tests:` section. Each test has:
- `as:` - Test name (e.g., `opentelemetry-stage-tests`)
- `steps.test:` - List of step refs that execute (e.g., `distributed-tracing-tests-opentelemetry-stage`)

**Example from a config file:**
```yaml
tests:
- as: opentelemetry-stage-tests
  steps:
    test:
    - ref: distributed-tracing-install-otel-konflux-catalogsource
    - ref: install-operators
    - ref: distributed-tracing-tests-opentelemetry-stage
```

The step refs correspond to step registry entries in `ci-operator/step-registry/`.

### Browsing Test Artifacts via gcsweb

After jobs run, their artifacts (logs, test results, cluster state) are stored in GCS and browsable via gcsweb.

**Authentication:**
gcsweb requires a bearer token. Obtain one by logging into the OpenShift CI console at `https://console-openshift-console.apps.ci.l2s4.p1.openshiftapps.com/` and copying the token from the user menu (Copy login command → Display Token). Use it with:
```bash
curl -H "Authorization: Bearer <token>" <gcsweb-url>
```

**URL Pattern:**
```
https://gcsweb-qe-private-deck-ci.apps.ci.l2s4.p1.openshiftapps.com/gcs/qe-private-deck/pr-logs/pull/{repo}/{pr-number}/{job-name}/{build-id}/artifacts/{test-name}/{step-name}/
```

**Example:**
```
https://gcsweb-qe-private-deck-ci.apps.ci.l2s4.p1.openshiftapps.com/gcs/qe-private-deck/pr-logs/pull/openshift_release/84173/rehearse-84173-periodic-ci-openshift-open-telemetry-opentelemetry-operator-main-opentelemetry-product-ocp-4.21-stage-opentelemetry-stage-tests/2092950588802207744/artifacts/opentelemetry-stage-tests/distributed-tracing-tests-opentelemetry-stage/
```

**URL Components:**
- `{repo}`: `openshift_release` (for PRs to openshift/release)
- `{pr-number}`: PR number (e.g., `84173`)
- `{job-name}`: Full job name with `rehearse-{pr-number}-` prefix
- `{build-id}`: Unique build ID (e.g., `2092950588802207744`)
- `{test-name}`: The `as:` field from CI config (e.g., `opentelemetry-stage-tests`)
- `{step-name}`: The `ref:` field from CI config (e.g., `distributed-tracing-tests-opentelemetry-stage`)

**Finding the Build ID:**
1. After `/pj-rehearse`, the bot comments with job links
2. Click on a job link to see the prow dashboard
3. The build ID is in the URL or shown as "Build ID" on the page

**Browsing Artifacts:**
Navigate through gcsweb to find:
- `build-log.txt` - Container/step logs
- `sidecar-logs.json` - Detailed logs from sidecar containers, important for debugging test failures
- `finished.json` - Job completion metadata
- `junit/` - JUnit XML test results
- Custom artifacts created by the test steps