# OBI Receiver

The OBI (OpenTelemetry eBPF Instrumentation) Receiver uses eBPF to instrument applications at the kernel level, producing traces and metrics without code changes or language-specific agents. It inspects processes and the OS networking stack, combining zero-code instrumentation with the Collector's processing capabilities.

The OBI Receiver was introduced in RHOSDT 3.11 as **TP (Technology Preview)** with HTTP traces and RED metrics. All OBI features remain **TP** in 3.12 — the upstream project is `development` stability (v0.x).

## Behavioral Rules

### Deployment Model

1. The OBI Receiver runs as a `daemonset` mode collector with `hostPID: true` and elevated Linux capabilities.
2. The receiver is configured via the `OpenTelemetryCollector` CR's `spec.config.receivers.obi` block. There is no dedicated OBI CRD.
3. All configuration uses the OBI v1 config format.
4. The OBI Receiver requires nodes with `amd64` or `arm64` CPU architecture. It is not available on IBM Z (`s390x`) or IBM Power (`ppc64le`).
5. Users must manually create the SecurityContextConstraints (SCC) as a prerequisite — the operator does not auto-create SCCs for OBI.

### Context Propagation

6. **TP**: The `ebpf.context_propagation` setting enables distributed tracing across OBI-instrumented services.

| Mode | Mechanism | Use case |
|---|---|---|
| `headers` | Reads/writes W3C `traceparent` in HTTP headers | HTTP/gRPC services |
| `tcp` | Propagates context via TCP options | Non-HTTP protocols (Kafka, Redis, etc.) |
| `all` | Both headers and TCP | Mixed-protocol environments |
| `disabled` | No propagation (default) | Isolated per-service spans only |

7. When `context_propagation` is set to `headers` or `all`, OBI injects and extracts W3C Trace Context (`traceparent`) headers in HTTP requests.
8. When set to `tcp` or `all`, OBI propagates context via TCP options for non-HTTP protocols.
9. Context propagation requires no application changes — it is transparent at the eBPF level.
10. The deprecated `ip` mode (upstream) is not documented or supported.

Example configuration:

```yaml
receivers:
  obi:
    ebpf:
      context_propagation: headers
```

### Metrics Features

11. **TP**: OBI supports independently-togglable metrics feature groups via `meter_provider.features`.

| Feature group | Metrics emitted | Notes |
|---|---|---|
| `application` | RED metrics (rate, errors, duration) | Already supported in 3.11 |
| `application_span_otel` | `traces_span_metrics_calls_total`, `traces_span_metrics_duration` (histogram) | Span metrics — equivalent to `spanmetricsconnector` output |
| `application_service_graph` | `traces_service_graph_request_total`, `..._failed_total`, `..._server` (histogram), `..._client` (histogram) | Service graph — equivalent to `servicegraphconnector` output |
| `network` | `obi.network.flow.bytes` | Network flow bytes per flow with src/dst attributes |
| `network_flow_packets` | `obi.network.flow.packets` | Network flow packet count |
| `network_inter_zone` | `obi.network.inter.zone.bytes` | Bytes crossing zone boundaries |
| `stats` | Base TCP stats enablement | Required for TCP sub-features below |
| `stats_tcp_rtt` | `obi.stat.tcp.rtt` (histogram) | Smoothed TCP round-trip time |
| `stats_tcp_retransmits` | `obi.stat.tcp.retransmits` | TCP retransmission count |
| `stats_tcp_io` | `obi.stat.tcp.io` | Socket-layer bytes by direction |
| `stats_tcp_failed_connections` | `obi.stat.tcp.failed.connections` | Failed TCP connections by reason |

12. Each feature group is independently enabled. Multiple features can be active simultaneously.
13. Span metrics and service graph metrics use OTel-canonical metric names, matching the Collector's `spanmetricsconnector` and `servicegraphconnector` output format.
14. Network and TCP stats features require the same eBPF capabilities as the base receiver — no additional privileges needed.

Example configuration:

```yaml
receivers:
  obi:
    meter_provider:
      features:
        - application
        - application_span_otel
        - application_service_graph
        - network
        - stats
        - stats_tcp_rtt
```

#### APM Dashboard Compatibility

