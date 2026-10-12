---
name: otel-qe-test-ibm
description: Runs OpenTelemetry operator e2e tests on IBM P (ppc64le) and IBM Z (s390x) clusters using chainsaw. Use when the user asks to run operator tests on IBM P or IBM Z.
---

# Test OpenTelemetry on IBM P and IBM Z

## Prerequisites

An IBM P or IBM Z cluster must already be provisioned and connected. Request one by contacting the IBM contacts listed in the `rhosdt-team` skill. Use `/otel-qe-prepare-cluster` to verify connectivity. Skip requesting/provisioning if a cluster is already logged in.

### Clean up leftover installs from a prior test run

If the cluster was used for testing before, check for leftover operators before installing anything new — a stale install can silently break the new one:

```bash
oc get csv -A | grep -E "kiali-operator|servicemeshoperator3|tempo-operator"
```

If found, delete the example CRs first (so operator finalizers clean up managed resources), then the Subscription/CSV/InstallPlan for each, then the dedicated namespaces they left behind (typically `istio-system`, `istio-cni`, `ztunnel`, `tracing-system`, `openshift-tempo-operator`). Confirm scope with the user before deleting — this touches cluster-wide state.

**Also check for conflicting image mirror objects.** A leftover `ImageDigestMirrorSet`/`ImageTagMirrorSet` from an unrelated prior test run (e.g. Istio/Sail e2e, Gateway API Inference Extension conformance) can duplicate a mirror source across objects with different policies. When that happens, the Machine Config Operator silently refuses to render **any** registry mirror config to nodes — including the Tempo/OTEL `ImageDigestMirrorSet`s installed below — which shows up later as `ImagePullBackOff`/`manifest unknown` on the freshly installed operator pods. Check for it early:

```bash
oc logs -n openshift-machine-config-operator deployment/machine-config-controller --tail=50 | grep -i "conflicting mirrorSourcePolicy"
```

If found, identify the old/unrelated `ImageDigestMirrorSet`/`ImageTagMirrorSet` objects sharing a source and delete them (confirm with the user first). The MCO then rolls a new MachineConfig to every node — this reboots the whole cluster (masters first, then workers) and takes 15-30+ minutes. Poll `oc get mcp` until both `master` and `worker` pools show `UPDATED=True` before continuing.

### Install the operators

Use `/otel-qe-deploy-stage-build` to install the operators. Install OTEL from the ART FBC catalog — the catalog image is built for ppc64le and s390x, so the same path as on amd64 applies, and it needs the stage registry credentials and mirror from that skill's Step 1. If the operator pod fails to pull or start with `exec format error`, check whether the image it runs has a manifest for the cluster's architecture (`skopeo inspect --raw`) before debugging further, and tell the user. Install Tempo from `redhat-operators` (`tempo-redhat-operators.yaml` in that skill; use the Tempo OLM bundle only when a Tempo stage release is under test, the Tempo FBC fragment is amd64 only), and install the extra operators (AMQ Streams, Loki, Red Hat OpenShift Logging) when prompted — they are required by `tests/e2e-openshift` sub-tests (`kafka`, `otlp-metrics-traces`, `multi-cluster`, `export-to-cluster-logging-lokistack`). Loki alone is not enough for `export-to-cluster-logging-lokistack`: the test also needs the `openshift-logging` namespace, which comes from installing the Red Hat OpenShift Logging (cluster-logging) operator. Skip deploying the example instance — the chainsaw suites create their own resources per test case. The OTEL operator must be in `opentelemetry-operator-system`, which the skill's `otel.yaml` does; the suites assume that namespace. Check that every operator CSV is `Succeeded` (`oc get csv -A | grep -v packageserver`) before running tests. A cluster set up like this had OTEL `v0.158.0-3`, Tempo `v0.22.0-2`, COO, AMQ Streams, Loki and cluster-logging `Succeeded` on OCP 4.22 ppc64le.

### Prepare the operator repo

