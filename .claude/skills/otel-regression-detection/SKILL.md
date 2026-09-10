---
name: otel-regression-detection
description: Detect regressions in upstream OpenTelemetry repos compared to the downstream Red Hat build of OpenTelemetry release. Dynamically discovers components from manifest.yaml and docs. Analyzes changelogs, code diffs, feature gates, GitHub issues, doc staleness, test coverage gaps, and dependency changes. Use when the user asks to check for upstream regressions or breaking changes ahead of a release.
argument-hint: "[--method changelog|code-diff|feature-gates|issues|doc-validation|test-coverage|dependencies] [--release-version 3.10]"
---

# OpenTelemetry Upstream Regression Detection

Detect regressions and breaking changes in upstream OpenTelemetry repositories compared to the currently shipped Red Hat build of OpenTelemetry release.

## When to Use

- Checking for upstream regressions before a new Red Hat build of OpenTelemetry release
- Automated regression scanning triggered by new upstream releases (via CI)
- Investigating whether a specific upstream change affects Red Hat build of OpenTelemetry
- Auditing test coverage gaps or doc staleness for documented components

## How It Works

The workflow has 4 phases:

1. **Discover** — parses `manifest.yaml` from `konflux-opentelemetry/redhat-opentelemetry-collector` to get the exact component list and base version, then globs `openshift-docs` for doc files. Cross-references to find drift. No static component registry needed.

2. **Setup** — validates repos exist, fetches latest upstream, verifies base tags

3. **Analyze** (parallel fan-out):
   - **Changelog Analysis** — parses CHANGELOG.md for breaking changes, deprecations, behavior changes
   - **Code Diff Analysis** — diffs config structs, API types, webhooks for documented components
   - **Feature Gate Tracking** — detects feature gate promotions that change default behavior
   - **GitHub Issue/PR Scanning** — finds bugs, regressions, and reverted PRs via `gh` CLI
   - **Doc Validation** — reads `.adoc` files and cross-references config options against upstream config structs
   - **Test Coverage Matrix** — builds a full per-component coverage report (dedicated/implicit/none for both upstream and QE tests) plus a separate operator feature coverage matrix (target allocator, OpAMP bridge, sidecar injection, autoscaling, etc., discovered from the operator's `tests/e2e-*` suites), highlights gaps, detects upstream test deletions
   - **Dependency Tracking** — flags significant version bumps in go.mod

4. **Synthesize** — deduplicates, classifies severity, generates a Markdown remediation report and JSON summary

## Prerequisites

Repos must be cloned into the workspace directory first:

```bash
make clone-repos
```

Required repos: `konflux-opentelemetry`, `opentelemetry-operator`, `opentelemetry-collector-contrib`, `opentelemetry-collector`, `redhat-opentelemetry-collector` (used to read `manifest.yaml` for a specific release version — see `--release-version` below).
Optional: `openshift-docs` (doc validation), `distributed-tracing-qe` (QE test coverage).

The `gh` CLI must be authenticated for GitHub issue/PR scanning.

## Usage

### Before running locally

The CI job runs automatically roughly every six weeks (1st of Jan/Apr/Jul/Oct, 15th of Feb/May/Aug/Nov, all at 07:57 UTC), regardless of whether the upstream operator version has changed since the last run. It commits its reports straight to `reports/` on `main` (also uploaded as a GitHub Actions artifact for the specific run). Before running locally (which consumes significant tokens), check if a recent report already exists:

1. Check `reports/` on `main` for a report dated within the last six weeks — `git pull` if your local checkout is behind.
2. If nothing recent enough is there yet, check the [Regression Detection](https://github.com/rhobs/redhat-build-of-opentelemetry-workspace/actions/workflows/regression-detection.yml) workflow in GitHub Actions in case a run is in flight.

Run locally only if you need fresher results or want to focus on a specific detection method.

### Basic (analyzes current release in konflux-opentelemetry)

```
/otel-regression-detection
```

### Analyze a specific release version

If `konflux-opentelemetry` has been updated to a newer version but you want to analyze a previously shipped release:

```
/otel-regression-detection --release-version 3.10
```

This uses the `v3.10` tag in `konflux-opentelemetry` to read the exact component list, operator commit, and collector version that shipped with that release.

### Focus on a single detection method (faster, lower token cost)

```
/otel-regression-detection --method changelog
/otel-regression-detection --method code-diff
/otel-regression-detection --method feature-gates
/otel-regression-detection --method issues
/otel-regression-detection --method doc-validation
/otel-regression-detection --method test-coverage
/otel-regression-detection --method dependencies
```

## Execution Steps

1. **Verify repos are cloned**: Check that required repos exist in the workspace directory (cloned via `make clone-repos`). If any are missing, tell the user to run `make clone-repos`.

2. **Run the regression detection workflow**: Invoke the Workflow tool with `.claude/workflows/regression-detection.js`, passing repo paths and method as args:
   ```js
   Workflow({
     name: 'regression-detection',
     args: {
       konflux_path: 'konflux-opentelemetry',
       operator_path: 'opentelemetry-operator',
       contrib_path: 'opentelemetry-collector-contrib',
       core_path: 'opentelemetry-collector',
       rh_collector_path: 'redhat-opentelemetry-collector',
       docs_path: 'openshift-docs',       // optional — omit or '' if not cloned
       qe_path: 'distributed-tracing-qe', // optional — omit or '' if not cloned
       method: 'all',                     // or one of the --method values above
       release_version: '',               // or e.g. '3.10' for --release-version
     },
   })
   ```
   All path args default to these same repo names if omitted, so the workflow also runs standalone via the auto-registered `/regression-detection` command. The workflow's Discover phase automatically extracts all build metadata from `konflux-opentelemetry`, and its Setup phase validates the required repos/base refs before proceeding.

3. **Generate report**: The workflow's return value includes `operator_version` (the *upstream* operator version this report analyzes — the latest release tag reachable from origin/main in the operator repo, e.g. `v0.160.0`, not the downstream base version) alongside `report_markdown` and `summary_counts`. Write to `reports/regression-summary-v<operator_version>-YYYY-MM-DD.json` and `reports/regression-detection-v<operator_version>-YYYY-MM-DD.md` (the `report_markdown` field — a plain-Markdown rendering of the findings, grouped by severity (Critical/High/Medium/Low) with a Contents section linking straight to each, and each finding's metadata rendered as a table). Every report ends with a **Skill Improvement Recommendations** section: every sub-agent in the workflow self-reports any place its actual approach deviated from that agent's prompt as written, and these are collected into that section (`None.` if nothing deviated) — a running signal for improving this skill's own instructions over time. There is no HTML report — Markdown is the only report format.

4. **Present summary**: Show counts by severity and top findings.

## Configuration

**No config file or manual updates are needed for new releases.** All repo names are listed in the Prerequisites section above, and all build metadata (component list, versions, release branch) is derived at runtime from `konflux-opentelemetry`'s submodule refs, manifest, and git metadata.

## Running in CI

GitHub Actions invokes this skill headlessly:

```bash
claude -p "/otel-regression-detection --method changelog" \
  --dangerously-skip-permissions \
  --output-format text \
  --allowedTools "Bash,Read,Write,Edit,Workflow,Agent" \
  --max-budget-usd 25
```

`--dangerously-skip-permissions` is required for headless runs — there's no terminal to approve tool-use prompts. This is safe in CI because `--allowedTools` still restricts which tools can run, and the CI runner is an ephemeral, isolated environment.

See `.github/workflows/regression-detection.yml` for the full CI setup (six-week schedule, repo cloning, credentials).
