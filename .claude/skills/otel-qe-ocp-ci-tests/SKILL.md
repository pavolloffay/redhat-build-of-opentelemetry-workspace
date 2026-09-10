---
name: otel-qe-ocp-ci-tests
description: Set up OpenTelemetry OCP CI stage testing by creating a PR to openshift/release with IIBs from konflux release payloads, then triggering the stage jobs. Use when starting stage testing for a new product release or updating IIB images after a Konflux FBC build. Also use when stage testing on an existing PR is finished and the rehearsal job results need collecting and posting to the Jira tracker.
argument-hint: '{version} to set up testing (e.g. "3.11"), OR {pr-id} {jira-id} to collect final results and post them to Jira (e.g. "84239 TRACING-1234")'
---

# OpenTelemetry OCP CI Stage Testing

Set up stage testing for Red Hat build of OpenTelemetry release by creating a PR to the `openshift/release` repository with correct IIB (Index Image Build) mappings from the Konflux release payload.

## Modes

This skill has two independent entry points. Pick by what the user passed:

| Arguments | Mode | Run |
|---|---|---|
| A release version (`3.11`) | Setup | Steps 1-7 |
| A PR number and a Jira key (`84239 TRACING-1234`) | Final status collection | Steps 8-9 only |
| A PR number, no Jira key | Final status collection | Steps 8-9; ask for the tracker key first |
| Nothing, or ambiguous | — | Ask which one before doing anything |

The two modes run in separate sessions, usually days apart. Never run collection at the end of a setup run — see the note at the end of Step 7.

## Prerequisites

1. The `konflux` GitLab repository must be cloned in the workspace
2. The `release` GitHub repository must be cloned in the workspace  
3. Your GitHub fork of `openshift/release` must be configured as a remote
4. The `gh` CLI must be authenticated
5. The `oc` CLI must be logged into `app.ci` (`oc login --server=https://api.ci.l2s4.p1.openshiftapps.com:6443`) — needed for gcsweb/deck artifact access, and for authoritative results in Step 8. If the user won't log in, Step 8 has a `gh`-only fallback with stated limitations.

## CI Jobs in Release Repository

Config file locations, naming patterns, variants (regular/FIPS/ARM), job-name patterns, and the separately-located disconnected job: see [references/ci-job-layout.md](references/ci-job-layout.md). Read it before Step 1.

## Steps

### Step 1: Extract IIB Mappings from Konflux Release Payload

Read the release payload file `konflux/release-payloads/otel-stage-{VERSION}.yaml` and extract all IIB mappings.

Look for sections like:
```yaml
- ocp_version: v4.19
  index_image: registry-proxy.engineering.redhat.com/rh-osbs/iib:1201672
```

Create a mapping of OCP version to IIB number for all versions in the payload, stripping the leading `v` from `ocp_version` (e.g. `v4.19` → `4.19`) — file and job names use the bare version number.

### Step 2: Update CI Configuration Files

For each OCP version in the IIB mapping, update the corresponding stage test configuration file in `release/ci-operator/config/openshift/open-telemetry-opentelemetry-operator/`.

**File pattern:** `openshift-open-telemetry-opentelemetry-operator-main__opentelemetry-product-ocp-{VERSION}-{VARIANT}-stage.yaml`

**Changes to make:**
1. Update `MULTISTAGE_PARAM_OVERRIDE_OTEL_INDEX_IMAGE` to `brew.registry.redhat.io/rh-osbs/iib:{IIB_NUMBER}`
2. Also update the disconnected test config (see "Disconnected test job" in [references/ci-job-layout.md](references/ci-job-layout.md)) with the matching `MULTISTAGE_PARAM_OVERRIDE_OTEL_INDEX_IMAGE` and `MULTISTAGE_PARAM_OVERRIDE_TEMPO_INDEX_IMAGE` — same PR, same IIB values.

**IMPORTANT:**
- Only update files for OCP versions that exist in the IIB mapping
- Do NOT create configs for versions not in the mapping
- Update BOTH regular and variant configs (e.g., 4.22-stage AND 4.22-fips-stage AND 4.22-arm-stage)
- Don't skip the disconnected config just because it's in a different project directory
- Preserve all other configuration settings

### Step 3: Create Git Branch and Commit

```bash
cd release
git checkout -b otel-{VERSION}-stage-tests
git add <path-to-each-file-updated-in-step-2>  # only the specific files edited above, not a wildcard
git diff --cached --name-only                  # verify no unrelated files got staged
git commit -s -m "OTEL RHOSDT {VERSION}: Stage tests

Stage testing for RHOSDT: OTEL {VERSION}

- Updated IIB images from konflux release payload"
```

### Step 4: Push to Fork

Push to your fork remote, not `origin` (find it with `git remote -v | grep push | grep <your-github-username>`):

```bash
git push <fork-remote> otel-{VERSION}-stage-tests
```

### Step 5: Create Pull Request

```bash
gh pr create --repo openshift/release --head <fork-user>:otel-{VERSION}-stage-tests --base main \
  --title "OTEL RHOSDT {VERSION}: Stage tests" \
  --body "Stage testing for RHOSDT: OTEL {VERSION}. Updated IIB images from konflux release payload. Can be merged only after all jobs pass."
```

Note the PR number from the output — it's `{PR_NUMBER}` in Step 6.

### Step 6: Trigger Rehearsal Jobs

Add a comment to the PR to trigger all rehearsal jobs:

```bash
gh pr comment {PR_NUMBER} --repo openshift/release --body "/pj-rehearse {job-list}"
```

Where `{job-list}` is a space-separated list of all job names from the updated configs, including the disconnected job's periodic name — periodics rehearse via `/pj-rehearse` the same way presubmits do. Job name pattern:
```
periodic-ci-openshift-open-telemetry-opentelemetry-operator-main-opentelemetry-product-ocp-{VERSION}-{VARIANT}-stage-opentelemetry-stage-tests
periodic-ci-openshift-distributed-tracing-qe-main-ocp-4.16-disconnected-distributed-tracing-tests-disconnected
```

**Example:**
```
/pj-rehearse periodic-ci-openshift-open-telemetry-opentelemetry-operator-main-opentelemetry-product-ocp-4.19-stage-opentelemetry-stage-tests periodic-ci-openshift-open-telemetry-opentelemetry-operator-main-opentelemetry-product-ocp-4.20-stage-opentelemetry-stage-tests
```

### Step 7: Report Setup Results

Provide the user with:
1. PR URL
2. List of updated config files
3. IIB mappings used
4. Rehearsal jobs triggered

Testing is now in progress. Steps 8-9 are a separate, later pass — do NOT run them here. Jobs take hours, are rerun after fixes, and more `/pj-rehearse` rounds usually follow. A status collected now is wrong by the time anyone reads it.

## Final Status Collection

Steps 8-9 — collecting each rehearsed job's final result and posting the table to the Jira tracker. Full procedure in [references/final-status-collection.md](references/final-status-collection.md); read it when running collection mode.

## Browsing CI Job Logs and Artifacts

When a job fails and you need to dig into logs, JUnit XML, or the `openshift-observability-qe-agent` diagnosis, see [references/browsing-artifacts.md](references/browsing-artifacts.md) — gcsweb URL patterns, authentication, and which artifact to read first.
