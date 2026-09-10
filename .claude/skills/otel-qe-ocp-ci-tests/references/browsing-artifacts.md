# Browsing CI Job Logs and Artifacts


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

### Checking the qe-agent Step Before Manual Log Digging

Every stage job also runs an `openshift-observability-qe-agent` step that reruns failures, diagnoses flaky vs. regression, applies fixes, and can auto-file a Jira bug — check it first, at `artifacts/{test-name}/openshift-observability-qe-agent/`.

1. Read that step's `build-log.txt` to see which path it took:
   - `"Test failures detected — proceeding with qe-agent analysis."` — it ran. Read `artifacts/qe-agent-analysis.md` for the diagnosis (FLAKY vs. REGRESSION), root cause, and rerun results. Check `artifacts/test-fixes/` for any fix applied, and `artifacts/jira-issue-key.txt` for an auto-filed bug.
   - `"All tests passed — no failures detected. Skipping qe-agent."` — the job actually passed; nothing to investigate.
   - Any other `"skipping qe-agent"` line (missing context file, Claude CLI, `AGENT_SKILL`, or a skill fetch/size error) — it didn't get to run despite a real failure. Fall back to the failing test step's own `build-log.txt` and JUnit XML directly (see below).

### Browsing Test Artifacts via gcsweb

After jobs run, their artifacts (logs, test results, cluster state) are stored in GCS and browsable via gcsweb.

**Authentication:**
gcsweb requires an OpenShift OAuth token, not a Kubernetes ServiceAccount token — `oc login` to `app.ci` first (console: `https://console-openshift-console.apps.ci.l2s4.p1.openshiftapps.com/` → username menu → Copy login command), then:
```bash
printf 'Authorization: Bearer %s\n' "$(oc whoami -t)" | curl -H @- <gcsweb-url>
```
(reads the header from stdin — keeps the token out of argv/`ps`/shell history)

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

Open the job's history page (the Step 8 link) and take the build ID from the `Build` column of the run you want — or read `ID` from the `allBuilds` JSON described there. Every run is listed — passed, failed, and aborted — for the whole life of the PR.

Do not rely on the bot's PR comment for this: it tables only **failed** jobs, and the green status contexts it complements are wiped from the PR whenever a new commit is pushed. The history page is the durable record.

**Browsing Artifacts:**
Navigate through gcsweb to find:
- `build-log.txt` - Container/step logs
- `sidecar-logs.json` - Detailed logs from sidecar containers, important for debugging test failures
- `finished.json` - Job completion metadata
- `junit/` - JUnit XML test results
