---
name: otel-qe-prepare-operator-tests
description: Prepare the OpenTelemetry operator repository's product branch (rhosdt-x.y) for QE product/pre-GA testing (stage CI jobs, IBM P/Z, and other product-branch test flows) — clones/syncs the branch and applies the modifications it needs for testing. Use when the user asks to prepare, sync, or set up the OpenTelemetry operator repo for product testing.
---

# Prepare OpenTelemetry Operator for Testing

This skill provides instructions for preparing the OpenTelemetry operator repository for product testing.

## When to Use This Skill

Use this skill when:
- Preparing the OpenTelemetry operator repository for product testing
- Setting up additional e2e-otel component tests
- Running local tests with the product branch

## Repository Setup

### Clone and Checkout Product Branch

Ask the user for the release version (e.g. `3.11`) if not provided as an argument. Use `rhosdt-<version>` as the branch name throughout.

Two downstream forks exist:
- `openshift/open-telemetry-opentelemetry-operator` — the ART-era fork, has `rhosdt-3.11` and later
- `os-observability/opentelemetry-operator` — the legacy Konflux fork, has `rhosdt-3.7` through `rhosdt-3.11`

For `rhosdt-3.11+`, use the `openshift` fork. For older versions, use the `os-observability` fork.

```bash
# For rhosdt-3.11+:
git clone git@github.com:openshift/open-telemetry-opentelemetry-operator.git
cd open-telemetry-opentelemetry-operator
git checkout rhosdt-<version>

# For rhosdt-3.10 and earlier:
git clone git@github.com:os-observability/opentelemetry-operator.git os-observability-opentelemetry-operator
cd os-observability-opentelemetry-operator
git checkout rhosdt-<version>
```

If the repo is already present (check for a directory named `open-telemetry-opentelemetry-operator` or `os-observability-opentelemetry-operator` with `origin` pointing at the appropriate fork), `cd` into that directory and sync with the product branch. This clone is disposable test-fixture scratch space, not a place for uncommitted work — confirm that with the user before running `git clean -fd`, since it deletes untracked files:

```bash
cd <the-detected-directory>
git restore .
git clean -fd
git checkout rhosdt-<version>
git pull --rebase origin rhosdt-<version>
```

## Product Branch Modifications

The `rhosdt-<version>` branch must contain the following modifications for product testing:

### Additional e2e-otel Component Tests

Copy the end-to-end tests for OpenTelemetry Collector components from [distributed-tracing-qe](https://github.com/openshift/distributed-tracing-qe/tree/main/tests/e2e-otel) to `tests/e2e-otel/`. These tests provide configuration blueprints and testing patterns for various OpenTelemetry receivers, processors, exporters, and extensions.

### Remove Hardcoded Community Collector Image

Some `OpenTelemetryCollector` CRs across the `tests/` tree — both the freshly-copied `tests/e2e-otel/` tests and pre-existing ones elsewhere (e.g. `tests/e2e/smoke-collector/`, `tests/e2e-openshift/`) — hardcode `image: ghcr.io/open-telemetry/opentelemetry-collector-releases/opentelemetry-collector-contrib:...`. Remove that line wherever it appears under `tests/` so the operator injects its default product image instead. Scope the search and the deletion to `tests/` only — the same string also appears in `docs/` (an unrelated usage example) and in generated `junit_*.xml` reports, neither of which should be touched. Anchor the deletion to the `image:` field itself, not just any line containing the string, in case a future file references it elsewhere (e.g. a comment):

```bash
FILES=$(grep -rl "ghcr.io/open-telemetry/opentelemetry-collector-releases/opentelemetry-collector-contrib" tests/ || true)
if [ -n "$FILES" ]; then
  echo "$FILES" | xargs sed -i '/^\s*image:.*ghcr\.io\/open-telemetry\/opentelemetry-collector-releases\/opentelemetry-collector-contrib/d'
fi
```

### Remove nodeAffinity from Target Allocator Tests

Remove the `ingress-ready` nodeAffinity requirement from the following target allocator test files to allow tests to run on any node:

- `tests/e2e-targetallocator-cr/01-install.yaml`
- `tests/e2e-targetallocator/targetallocator-features/00-assert.yaml`
- `tests/e2e-targetallocator/targetallocator-features/00-install.yaml`

## Verify Modifications

Confirm each modification above actually landed before running any tests — a silent no-op (an empty `tests/e2e-otel/` from a failed copy, a `sed` pattern that matched nothing, a stale `nodeAffinity` block) surfaces later as confusing test failures instead of an obvious setup error. Run all four checks and report each as pass/fail; if any fails, fix the corresponding step above and re-verify before proceeding:

```bash
echo "=== e2e-otel tests copied ==="
COUNT=$(find tests/e2e-otel -name 'chainsaw-test.yaml' 2>/dev/null | wc -l)
echo "$COUNT chainsaw-test.yaml files found"; [ "$COUNT" -gt 0 ] && echo PASS || echo FAIL

echo "=== no hardcoded community image left under tests/ ==="
if grep -rn "ghcr.io/open-telemetry/opentelemetry-collector-releases/opentelemetry-collector-contrib" tests/; then
  echo FAIL
else
  echo PASS
fi

echo "=== no ingress-ready nodeAffinity left in target allocator tests ==="
if grep -n "ingress-ready" \
    tests/e2e-targetallocator-cr/01-install.yaml \
    tests/e2e-targetallocator/targetallocator-features/00-assert.yaml \
    tests/e2e-targetallocator/targetallocator-features/00-install.yaml; then
  echo FAIL
else
  echo PASS
fi

echo "=== files touched by the image-removal sed still parse as valid YAML ==="
FAILED=0
for f in $(git diff --name-only -- tests/ | grep '\.yaml$'); do
  python3 -c "import sys, yaml; list(yaml.safe_load_all(open(sys.argv[1])))" "$f" || { echo "INVALID YAML: $f"; FAILED=1; }
done
[ "$FAILED" -eq 0 ] && echo PASS || echo FAIL
```
