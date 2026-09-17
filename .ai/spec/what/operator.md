# Operator

The OpenTelemetry Operator is a Kubernetes operator that manages the lifecycle of OpenTelemetry Collector instances, auto-instrumentation injection, target allocation, and OpAMP bridge on OpenShift. It defines five CRDs, but not all are documented or supported.

## Behavioral Rules

### CRDs

| CRD | API Version | Support Level | Notes |
|---|---|---|---|
| OpenTelemetryCollector | v1beta1 (storage version) | **GA** | Short names: `otelcol`, `otelcols` |
| Instrumentation | v1alpha1 | **TP** | See `what/auto-instrumentation.md`. Short names: `otelinst`, `otelinsts` |
| TargetAllocator | v1alpha1 (standalone) | **GA** | See `what/target-allocator.md`. Promoted from TP in 3.9.0 |
| OpAMPBridge | v1alpha1 | **Not supported** | Present in source, not documented |
| ClusterObservability | v1alpha1, cluster-scoped | **Not supported** | Present in source, not documented |

### Collector Modes

All four collector modes are **GA**:

1. Deployment mode (default): standard Kubernetes Deployment with configurable replicas.
2. DaemonSet mode: one collector pod per node.
3. StatefulSet mode: supports persistent storage via VolumeClaimTemplates.
4. Sidecar mode: injected into application pods. Sidecar mode prohibits tolerations, priorityClassName, affinity, and additionalContainers.

### Management State

5. **GA**: When `managementState` is `managed` (default), the operator reconciles the CR and manages all child resources.
6. **GA**: When `managementState` is `unmanaged`, the operator stops reconciling — the user controls child resources directly.

### Autoscaling

7. **GA**: HPA-based autoscaling is supported with CPU/memory utilization targets and custom metrics.
8. MinReplicas, MaxReplicas, and scaling behavior are configurable.

### Networking

9. **GA**: Ingress, HTTPRoute, and NetworkPolicy resources can be configured per collector instance.

### API Versioning

10. v1beta1 is the stable storage version for OpenTelemetryCollector.
11. v1alpha1 OpenTelemetryCollector is deprecated; its config field is a raw string, not structured.

### Operator Configuration

12. **GA**: The operator supports configuration via environment variables:
    - `OPENSHIFT_CREATE_DASHBOARD`: controls Grafana dashboard creation.
    - `ENABLE_CR_METRICS`: enables custom resource metrics.
    - `CREATE_SM_OPERATOR_METRICS`: creates ServiceMonitor for operator metrics.
    - `FEATURE_GATES`: enables/disables feature gates.
13. **GA**: The operator automatically creates RBAC resources required by collector components.

### TLS

14. **GA**: The operator adheres to cluster TLS security profiles (introduced in 3.10.0).

### Features Not Supported

15. **Not supported**: OpAMPBridge — present in source but not documented. It connects to an OpAMP server endpoint and manages collector configurations.
16. **Not supported**: ClusterObservability CRD — present in source but not documented. Provides a simplified cluster-wide OTLP endpoint.

## Configuration Surface

| Field | Type | Default | Description | Support |
|---|---|---|---|---|
| spec.mode | Enum | `deployment` | Collector scheduling mode | **GA** |
| spec.replicas | int | 1 | Number of collector replicas | **GA** |
| spec.managementState | Enum | `managed` | Whether operator reconciles this CR | **GA** |
| spec.config | Structured | — | Collector pipeline configuration | **GA** |
| spec.targetAllocator.enabled | bool | false | Enable embedded target allocator | **GA** |
| spec.autoscaler | Object | — | HPA configuration | **GA** |
| spec.ingress | Object | — | Ingress configuration | **GA** |
| spec.configVersions | int | 3 | Number of config versions to retain | **GA** |

## Planned Changes

| Ticket | Summary |
|---|---|
| [PLANNED: needs ticket] | Register `webhook_event` receiver parser in `internal/components/receivers/helpers.go` with default port 8088 and alias `webhookeventreceiver`. Enables automatic Service port creation. See `what/collector-3.12-components.md`. |

## Constraints

1. The operator depends on `openshift/api` for OpenShift-specific integrations.
2. CRD types live in `apis/v1alpha1/` and `apis/v1beta1/` in the `opentelemetry-operator` repo.
3. E2E tests use the Chainsaw framework in the `tests/` directory.