15. OBI's span metrics (`application_span_otel` feature) MUST be compatible with the OpenShift APM dashboard that consumes `spanmetricsconnector` output. The metric names and attributes (`span.name`, `span.kind`, `status.code`) must produce the same dashboard experience.
16. [VERIFICATION REQUIRED] The APM dashboard expects `traces_span_metrics_calls` (without `_total` suffix) and `traces_span_metrics_duration_{bucket,count,sum}`. OBI emits `traces_span_metrics_calls_total`. This discrepancy must be verified — either Prometheus normalization handles it, or a relabel config workaround must be documented.

### Extended Service Discovery

17. **TP**: The `discovery.instrument` list supports additional selectors beyond `k8s_namespace` and `k8s_pod_labels` (which were documented in 3.11).

| Selector | Purpose |
|---|---|
| `k8s_deployment_name` | Filter by Deployment name (glob) |
| `k8s_statefulset_name` | Filter by StatefulSet name (glob) |
| `k8s_daemonset_name` | Filter by DaemonSet name (glob) |
| `k8s_pod_name` | Filter by Pod name (glob) |
| `k8s_pod_annotations` | Filter by Pod annotation key-value pairs (glob) |
| `open_ports` | Filter by listening port(s) — comma-separated, ranges supported |
| `exe_path` | Filter by executable path (glob) |
| `languages` | Filter by detected language (`go`, `java`, `python`, `nodejs`, etc.) |

18. The `exclude_instrument` list uses the same selector format to exclude workloads from instrumentation. Exclusion takes precedence over inclusion.
19. `exclude_otel_instrumented_services` (default: `true`) prevents double-instrumentation when traditional auto-instrumentation (Instrumentation CR) is also present.
20. All selectors within a single `instrument` entry are AND-ed — a pod must match all specified fields.
21. Multiple `instrument` entries are OR-ed — a pod matching any entry is instrumented.

Example configuration:

```yaml
receivers:
  obi:
    discovery:
      instrument:
        - k8s_namespace: frontend
          k8s_deployment_name: my-app
          k8s_pod_labels:
            obi.instrument: "true"
        - k8s_namespace: backend
          k8s_pod_annotations:
            app.kubernetes.io/part-of: "my-system"
      exclude_instrument:
        - k8s_namespace: kube-system
      exclude_otel_instrumented_services: true
```

### Log-Trace Correlation

22. **TP**: The `ebpf.log_enricher` feature injects trace context (trace ID, span ID) into application log files on the host filesystem, enabling correlation between traces and logs without application changes.
23. Works with JSON and plain-text log formats.
24. Requires the same host-level privileges as the base OBI receiver — no additional capabilities needed.
25. [VERIFICATION REQUIRED] Must be tested in collector receiver mode (DaemonSet via `OpenTelemetryCollector` CR) before documenting as supported. The upstream v2 design (not yet implemented) flags log enrichment as a standalone-only concern due to its write side-effect (modifying log files on disk). If verification shows it does not work in receiver mode, this feature is removed from the 3.12 scope.

Example configuration:

```yaml
receivers:
  obi:
    ebpf:
      log_enricher:
        enabled: true
```

### k8s-cache — Operator-Managed Metadata Cache

26. **TP**: For large clusters, a centralized Kubernetes metadata cache reduces API server load by replacing per-pod informers with a single shared gRPC service.
27. The k8s-cache is a new container image built by Red Hat (UBI9 base), shipped as a product component alongside the collector, operator, target allocator, and OLM bundle.
28. The k8s-cache is a gRPC service (default port 50055) that runs Kubernetes informers for pods, services, and nodes, streaming events to connected OBI pods via `informer.EventStreamService/Subscribe`.
29. The k8s-cache is optional — when disabled, OBI pods use local in-process informers (current default behavior).

#### Operator Integration

30. The operator manages the k8s-cache lifecycle following the Target Allocator pattern — an embedded struct in the `OpenTelemetryCollector` CRD.

```yaml
apiVersion: opentelemetry.io/v1beta1
kind: OpenTelemetryCollector
metadata:
  name: obi-collector
spec:
  mode: daemonset
  obiMetadataCache:
    enabled: true
    image: <auto-populated by operator>
    replicas: 1
    resources:
      requests:
        cpu: 100m
        memory: 128Mi
```

