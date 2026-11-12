# Red Hat Build of OpenTelemetry — Specifications

Red Hat build of OpenTelemetry (RHOSDT) is an OpenTelemetry distribution for OpenShift. It packages the upstream OpenTelemetry Collector, Operator, and auto-instrumentation into a supported, FIPS-compliant product distributed via OLM. These specs cover the product's behavioral rules and codebase navigation across the repositories in the workspace, plus the workspace's own CI/automation tooling (e.g. `deploy-periodic-agent`, which spans this repo and `openshift/release`).

## Structure

| Layer | Path | Purpose |
|---|---|---|
| **what/** | `.ai/spec/what/` | Behavioral rules. What the system must do. Implementation-agnostic. |
| **how/** | `.ai/spec/how/` | Codebase navigation. How the code is organized. Implementation-specific. |

## Scope

**Covered:** The OpenTelemetry Collector (core + contrib + Red Hat distro), the Kubernetes Operator (CRDs, controllers, auto-instrumentation, target allocator), productization via ART, product documentation, and workspace CI/automation tooling that reaches into `openshift/release` (e.g. `deploy-periodic-agent`).

**Out of scope:** Upstream OpenTelemetry SDK libraries, language-specific instrumentation library internals, Tempo/Jaeger backends, Cluster Observability Operator (COO).

## Audience

AI agents. Content is optimized for precision and machine consumption.

## Quick Start

| Task | Start here |
|---|---|
| Understand the product | `what/system-overview.md` |
| Understand the collector pipeline | `what/collector.md` |
| Understand CRDs and the operator | `what/operator.md` |
| Understand cluster TLS profile adherence | `what/tls-profile.md` |
| Understand auto-instrumentation | `what/auto-instrumentation.md` |
| Understand the OBI receiver (eBPF instrumentation) | `what/obi.md` |
| Understand target allocation | `what/target-allocator.md` |
| Understand productization | `what/productization.md` |
| Understand non-repudiation signing | `what/signing.md` |
| Compare signing spec vs upstream signing processor | `what/signing-upstream-comparison.md` |
| Understand identity-aware ingestion auth | `what/identity-aware-ingestion.md` |
| Understand upstream audit logging spec | `what/upstream-audit-logging-spec.md` |
| Understand RHEL metering | `what/rhel-metering.md` |
| Understand 3.12 new components | `what/collector-3.12-components.md` |
| Understand periodic-agent deployment tooling | `what/deploy-periodic-agent.md` |
| Navigate periodic-agent tooling code | `how/deploy-periodic-agent.md` |
| Find which repo to edit | `how/repo-map.md` |
| Understand repo layout | `how/project-structure.md` |
| Understand the build pipeline | `how/build-pipeline.md` |

## Cross-Reference

| what/ | how/ |
|---|---|
| `what/system-overview.md` | `how/project-structure.md` |
| `what/collector.md`, `what/obi.md` | `how/repo-map.md` (Collector sections) |
| `what/operator.md` | `how/repo-map.md` (Operator section) |
| `what/tls-profile.md` | `how/repo-map.md` (Operator and Collector sections) |
| `what/productization.md` | `how/build-pipeline.md`, `how/repo-map.md` (Productization section) |
| `what/deploy-periodic-agent.md` | `how/deploy-periodic-agent.md` |

## Conventions

- **Rule numbering:** behavioral rules are numbered sequentially within each what/ file.
- **Support levels:** features are marked **GA** (Generally Available — fully supported with production SLAs), **TP** (Technology Preview — documented but not production-supported), or **Not supported** (present in source code but absent from documentation). Only documented features are supported.
- **Planned changes:** unimplemented behavior is marked with `[PLANNED]` or `[PLANNED: TRACING-XXXX]` inline next to the rule it affects.
- **Constraints:** component-specific and cross-cutting constraints go in the relevant what/ file's Constraints section, co-located with behavioral rules. Development conventions go in CLAUDE.md.
- **Authority:** what/ specs are authoritative for behavior. how/ specs are authoritative for implementation. When they conflict, what/ wins.
- **When to create a new file vs. extend an existing one:** if the new concern has its own lifecycle, configuration surface, and can be understood independently, it gets its own file. If it's a capability added to an existing component, it goes in that component's file.
