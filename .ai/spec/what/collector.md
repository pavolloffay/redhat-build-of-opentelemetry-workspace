# Collector

The OpenTelemetry Collector is a vendor-agnostic telemetry pipeline that receives, processes, and exports traces, metrics, and logs. The Red Hat distribution includes a curated subset of upstream components selected via a declarative manifest. Each component has an explicit support level: GA, TP, or not supported (present in source but undocumented).

## Behavioral Rules

### Pipeline Architecture

1. A collector pipeline flows: Receivers → Processors → Exporters.
2. Connectors bridge two pipelines, acting as both exporter (from source pipeline) and receiver (to destination pipeline).
3. Extensions provide non-pipeline capabilities (health checks, authentication, storage).
4. The Service section of the config defines which pipelines exist and which components they use.

### Component Selection (Red Hat Distro)

5. The Red Hat distro selects components from upstream core and contrib via `manifest.yaml` in `redhat-opentelemetry-collector`.
6. The OpenTelemetry Collector Builder (OCB) generates Go source from `manifest.yaml` and compiles the binary.
7. Generated source is committed to `_build/` so ART builds can compile from pre-generated sources.

### Receivers

The distro includes 15 receivers in source. Support levels per documentation:

| Receiver | Support Level | Notes |
|---|---|---|
| OTLP | **GA** | |
| Jaeger | **GA** | |
| Host Metrics | **GA** | |
| Prometheus | **GA** | |
| Zipkin | **GA** | |
| Kafka | **GA** | Promoted from TP in 3.10.0 |
| Filelog | **GA** | |
| Kubernetes Events | **GA** | Promoted from TP in 3.9.0 |
| Kubernetes Objects | **GA** | Promoted from TP in 3.10.0 |
| Kubelet Stats | **GA** | |
| Prometheus Remote Write | **TP** | |
| OTLP JSON File | **TP** | |
| Journald | **TP** | |
| Kubernetes Cluster | **TP** | |
| OBI | **TP** | Added in 3.11.0. eBPF-based zero-code instrumentation. See `what/obi.md`. |

### Exporters

The distro includes 12 exporters in source. Support levels per documentation:

| Exporter | Support Level | Notes |
|---|---|---|
| OTLP gRPC | **GA** | Name `otlp` deprecated in 3.9.0 in favor of `otlp_grpc` |
| OTLP HTTP | **GA** | Name `otlphttp` deprecated in 3.9.0 in favor of `otlp_http` |
| Debug | **GA** | |
| Prometheus | **GA** | Promoted from TP in 3.9.0 |
| Prometheus Remote Write | **GA** | Promoted from TP in 3.9.0/3.10.0 |
| Kafka | **GA** | |
| Load Balancing | **TP** | |
| AWS CloudWatch Logs | **TP** | |
| AWS EMF | **TP** | |
| AWS X-Ray | **TP** | |
| File | **TP** | |
| Google Cloud | **TP** | Deprecated in 3.11.0; use OTLP HTTP Exporter + Google Client Auth Extension instead |

### Processors

The distro includes 14 processors in source. Support levels per documentation:

| Processor | Support Level | Notes |
|---|---|---|
| Batch | **GA** | |
| Memory Limiter | **GA** | |
| Attributes | **GA** | |
| Resource | **GA** | |
| Kubernetes Attributes | **GA** | |
| Filter | **GA** | Promoted from TP in 3.9.0 |
| Transform | **GA** | Promoted from TP in 3.9.0 |
| Tail Sampling | **GA** | Promoted from TP in 3.10.0 |
| Probabilistic Sampling | **GA** | Promoted from TP in 3.10.0 |
| Metric Start Time | **GA** | Introduced in 3.9.0 |
| Resource Detection | **TP** | |
| Span | **TP** | |
| Cumulative-to-Delta | **TP** | |
| Group-by-Attributes | **TP** | |

### Connectors

The distro includes 4 connectors in source. Support levels per documentation:

