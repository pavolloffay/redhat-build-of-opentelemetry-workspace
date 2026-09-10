# Repo Map

Lookup table: concern → repo(s) → spec file(s). Use this to find where to go when updating specs or implementing a feature.

## Collector — Core

| Concern | Repo | Spec Files |
|---|---|---|
| Core collector pipeline (receivers, processors, exporters, connectors) | opentelemetry-collector | `what/collector.md` |
| Pipeline data model (pdata) | opentelemetry-collector | `what/collector.md` |
| Configuration framework (confmap) | opentelemetry-collector | `what/collector.md` |

## Collector — Contrib

| Concern | Repo | Spec Files |
|---|---|---|
| Community receivers, processors, exporters, connectors | opentelemetry-collector-contrib | `what/collector.md` |

## Collector — Red Hat Distribution

| Concern | Repo | Spec Files |
|---|---|---|
| Component selection (which contrib components to include) | redhat-opentelemetry-collector | `what/collector.md`, `how/build-pipeline.md` |
| OCB build and `_build/` generation | redhat-opentelemetry-collector | `how/build-pipeline.md` |
| RPM packaging | redhat-opentelemetry-collector | `what/productization.md` |
| Non-repudiation signing (SDK + collector processor) | redhat-opentelemetry-collector | `what/signing.md` |
| OBI receiver (eBPF instrumentation) | redhat-opentelemetry-collector | `what/obi.md` |

## Operator

| Concern | Repo | Spec Files |
|---|---|---|
| OpenTelemetryCollector CRD & API | opentelemetry-operator | `what/operator.md` |
| Instrumentation CRD (auto-instrumentation) | opentelemetry-operator | `what/auto-instrumentation.md` |
| Target allocator (Prometheus CR discovery) | opentelemetry-operator | `what/target-allocator.md` |
| OpAMP Bridge | opentelemetry-operator | `what/operator.md` |
| ClusterObservability CRD | opentelemetry-operator | `what/operator.md` |

## Productization

| Concern | Repo | Spec Files |
|---|---|---|
| Konflux build pipelines & component definitions | konflux-opentelemetry | `what/productization.md`, `how/build-pipeline.md` |
| Product Operator bundle & catalog (OLM) | konflux-opentelemetry | `what/productization.md`, `how/build-pipeline.md` |
| FIPS compliance | konflux-opentelemetry | `what/system-overview.md`, `what/productization.md` |
| Multi-arch builds | konflux-opentelemetry | `what/productization.md` |

## Documentation

| Concern | Repo | Spec Files |
|---|---|---|
| Product documentation (install, configure, use) | openshift-docs (branch: standalone-otel-docs-main) | — |

## Cross-Repo Features

These features span multiple repos:

| Feature | Repos |
|---|---|
| Adding a new collector component | redhat-opentelemetry-collector, konflux-opentelemetry, openshift-docs |
| OBI receiver features & k8s-cache | redhat-opentelemetry-collector, opentelemetry-operator, konflux-opentelemetry, openshift-docs |
| New CRD or API field | opentelemetry-operator, konflux-opentelemetry, openshift-docs |
| Version bump (upstream rebase) | redhat-opentelemetry-collector, opentelemetry-operator (submodules in konflux-opentelemetry) |
| New OCP version support | konflux-opentelemetry (new FBC catalog + Dockerfile) |