Ensure the `opentelemetry-operator` repository is up-to-date and on the product branch (e.g., `rhosdt-0.158`). The user must provide the release version. Check whether a clone already exists and is already prepared (on the product branch, with `tests/e2e-otel/` populated, and the target-allocator `nodeAffinity` removed) before re-running `/otel-qe-prepare-operator-tests` — it may already be done in a different local clone. Run that skill's verification block either way. `rhosdt-0.158` has no hardcoded `ghcr.io/open-telemetry/opentelemetry-collector-releases/opentelemetry-collector-contrib` image left since the four `smoke-collector*` and `export-to-cluster-logging-lokistack` lines were removed from the branch; if the check fails on another branch, those tests run the community collector instead of the product one until the skill's `sed` is applied. That `sed -i` is the GNU form: on macOS use `gsed -i`, or `sed -i ''` with BSD sed.

## Run Tests

Both IBM P (ppc64le) and IBM Z (s390x) run the same reduced test set focused on core collector functionality. Auto-instrumentation, target allocator, OpAMP bridge, and component-specific images were not built for either architecture when this set was chosen. On OCP 4.22 ppc64le the `smoke-targetallocator` test and the Node.js auto-instrumentation image in `must-gather` worked, so the set may be extendable; that is untested here.

Run `unset NAMESPACE` first, as the CI step does, and set `ARTIFACT_DIR` before running (e.g. `mkdir -p /tmp/ibm-artifacts && export ARTIFACT_DIR=/tmp/ibm-artifacts`) if it isn't already set by the CI environment.

The sidecar suite's `--selector` isn't a fixed value — it depends on the cluster's Kubernetes version (mirrors the `CHAINSAW_SELECTOR` logic in the operator repo's `Makefile`): `sidecar=native` if the server Kubernetes version is >= 1.29, otherwise `sidecar=legacy`:

```bash
KUBE_VERSION=$(oc version -o json | jq -r '.serverVersion.gitVersion' | grep -oE '[0-9]+\.[0-9]+' | head -1)
if [ "$(printf '%s\n' "$KUBE_VERSION" "1.29" | sort -V | head -n1)" = "1.29" ]; then
  SELECTOR="sidecar=native"
else
  SELECTOR="sidecar=legacy"
fi
```

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
  --selector "$SELECTOR" \
  --test-dir \
  tests/e2e-sidecar
```

## Known Expected Failures on IBM P/Z

Only these fail on every run on these architectures and are not regressions — don't spend time debugging them further, just confirm they still fail for the expected reason:

- `smoke-collector-obi` and `smoke-collector-obi-unprivileged` — the `obi-collector` DaemonSet never gets all its pods ready (`numberReady != desiredNumberScheduled`), about 400 s per test. The `obi` receiver is eBPF-based and not supported on ppc64le/s390x.

Reference result, OTEL `v0.158.0-3` from the ART FBC on OCP 4.22.12 ppc64le: the first command above had 35 passed and 4 failed (the two `obi` tests, `must-gather` and `multi-cluster`), and the sidecar command 2 passed. `must-gather` and `multi-cluster` are not architecture failures: each failed once in the full run and passed when rerun alone (`chainsaw test --skip-delete --test-dir tests/e2e-openshift/<name>`, 3.5 and 1.6 minutes). In the full run `must-gather` was missing `stateful-targetallocator.yaml` from its output, and the `multi-cluster` `verify-traces-*` Jobs never found more than one trace. Both look like timing under the suite's parallel load. Always rerun a failure in isolation before filing a bug. A `must-gather` failure with `exec format error` on the Node.js auto-instrumentation init container was seen on earlier builds; it did not occur here, where that image started on ppc64le.

`autoscale` has been observed to fail intermittently with `no metrics returned from resource metrics API` (HPA/metrics-server timing on the cluster, not a collector bug) — rerun it in isolation before filing a bug.

For any other failure, check whether it's a genuine product bug, a test bug, or an environment/test-setup gap (e.g. a required operator or namespace missing, or the operator not in `opentelemetry-operator-system`) before filing — see `export-to-cluster-logging-lokistack` above for an example of the latter.

## Reporting Results

After completing the tests, print a summary of the results, calling out which failures (if any) match the known-expected list above vs. new/unexplained ones.