| Connector | Support Level | Notes |
|---|---|---|
| Span Metrics | **GA** | |
| Count | **TP** | |
| Routing | **TP** | |
| Forward | **TP** | |

### Extensions

The distro includes 11 extensions in source. Support levels per documentation:

| Extension | Support Level | Notes |
|---|---|---|
| Bearer Token Auth | **GA** | |
| Google Client Auth | **GA** | |
| OAuth2 Client | **TP** | |
| File Storage | **TP** | |
| OIDC Auth | **TP** | |
| Headers Setter | **Not supported** | Present in source but not documented |
| Jaeger Remote Sampling | **TP** | |
| Performance Profiler (pprof) | **TP** | |
| Health Check | **TP** | |
| zPages | **TP** | |
| Memory Limiter (extension) | **Not supported** | Present in source but not documented |

### Configuration

8. In the v1beta1 API, collector config is a structured object with typed fields for receivers, exporters, processors, connectors, extensions, and service.
9. In the deprecated v1alpha1 API, collector config is a raw YAML string.

### Receiving OpenShift Monitoring Metrics via Remote Write v2

The in-cluster (platform) and user workload monitoring (UWM) Prometheus instances export their metrics to the collector with Prometheus remote write v2; the collector forwards them to any backend (OTLP, vendor exporters). Technology Preview in RHOSDT 3.12 (TRACING-4524); GA is planned for the next release with the monitoring team (TRACING-6928). Verified on OpenShift 5.0 (TRACING-6909); design in `docs/superpowers/specs/2026-10-18-ocp-monitoring-metrics-export-design.md`; PoC manifests and the sizing benchmark harness in github.com/IshwarKanse/demo `otel-ocp-metrics-export`.

10. The monitoring side is configured only through the Cluster Monitoring Operator config maps: `cluster-monitoring-config` (`prometheusK8s.remoteWrite`) and `user-workload-monitoring-config` (`prometheus.remoteWrite`) with `messageVersion: V2.0`. `messageVersion` exists since OpenShift 5.0; on earlier versions only the federation endpoint (Prometheus receiver) is available.
11. The collector side uses the `prometheus_remote_write` receiver (TP; `prometheusremotewrite` is a deprecated alias). The receiver accepts only the v2 message. The receiver port must be listed in `spec.ports` of the `OpenTelemetryCollector` CR because the operator does not infer it. The receiver keeps the resource attributes of each job/instance pair in an LRU cache of 1000 entries; contrib v0.164.0 makes it configurable (`resource_cache_size`) and adds an eviction counter (TRACING-6926), which the product collector gets with the next productised contrib release.
12. In the Technology Preview, CMO does not expose `metadata-wal-records`, `scrapeNativeHistograms`, `convertClassicHistogramsToNHCB` or `remoteWrite[].sendNativeHistograms`, and Prometheus 3.10.0 to 3.15.0 write no metadata WAL records even with the flag (OpenShift 5.0 ships 3.13): all series arrive with an unspecified type and are emitted as untyped gauges (counters, classic histogram `_bucket`/`_sum`/`_count` and summary quantiles included); native histograms are not exported. No series is dropped. The documentation marks the flow as Technology Preview, lists these limitations and advises exporting a targeted subset (for example `ALERTS` and recording rule results). The CMO settings and the Prometheus fix are GA tasks of TRACING-6928 (TRACING-6929 to TRACING-6932).
13. Both replicas of each Prometheus instance send every sample; they differ only in the `prometheus_replica` label. Deduplication is the backend's job.
14. Documented resilience settings for the exporter: `retry_on_failure.max_elapsed_time: 0`, `sending_queue.sizer: items` with a bounded `queue_size`, `block_on_overflow: true` and exporter-side `sending_queue.batch` instead of the batch processor, plus the `memory_limiter` processor. With the defaults a 5 minute backend outage OOM-killed the collector and dropped batches; with these settings back-pressure reaches Prometheus, which retries from its WAL, and no sample is lost.
15. No additional collector component is needed: the receiver, the OTLP exporters, `memory_limiter`, `filter`, `resource` and `transform` are in the 0.158 distro manifest.
16. AWS CloudWatch is a validated third-party backend for this flow through the AWS EMF exporter (`awsemf`, TP); the receiver maps the Prometheus `job`/`instance` labels to the `service.name`/`service.instance.id` resource attributes, which become CloudWatch dimensions. The `awsemf` exporter has no `sending_queue`/`retry_on_failure` settings (it retries itself through `max_retries`).
17. Sizing (product collector 0.158.0, OpenShift 5.0): about 1 CPU core per 100,000 samples/s and under 250 MiB in steady state per replica; documented requests 500m / 512Mi and limits 2 CPU / 2Gi (the limits absorb the recovery burst after a backend outage); one replica up to 95,000 samples/s (measured 2026-10-20: 1.06 cores at 96,000 samples/s), add replicas beyond that; the docs present the figures as a table by remote write rate.
18. Once series arrive typed, the receiver drops typed classic histogram series and all summary series. Before contrib#52252 (TRACING-6927) it also left them out of the written response headers, so Prometheus counted them as failed samples and `PrometheusRemoteStorageFailures` fired; with the fix they count as written but are still not exported, so the GA configuration keeps classic histogram and summary series off the v2 stream (TRACING-6932).

