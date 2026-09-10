## CI Jobs in Release Repository

The OpenShift CI jobs for OpenTelemetry stage testing are defined in the `release` repository:

**Location:** `ci-operator/config/openshift/open-telemetry-opentelemetry-operator/`

**File naming pattern:**
```
openshift-open-telemetry-opentelemetry-operator-main__opentelemetry-product-ocp-{VERSION}[-{VARIANT}]-stage.yaml
```
The `-{VARIANT}` segment is omitted entirely for Regular (e.g. `...ocp-4.19-stage.yaml`, not `...ocp-4.19--stage.yaml`).

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

**Disconnected test job:** lives in a different project directory in the same `release` repo, not the one above — `ci-operator/config/openshift/distributed-tracing-qe/openshift-distributed-tracing-qe-main__ocp-4.16-disconnected.yaml`, job name `periodic-ci-openshift-distributed-tracing-qe-main-ocp-4.16-disconnected-distributed-tracing-tests-disconnected`. It needs both `MULTISTAGE_PARAM_OVERRIDE_OTEL_INDEX_IMAGE` and `MULTISTAGE_PARAM_OVERRIDE_TEMPO_INDEX_IMAGE` updated the same way as the other configs — it's part of the same PR, just a different file. Its `cron: 0 0 30 2 *` (an impossible date) is intentional: every one of these jobs is on-demand only, triggered via `/pj-rehearse` or Gangway, never on a schedule.