31. When `obiMetadataCache.enabled: true`, the operator creates: a Deployment running the k8s-cache image, a Service exposing port 50055, and a ServiceAccount with the required ClusterRole/ClusterRoleBinding (`list`+`watch` on pods, services, nodes, replicasets).
32. The operator automatically sets `attributes.kubernetes.meta_cache_address` in the OBI receiver config to point at the cache Service. OBI DaemonSet pods connect to the cache instead of running local informers.
33. The operator owns the full lifecycle — create, update, delete alongside the collector CR.
34. The k8s-cache is only valid when the collector is in `daemonset` mode with an `obi` receiver configured. The operator rejects the config otherwise.
35. The CRD field name `obiMetadataCache` needs alignment with upstream operator conventions. This should be proposed upstream before implementation.

#### Research Task (Prerequisite)

36. [RESEARCH REQUIRED] Before implementing the k8s-cache, profile the API server load from OBI DaemonSet pods running local informers on representative OCP cluster sizes (e.g., 10-node, 50-node, 200-node). Measure: number of API server requests/watches, memory per OBI pod spent on informer state, total cluster-wide resource overhead. Compare against a single k8s-cache deployment. Determine the cluster size threshold where the cache provides meaningful savings.
37. Documentation must include sizing guidance: when to enable the cache (cluster size threshold), expected resource savings, and recommended cache resource allocation.

#### Productization

38. A new Dockerfile must be added to `konflux-opentelemetry` following the existing UBI9 base pattern.
39. A new Konflux Application/Component definition is required alongside the existing collector/operator/TA/bundle components.
40. The k8s-cache image must be added to FBC catalogs.
41. Multi-arch builds: amd64 and arm64 only, matching OBI receiver constraints.

## Configuration Surface

| Field | Type | Default | Description |
|---|---|---|---|
| `spec.config.receivers.obi.ebpf.context_propagation` | string | `disabled` | Distributed trace context propagation mode |
| `spec.config.receivers.obi.ebpf.log_enricher.enabled` | bool | `false` | Inject trace/span IDs into application logs |
| `spec.config.receivers.obi.meter_provider.features` | list | `[application]` | Metrics feature groups to enable |
| `spec.config.receivers.obi.discovery.instrument` | list | — | Workload inclusion selectors |
| `spec.config.receivers.obi.discovery.exclude_instrument` | list | — | Workload exclusion selectors |
| `spec.config.receivers.obi.discovery.exclude_otel_instrumented_services` | bool | `true` | Skip already-instrumented services |
| `spec.obiMetadataCache.enabled` | bool | `false` | Deploy operator-managed k8s metadata cache |
| `spec.obiMetadataCache.image` | string | auto | k8s-cache container image override |
| `spec.obiMetadataCache.replicas` | int | 1 | Cache deployment replicas |
| `spec.obiMetadataCache.resources` | ResourceRequirements | — | Cache pod resource requests/limits |

## Constraints

1. The OBI Receiver requires `daemonset` mode. The operator must reject OBI receiver configs in other modes.
2. The OBI Receiver requires `hostPID: true` and elevated Linux capabilities (BPF, SYS_PTRACE, NET_RAW, CHECKPOINT_RESTORE, DAC_READ_SEARCH, PERFMON). Users must create the SCC manually.
3. The OBI Receiver is not available on s390x or ppc64le architectures.
4. All OBI features are TP. The upstream OBI project is v0.x with `development` stability — breaking changes between minor releases are expected.
5. The collector distro pins OBI at a specific version via `manifest.yaml` in `redhat-opentelemetry-collector`. The version will be bumped for 3.12.
6. The k8s-cache communicates with OBI pods over insecure gRPC (no TLS). Both components run within the same cluster.

## Planned Changes

| Ticket | Summary |
|---|---|
| [PLANNED] | Context propagation — `ebpf.context_propagation` support (TP) |
| [PLANNED] | Metrics features — span metrics, service graph, network flow, TCP stats (TP) |
| [PLANNED] | APM dashboard compatibility verification for OBI span metrics |
| [PLANNED] | Extended service discovery — additional workload selectors (TP) |
| [PLANNED] | Log-trace correlation — `ebpf.log_enricher` with receiver-mode verification (TP) |
| [PLANNED] | k8s-cache — new container image, operator-managed deployment (TP) |
| [PLANNED] | k8s-cache sizing research — API server load profiling on representative OCP clusters |