## Summary

| Category | GA | TP | Not Supported |
|---|---|---|---|
| Receivers | 10 | 5 | 0 |
| Exporters | 6 | 6 | 0 |
| Processors | 10 | 4 | 0 |
| Connectors | 1 | 3 | 0 |
| Extensions | 2 | 7 | 2 |
| **Total** | **29** | **25** | **2** |

## Configuration Surface

| Field | Type | Default | Description |
|---|---|---|---|
| spec.config.receivers | map | — | Receiver configurations keyed by name |
| spec.config.processors | map | — | Processor configurations keyed by name |
| spec.config.exporters | map | — | Exporter configurations keyed by name |
| spec.config.connectors | map | — | Connector configurations keyed by name |
| spec.config.extensions | map | — | Extension configurations keyed by name |
| spec.config.service.pipelines | map | — | Pipeline definitions mapping signal types to component names |
| spec.config.service.extensions | list | — | Extensions to enable |

### Planned Components

| Component | Type | Support Level | Ticket |
|---|---|---|---|
| Signature Validation | Processor | **[PLANNED: TRACING-6499]** TP | Validates non-repudiation signatures on incoming spans. See `what/signing.md`. |
| Log Deduplication | Processor | **[PLANNED: TRACING-6697]** TP | Aggregates identical logs over a time interval. See `what/collector-3.12-components.md`. |
| Syslog | Exporter | **[PLANNED: TRACING-6788]** TP | Exports logs via syslog protocol (RFC 5424/3164). See `what/collector-3.12-components.md`. |
| Webhook Event | Receiver | **[PLANNED: TRACING-6641]** TP | Receives logs over HTTP webhooks. New in 3.12: it is not in any 3.11 build (`manifest.yaml`, release notes and docs have no entry). See `what/collector-3.12-components.md`. |

### Excluded Components (Evaluated and Rejected)

| Component | Type | Reason | Ticket |
|---|---|---|---|
| Logs Transform | Processor | Upstream stability `development` (lowest tier). Explicitly slated for deprecation (#19775). Not in any upstream distribution. Use the Transform Processor (GA) + OTTL instead. | TRACING-6698 (cancelled) |

## Constraints

1. Adding or removing a component from the Red Hat distro requires updating `manifest.yaml` in `redhat-opentelemetry-collector` and regenerating `_build/`.
2. Each component has independent stability levels per signal (e.g., a receiver can be Stable for traces but Alpha for metrics).
3. The collector binary exposes OTLP gRPC on port 4317 by default.
4. The OpenCensus Receiver was removed in version 3.9.0.
