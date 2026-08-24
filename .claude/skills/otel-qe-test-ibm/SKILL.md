---
name: otel-qe-test-ibm
description: Runs OpenTelemetry operator e2e tests on IBM P (ppc64le) and IBM Z (s390x) clusters using chainsaw.
---

# Test OpenTelemetry on IBM P and IBM Z

## Prerequisites

An IBM P or IBM Z cluster must already be provisioned and connected. Request one by contacting the IBM contacts listed in the `rhosdt-team` skill. Use `/otel-qe-prepare-cluster` to verify connectivity.

The OpenTelemetry operator must be installed on the cluster. Use `/otel-qe-prepare-operator` to install it. Verify that the installed operator version matches the release version.

Ensure the `opentelemetry-operator` repository is up-to-date and on the product branch (e.g., `rhosdt-3.10`). The user must provide the release version.

Clone the additional OTEL component tests into the operator repo:
```bash
git clone https://github.com/openshift/distributed-tracing-qe.git /tmp/distributed-tracing-qe && cp -r /tmp/distributed-tracing-qe/tests/e2e-otel ./tests/
```

## Cluster Setup

Before running tests, apply required cluster configuration:

```bash
# Enable user workload monitoring
oc apply -f tests/e2e-openshift/otlp-metrics-traces/01-workload-monitoring.yaml

# Install Prometheus ScrapeConfig CRD
kubectl create -f https://raw.githubusercontent.com/prometheus-operator/prometheus-operator/main/example/prometheus-operator-crd/monitoring.coreos.com_scrapeconfigs.yaml

# Unset NAMESPACE to avoid conflicts
unset NAMESPACE
```

## Determine Sidecar Selector

```bash
oc_version=$(oc get clusterversion version -o jsonpath='{.status.desired.version}' 2>/dev/null || true)
oc_version_major=$(echo "$oc_version" | cut -d . -f 1)
oc_version_minor=$(echo "$oc_version" | cut -d . -f 2)
selector="sidecar=legacy"
if [[ -n "$oc_version_major" ]] && { [[ "$oc_version_major" -ge 5 ]] || { [[ "$oc_version_major" -eq 4 ]] && [[ "$oc_version_minor" -ge 16 ]]; }; }; then
  selector="sidecar=native"
fi
```

## Run Tests

Both IBM P (ppc64le) and IBM Z (s390x) run the same reduced test set focused on core collector functionality. Auto-instrumentation, target allocator, OpAMP bridge, and component-specific images are not built for either architecture.

Run each command sequentially, do not run them in parallel. Save the output of each test run to a temporary file (using `tee`) for later analysis.

```bash
chainsaw test \
  --report-name "junit_otel_e2e" \
  --report-path "$ARTIFACT_DIR" \
  --report-format "XML" \
  --test-dir \
  tests/e2e \
  tests/e2e-autoscale \
  tests/e2e-crd-validations \
  tests/e2e-openshift

chainsaw test \
  --report-name "junit_otel_e2e_sidecar" \
  --report-path "$ARTIFACT_DIR" \
  --report-format "XML" \
  --selector "$selector" \
  --test-dir \
  tests/e2e-sidecar
```

**Skipped test suites** (not supported on ppc64le/s390x — images not built for these architectures):
- `tests/e2e-instrumentation/*` — auto-instrumentation images unavailable
- `tests/e2e-multi-instrumentation/*` — depends on unavailable instrumentation images
- `tests/e2e-targetallocator/*` — target allocator image unavailable
- `tests/e2e-targetallocator-cr/*` — target allocator CR image unavailable
- `tests/e2e-otel/*` — additional OTEL component tests not supported
- `tests/e2e-opampbridge/*` — OpAMP bridge image unavailable
- `tests/e2e-pdb/*` — PDB tests not supported
- `tests/e2e-prometheuscr/*` — PrometheusCR tests not supported
- `tests/e2e-openshift/must-gather` — not supported

## Metadata Filters Tests

After running the main test suites above, patch the operator CSV to add metadata filter env vars, then run the metadata filters test suite.

```bash
OTEL_CSV_NAME=$(oc get csv -n opentelemetry-operator-system | grep "opentelemetry-operator" | awk '{print $1}')
oc -n opentelemetry-operator-system patch csv $OTEL_CSV_NAME --type=json -p '[
  {"op":"add","path":"/spec/install/spec/deployments/0/spec/template/spec/containers/0/env/-","value":{"name":"ANNOTATIONS_FILTER","value":".*filter.out,config.*.gke.io.*"}},
  {"op":"add","path":"/spec/install/spec/deployments/0/spec/template/spec/containers/0/env/-","value":{"name":"LABELS_FILTER","value":".*filter.out"}}
]'
sleep 60
oc -n opentelemetry-operator-system wait --for condition=Available deployment opentelemetry-operator-controller-manager --timeout=120s

chainsaw test \
  --report-name "junit_otel_metadata_filters" \
  --report-path "$ARTIFACT_DIR" \
  --report-format "XML" \
  --test-dir \
  tests/e2e-metadata-filters
```

## Reporting Results

After completing the tests, print a summary of the results and add a comment to the Jira issue.
