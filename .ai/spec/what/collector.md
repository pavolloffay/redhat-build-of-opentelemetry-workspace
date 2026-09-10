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
7. Generated source is committed to `_build/` so downstream Konflux builds can compile from pre-generated sources.

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
| Webhook Event | **TP** | Added in 3.11.0. Beta upstream for logs. |
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

The distro includes 10 extensions in source. Support levels per documentation:

| Extension | Support Level | Notes |
|---|---|---|
| Bearer Token Auth | **GA** | |
| Google Client Auth | **GA** | |
| OAuth2 Client | **TP** | |
| File Storage | **TP** | |
| OIDC Auth | **TP** | |
| Jaeger Remote Sampling | **TP** | |
| Performance Profiler (pprof) | **TP** | |
| Health Check | **TP** | |
| zPages | **TP** | |
| Memory Limiter (extension) | **Not supported** | Present in source but not documented |

### Configuration

8. In the v1beta1 API, collector config is a structured object with typed fields for receivers, exporters, processors, connectors, extensions, and service.
9. In the deprecated v1alpha1 API, collector config is a raw YAML string.

## Summary

| Category | GA | TP | Not Supported |
|---|---|---|---|
| Receivers | 10 | 5 | 0 |
| Exporters | 6 | 6 | 0 |
| Processors | 10 | 4 | 0 |
| Connectors | 1 | 3 | 0 |
| Extensions | 2 | 7 | 1 |
| **Total** | **29** | **25** | **1** |

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

## Constraints

1. Adding or removing a component from the Red Hat distro requires updating `manifest.yaml` in `redhat-opentelemetry-collector` and regenerating `_build/`.
2. Each component has independent stability levels per signal (e.g., a receiver can be Stable for traces but Alpha for metrics).
3. The collector binary exposes OTLP gRPC on port 4317 by default.
4. The OpenCensus Receiver was removed in version 3.9.0.
