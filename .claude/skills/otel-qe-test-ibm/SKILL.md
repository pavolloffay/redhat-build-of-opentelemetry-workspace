---
name: otel-qe-test-ibm
description: Runs OpenTelemetry operator e2e tests on IBM P (ppc64le) and IBM Z (s390x) clusters using chainsaw.
---

# Test OpenTelemetry on IBM P and IBM Z

## Prerequisites

An IBM P or IBM Z cluster must already be provisioned and connected. Request one by contacting the IBM contacts listed in the `rhosdt-team` skill. Use `/otel-qe-prepare-cluster` to verify connectivity.

Use `/otel-qe-deploy` to install the operators. Select Variant B (OLM bundle) for IBM P/Z clusters, and install the extra operators (AMQ Streams, Loki) when prompted — they are required by `tests/e2e-openshift` sub-tests (`kafka`, `otlp-metrics-traces`, `multi-cluster`, `export-to-cluster-logging-lokistack`).

Ensure the `opentelemetry-operator` repository is up-to-date and on the product branch (e.g., `rhosdt-3.10`). The user must provide the release version. Use `/otel-qe-prepare-operator` to prepare the repo — it clones the additional `e2e-otel` tests from `distributed-tracing-qe`.

## Run Tests

Both IBM P (ppc64le) and IBM Z (s390x) run the same reduced test set focused on core collector functionality. Auto-instrumentation, target allocator, OpAMP bridge, and component-specific images are not built for either architecture.

Run each command sequentially, do not run them in parallel. Save the output of each test run to a temporary file (using `tee`) for later analysis.

```bash
chainsaw test \
  --report-name "junit_otel_e2e" \
  --report-path "$ARTIFACT_DIR" \
  --test-dir \
  tests/e2e \
  tests/e2e-autoscale \
  tests/e2e-crd-validations \
  tests/e2e-openshift

chainsaw test \
  --report-name "junit_otel_e2e_sidecar" \
  --report-path "$ARTIFACT_DIR" \
  --selector "$selector" \
  --test-dir \
  tests/e2e-sidecar
```

## Reporting Results

After completing the tests, print a summary of the results. 
