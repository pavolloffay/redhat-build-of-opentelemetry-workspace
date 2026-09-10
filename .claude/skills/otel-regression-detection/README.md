# Regression Detection

Automated system that detects upstream regressions in OpenTelemetry repos compared to the currently shipped Red Hat build of OpenTelemetry release. It dynamically discovers components from `konflux-opentelemetry` (manifest.yaml, submodule pins, release branch) — no manual config updates are needed for new releases.

## What it detects

| Method | What it finds |
|--------|---------------|
| Changelog analysis | Breaking changes, deprecations, behavior changes in CHANGELOG.md |
| Code diff analysis | Removed/renamed config fields, changed defaults, new required fields |
| Feature gate tracking | Gates promoted Alpha→Beta→Stable→Removed that change defaults |
| GitHub issue/PR scanning | Bugs, regressions, reverted PRs via `gh` CLI |
| Doc validation | Stale docs (field removed upstream), undocumented new fields |
| Test coverage matrix | Per-component AND per-operator-feature coverage report (dedicated/implicit/none) |
| Dependency tracking | Significant version bumps in go.mod |

## Run locally

Before running locally, check `reports/` on `main` — CI commits its reports there directly, so `git pull` may already have what you need instead of spending tokens on a fresh run.

```
# Full regression detection
/otel-regression-detection

# Single detection method (faster, lower cost)
/otel-regression-detection --method changelog

# Analyze a specific release version (uses v3.10 tag in konflux-opentelemetry)
/otel-regression-detection --release-version 3.10
```

## Run in CI

The GitHub Actions workflow (`.github/workflows/regression-detection.yml`) runs automatically roughly every six weeks (1st of Jan/Apr/Jul/Oct, 15th of Feb/May/Aug/Nov, all at 07:57 UTC), regardless of whether the upstream operator version has changed. It invokes the same skill headlessly:

```bash
claude -p "/otel-regression-detection --method changelog" \
  --dangerously-skip-permissions \
  --output-format text \
  --allowedTools "Bash,Read,Write,Edit,Workflow,Agent" \
  --max-budget-usd 25
```

It can also be triggered manually via the **Run workflow** button on the [Actions page](../../actions/workflows/regression-detection.yml).

## Cost controls

- **Budget cap**: $25 per run (enforced via `--max-budget-usd 25`)
- **CI schedule**: runs roughly every six weeks (8 times a year), regardless of whether the upstream operator version changed — reports are large, so more frequent runs would outpace the time needed to act on them
- **Single-method runs**: use `--method <name>` for targeted, lower-cost checks
- **Check CI first**: `git pull` and check `reports/` for a recent enough report before running locally

## Output

Reports are written to `reports/` and committed by CI directly to `main` (also uploaded as a per-run GitHub Actions artifact). Both filenames embed the *upstream* operator version the report analyzes — the latest release tag reachable from origin/main in the operator repo, not the downstream base version:
- `regression-summary-v<operator_version>-YYYY-MM-DD.json` — machine-readable summary counts
- `regression-detection-v<operator_version>-YYYY-MM-DD.md` — Markdown rendering of the findings, readable directly by humans, grouped by severity (Critical/High/Medium/Low) with a Contents section for quick navigation and each finding's metadata rendered as a table. Ends with a **Skill Improvement Recommendations** section listing any deviations the run's agents hit against this skill's own instructions (`None.` if all worked as written) — feedback for improving the skill over time. This is the only report format — there is no HTML report.

## How it stays current

Everything is derived at runtime from `konflux-opentelemetry`:

| What | Source |
|------|--------|
| Component list | `redhat-opentelemetry-collector/manifest.yaml` |
| Collector base version | `manifest.yaml` → `dist.version` |
| Operator base commit | `git submodule status` |
| Release branch | `.gitmodules` |
| Downstream version | `bundle-patch/patch_csv.yaml` |
| Doc coverage | Glob `openshift-docs/otel-collector/modules/*.adoc` |

When `konflux-opentelemetry` is updated for a new release, regression detection automatically picks up the changes.
