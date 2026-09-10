# Regression Detection Report

## Metadata

| Field | Value |
|---|---|
| Downstream base | operator `8fa0b8bfbf1e760b24693a8e901aae7298560ecc` (v0.158.0), collector `v0.158.0` |
| Upstream target | origin/main |
| Release branch | rhosdt-3.11 |
| Components in build | 57 |
| Documented components | 54 |
| Critical | 5 |
| High | 17 |
| Medium | 31 |
| Low | 26 |
| Total | 79 |

## Contents

- [Critical (5)](#critical)
- [High (17)](#high)
- [Medium (31)](#medium)
- [Low (26)](#low)
- [Confirmed Coverage Gaps](#confirmed-coverage-gaps)

## Critical

#### CRIT-1 — Deprecated Kafka client config options fully removed

| Field | Value |
|---|---|
| Category | BREAKING_CHANGE |
| Component | kafkareceiver / kafkaexporter (pkg/kafka/configkafka) |
| Component type | receiver |
| Detection methods | changelog |
| Upstream PR | open-telemetry/opentelemetry-collector-contrib#50202, #50381 |
| Affected config fields | auth.tls, auth.plain_text, resolve_canonical_bootstrap_servers_only, auth.sasl.version, group_rebalance_strategy |
| Has test coverage | true |

Description: contrib v0.160.0 removes all previously-deprecated Kafka client configuration options: resolve_canonical_bootstrap_servers_only, auth.sasl.version, and group_rebalance_strategy (replaced by group_rebalance_strategies) from pkg/kafka/configkafka, plus exporter/kafka separately removes the deprecated auth.tls and auth.plain_text configs. Configs still using these keys will now fail validation/startup instead of just warning.

Recommended action: Grep downstream example/customer configs and CRs for resolve_canonical_bootstrap_servers_only, auth.sasl.version, group_rebalance_strategy, auth.tls, auth.plain_text under kafkareceiver/kafkaexporter and migrate before bumping to v0.160.0.

#### CRIT-2 — Removal of deprecated deployment_name_from_replicaset causes hard startup failure

| Field | Value |
|---|---|
| Category | BREAKING_CHANGE |
| Component | k8sattributesprocessor |
| Component type | processor |
| Detection methods | changelog, code-diff |
| Upstream PR | — |
| Affected config fields | deployment_name_from_replicaset, k8sattributes::extract::deployment_name_from_replicaset |
| Has test coverage | true |

Description: contrib v0.160.0 removes the deprecated deployment_name_from_replicaset key entirely (config.go's DeploymentNameFromReplicaSet field and its factory wiring are gone). Because confmap rejects unknown keys, any config that still sets extract.deployment_name_from_replicaset (true or false) will now fail to start instead of logging a deprecation warning; deployment names are always derived via the ReplicaSet heuristic now.

Recommended action: Scan all downstream OpenTelemetryCollector CR examples/tests and docs for deployment_name_from_replicaset and remove it before adopting v0.160.0; add a migration note for customers upgrading their own configs.

#### CRIT-3 — ordering_criteria::top_n: 0 semantics silently changed

| Field | Value |
|---|---|
| Category | BREAKING_CHANGE |
| Component | filelogreceiver |
| Component type | receiver |
| Detection methods | changelog |
| Upstream PR | open-telemetry/opentelemetry-collector-contrib#47444 |
| Affected config fields | ordering_criteria.top_n |
| Has test coverage | true |

Description: v0.159.0 changes top_n: 0 from behaving like top_n: 1 (match first file only) to meaning 'match all files'. Any downstream config or CR example that explicitly (or implicitly via a default) sets top_n: 0 will now start reading a different, larger set of files with no error — a silent functional/data-volume change.

Recommended action: Search all filelogreceiver configs/examples/docs for top_n: 0 or unset top_n with sort_by configured; set top_n: 1 explicitly if the old single-file behavior is required.

#### CRIT-5 — NetworkPolicy feature (enabled in operator 0.158.0) is unstable enough to be demoted back to alpha; stale API-server IPs can crash-loop the operator on OpenShift

| Field | Value |
|---|---|
| Category | FEATURE_GATE |
| Component | opentelemetry-operator (operator.networkpolicy feature gate) |
| Component type | operator |
| Detection methods | changelog, issues |
| Upstream PR | open-telemetry/opentelemetry-operator#5561 (partial fix); #5493, #5558, #5551 (open) |
| Affected config fields | OpenTelemetryCollector.spec.networkPolicy, feature-gate: operator.networkpolicy |
| Has test coverage | false |

Description: Operator 0.158.0 (the downstream base) turned on the operator.networkpolicy feature gate, generating a NetworkPolicy for the operator/TargetAllocator. Multiple bugs surfaced: (1) issue #5493 — the operator hardcoded its own Deployment name when resolving owner refs/pod selector, breaking under Helm-templated release names (this specific bug is fixed via PR #5561, resolving the Deployment through pod owner references instead, and has test coverage); maintainers discussed reverting the gate to alpha over the class of issues. (2) issue #5558 (OPEN) — API-server IPs are captured once at startup as /32 ipBlock CIDRs and never refreshed; an OpenShift ControlPlaneMachineSet-driven control-plane node replacement changes API server IPs, the stale NetworkPolicy blocks egress, and the operator pod CrashLoopBackOffs. (3) issue #5551 (OPEN) — TargetAllocator's generated NetworkPolicy is built from a one-time EndpointSlice snapshot with no watch/reconcile, silently breaking on Service/Endpoint IP churn, and stale policies aren't cleaned up when networkPolicy.enabled is toggled off. This matters most on OpenShift where control-plane rotation is routine.

Recommended action: Track upstream's decision on demoting operator.networkpolicy back to alpha before RHOSDT relies on it as stable/default-on. If enabled downstream, pin it off until #5558 and #5551 are fixed, or backport #5561 plus the IP-reconciliation fix once merged. Add an OpenShift-specific e2e case that rotates a control-plane node (or simulates API server IP change) with NetworkPolicy enabled.

#### CRIT-4 — Resource detection now retries forever by default, can hang collector startup indefinitely

| Field | Value |
|---|---|
| Category | BEHAVIOR_CHANGE |
| Component | resourcedetectionprocessor |
| Component type | processor |
| Detection methods | code-diff |
| Upstream PR | — |
| Affected config fields | resourcedetection::retry, resourcedetection::retry::enabled, resourcedetection::retry::max_elapsed_time |
| Has test coverage | false |

Description: resourcedetection.go now routes per-detector retries through configretry.BackOffConfig (new retry config block), defaulting Retry.Enabled=true and Retry.MaxElapsedTime=0. Previously Refresh() always wrapped detection in a 5s context timeout, aborting a hanging detector within that window. With the new default (0 = retry forever, no outer timeout), Start() waits synchronously on every detector's channel in sequence, so a single detector that never succeeds (e.g. openshift/ec2/gcp misconfigured, or an unresponsive metadata endpoint) can block collector Start() forever instead of failing fast after ~5s.

Recommended action: Before adopting this collector-contrib version downstream, explicitly pin resourcedetection::retry::enabled: false or set a finite retry::max_elapsed_time in default/example configs and OpenShift docs. File/track an upstream issue proposing a bounded default. Add e2e coverage asserting a misconfigured/unreachable detector fails fast rather than hanging Start().

## High

#### HIGH-1 — Kafka SASL and Kerberos auth now mutually exclusive (pending, unreleased)

| Field | Value |
|---|---|
| Category | BREAKING_CHANGE |
| Component | kafkareceiver / kafkaexporter (pkg/kafka/configkafka) |
| Component type | receiver |
| Detection methods | changelog |
| Upstream PR | open-telemetry/opentelemetry-collector-contrib#50748 |
| Affected config fields | auth.sasl, auth.kerberos |
| Has test coverage | false |

Description: Pending .chloggen entry (issue #50748) rejects Kafka configs that set both auth.sasl and auth.kerberos at once — previously silently accepted with undefined behavior. Not yet in a tagged release.

Recommended action: Audit any kafkareceiver/kafkaexporter configs that set both blocks; keep only one. Track for the next contrib release after v0.160.0.

#### HIGH-10 — TargetAllocator FilterStrategy type changed to pointer; new startup rejection of unknown filter_strategy values

| Field | Value |
|---|---|
| Category | BREAKING_CHANGE |
| Component | opentelemetry-operator (TargetAllocator API / target-allocator) |
| Component type | operator |
| Detection methods | changelog, code-diff |
| Upstream PR | open-telemetry/opentelemetry-operator#5444 |
| Affected config fields | spec.targetAllocator.filterStrategy, spec.filterStrategy (v1alpha1 TargetAllocator CR) |
| Has test coverage | false |

Description: Pending .chloggen entry adds none as an explicit filter strategy and changes TargetAllocatorSpec.FilterStrategy from a value to a pointer type (both v1alpha1 TargetAllocatorSpec/TargetAllocatorEmbedded and v1beta1), so clients can distinguish unset from explicitly-empty; the enum grows from "";relabel-config to "";none;relabel-config. The legacy empty value remains accepted as an alias for disabling filtering, but the Target Allocator now rejects any other unrecognized filter_strategy value on startup, and normalizes empty to none at load time. CRD YAML/JSON consumers are unaffected, but any Go code outside this diff that reads .Spec.FilterStrategy as a plain string will fail to compile.

Recommended action: Search redhat-opentelemetry-collector / konflux-opentelemetry / midstream-opentelemetry-operator for direct references to TargetAllocatorSpec.FilterStrategy and update them to handle the pointer type before rebasing onto this operator commit.

#### HIGH-2 — k8sattributes telemetry feature gates promoted alpha→beta (enabled by default)

| Field | Value |
|---|---|
| Category | FEATURE_GATE |
| Component | k8sattributesprocessor |
| Component type | processor |
| Detection methods | changelog, feature-gates |
| Upstream PR | open-telemetry/opentelemetry-collector-contrib#45871 |
| Affected config fields | processor.k8sattributes.telemetry.enableNewFormatMetrics, processor.k8sattributes.telemetry.disableOldFormatMetrics |
| Has test coverage | true |

Description: processor.k8sattributes.telemetry.enableNewFormatMetrics and processor.k8sattributes.telemetry.disableOldFormatMetrics are promoted from alpha to beta in contrib v0.160.0, i.e. ON by default: internal telemetry metric names/format change and old-format metrics stop being emitted unless the gates are explicitly disabled.

Recommended action: Update any dashboards/alerts that scrape k8sattributesprocessor's internal collector metrics; document the new metric names in release notes and add regression-detection coverage for the metric name change.

#### HIGH-3 — k8sattributes semconv naming gates promoted alpha→beta/stable (pending, unreleased)

| Field | Value |
|---|---|
| Category | DEPRECATION |
| Component | k8sattributesprocessor |
| Component type | processor |
| Detection methods | changelog, feature-gates |
| Upstream PR | open-telemetry/opentelemetry-collector-contrib#49152, #44589 |
| Affected config fields | processor.k8sattributes.EmitV1K8sConventions, processor.k8sattributes.DontEmitV0K8sConventions |
| Has test coverage | false |

Description: processor.k8sattributes.EmitV1K8sConventions and DontEmitV0K8sConventions are set to promote from alpha to beta (issue #49152, pending), switching emitted attributes from the legacy plural form (e.g. k8s.pod.labels.*) to the stable singular form (e.g. k8s.pod.label.*) by default, with the logs/metrics/traces signals themselves promoted beta→stable. Not yet in a tagged release.

Recommended action: Add to release-notes/migration-guide tracking now; verify downstream dashboards, alerting rules and any transformprocessor statements referencing the old plural attribute names before the gate flips.

#### HIGH-9 — filelog.allowFileDeletion / filelog.mtimeSortType / filelog.windows.caseInsensitive feature gates promoted to beta

| Field | Value |
|---|---|
| Category | FEATURE_GATE |
| Component | filelogreceiver (pkg/fileconsumer) |
| Component type | receiver |
| Detection methods | changelog, feature-gates |
| Upstream PR | open-telemetry/opentelemetry-collector-contrib#46635, #16314, #27812, #43777 |
| Affected config fields | filelog.allowFileDeletion, filelog.mtimeSortType, filelog.windows.caseInsensitive, delete_after_read, ordering_criteria.mode |
| Has test coverage | true |

Description: v0.159.0 promotes filelog.allowFileDeletion, filelog.mtimeSortType, and filelog.windows.caseInsensitive from alpha to beta — all now enabled by default. delete_after_read behavior, ordering_criteria.mode=mtime, and case-insensitive include/exclude path matching on Windows now activate without an explicit gate flag.

Recommended action: Verify no downstream customers rely on the old (disabled) default file-handling behavior before including this release; if the product ships/tests Windows collector builds, verify include/exclude glob configs still match intended files under case-insensitive matching; document the behavior change in release notes.

#### HIGH-4 — Memory leak / incorrect deletion for custom association identifiers fixed

| Field | Value |
|---|---|
| Category | BUG_FIX |
| Component | k8sattributesprocessor |
| Component type | processor |
| Detection methods | changelog |
| Upstream PR | open-telemetry/opentelemetry-collector-contrib#48588 |
| Affected config fields | — |
| Has test coverage | true |

Description: v0.159.0 fixes a memory leak and incorrect deletion of cached pod association state (labels/annotations) when identifiers cycle through active→stale→active transitions — a real production stability bug for long-running collectors watching churny K8s namespaces.

Recommended action: No config change required; recommend picking up this fix promptly for any downstream release since it is a memory-leak correction affecting a widely-used processor.

#### HIGH-5 — Security fix: OIDC JWKS key-rotation not detected via Kubernetes projected secrets

| Field | Value |
|---|---|
| Category | BUG_FIX |
| Component | oidcauthextension |
| Component type | extension |
| Detection methods | changelog |
| Upstream PR | — |
| Affected config fields | public_keys_file |
| Has test coverage | true |

Description: The oidcauthextension's public_keys_file watcher only fired on an fsnotify event whose name exactly matched the configured path. Kubernetes projected-secret rotations swap a ..data symlink target rather than rewriting the leaf file, so the watcher never fired and a revoked/rotated signing key kept being accepted for token verification until restart. Fixed to refresh on any relevant directory event; also fixes a data race mutating the shared oidc.Config on reload.

Recommended action: Prioritize this fix — it is a genuine security issue (revoked keys remained trusted) for any downstream deployment terminating OIDC auth with Kubernetes-mounted, auto-rotated JWKS files.

#### HIGH-6 — Nil-pointer crash on bbolt compaction failure after DB corruption

| Field | Value |
|---|---|
| Category | BUG_FIX |
| Component | filestorage |
| Component type | extension |
| Detection methods | changelog |
| Upstream PR | open-telemetry/opentelemetry-collector-contrib#49735 |
| Affected config fields | — |
| Has test coverage | false |

Description: The file_storage extension previously crashed the whole collector (nil pointer panic) if bbolt database compaction failed during startup after the storage file was corrupted. It now catches the panic and returns an error, allowing existing recovery mechanisms to run instead of taking down the process.

Recommended action: Adopt this fix; recommend adding a chaos/negative test in downstream QE that corrupts the filestorage DB file and asserts the collector stays up (or restarts cleanly) instead of crash-looping.

#### HIGH-7 — Unbounded memory/CPU from native-histogram bucket spans (DoS-style)

| Field | Value |
|---|---|
| Category | BUG_FIX |
| Component | prometheusremotewritereceiver |
| Component type | receiver |
| Detection methods | changelog |
| Upstream PR | open-telemetry/opentelemetry-collector-contrib#50286 |
| Affected config fields | — |
| Has test coverage | true |

Description: A remote-write request could describe a gap of billions of histogram buckets in a few bytes; the receiver reserved memory and iterated proportional to that gap. Bucket spans are now validated before conversion and a native histogram is dropped if it would expand past 16384 buckets or a request exceeds a 4194304-bucket budget.

Recommended action: Treat as a stability/availability hardening fix worth prioritizing for any downstream release exposing prometheusremotewritereceiver to less-trusted senders.

#### HIGH-8 — context.DeadlineExceeded incorrectly treated as permanent error, dropping metrics on timeout

| Field | Value |
|---|---|
| Category | BUG_FIX |
| Component | prometheusremotewriteexporter |
| Component type | exporter |
| Detection methods | changelog |
| Upstream PR | open-telemetry/opentelemetry-collector-contrib#49691 |
| Affected config fields | — |
| Has test coverage | true |

Description: The exporter treated context.DeadlineExceeded (a transient timeout) the same as context.Canceled (an explicit shutdown), classifying it as a permanent error and dropping the batch instead of retrying it. Only context.Canceled is now treated as permanent.

Recommended action: Recommend this fix for prioritized backport — data loss on ordinary network timeouts is a meaningful correctness bug for a metrics exporter.

#### HIGH-11 — resourcedetectionprocessor EC2 detector crashes the collector on a specific cloud environment

| Field | Value |
|---|---|
| Category | BUG_FIX |
| Component | processor/resourcedetection (ec2 detector) |
| Component type | processor |
| Detection methods | issues |
| Upstream PR | — |
| Affected config fields | resourcedetection.detectors=[ec2] |
| Has test coverage | false |

Description: Open bug (collector-contrib#50826, opened 2026-09-08): the ec2 detector in resourcedetectionprocessor — a component shipped in the RHOSDT manifest — crashes when running on a particular cloud provider's environment. resourcedetectionprocessor is used broadly in RHOSDT pipelines, so a crash here is a collector-availability regression, not just a data-quality issue.

Recommended action: Reproduce with the ec2 detector enabled on the affected environment type before the next collector image bump; consider a documentation caveat or temporary detector-selection guard until upstream fixes and releases a patched version.

#### HIGH-12 — cumulativetodeltaprocessor produces inflated deltas for histograms after a counter reset

| Field | Value |
|---|---|
| Category | BUG_FIX |
| Component | processor/cumulativetodelta |
| Component type | processor |
| Detection methods | issues |
| Upstream PR | — |
| Affected config fields | cumulativetodelta processor (histogram inputs) |
| Has test coverage | false |

Description: Open bug (collector-contrib#50828, opened 2026-09-08): when a monotonic counter/histogram resets (e.g. process restart) and then recovers, prevPoint for histograms is not updated on reset, causing the processor to compute an inflated delta on the next data point. This is in the RHOSDT manifest and commonly used ahead of delta-only backends; it silently corrupts metric values rather than failing loudly.

Recommended action: Flag as a known data-correctness caveat for any pipeline using cumulativetodeltaprocessor with histograms across process restarts; prioritize picking up the upstream fix in the next collector bump since it affects metric accuracy.

#### HIGH-15 — Operator upstream main pins an OLDER Go toolchain than the downstream base (1.26.5 -> 1.26.3)

| Field | Value |
|---|---|
| Category | DEPENDENCY |
| Component | opentelemetry-operator (go.mod: go directive) |
| Component type | — |
| Detection methods | dependencies |
| Upstream PR | — |
| Affected config fields | go.mod:go |
| Has test coverage | — |

Description: git diff 8fa0b8bfbf1e760b24693a8e901aae7298560ecc..origin/main -- go.mod shows the go directive regressing from 1.26.5 to 1.26.3. This is unusual — normally upstream tracks forward. It could mean the downstream base commit already carries a downstream-only bump ahead of upstream, or upstream reverted a toolchain bump. Downstream builds must not silently drop below a toolchain version already used/qualified downstream.

Recommended action: Confirm whether the downstream base already contains a downstream-specific go 1.26.5 bump not yet merged upstream. If so, do not let a straight merge/rebase from origin/main silently downgrade the toolchain — re-apply the downstream pin after merging. Treat any Go toolchain version change (up or down) as requiring full CI/build re-verification.

#### HIGH-16 — Kubernetes client-go/api/apimachinery family bumped a minor version (0.36.3 -> 0.37.0)

| Field | Value |
|---|---|
| Category | DEPENDENCY |
| Component | opentelemetry-operator (go.mod: k8s.io/*) |
| Component type | — |
| Detection methods | dependencies |
| Upstream PR | — |
| Affected config fields | go.mod:k8s.io/api, go.mod:k8s.io/apiextensions-apiserver, go.mod:k8s.io/apimachinery, go.mod:k8s.io/client-go, go.mod:k8s.io/component-base, go.mod:k8s.io/apiserver, go.mod:k8s.io/streaming |
| Has test coverage | — |

Description: k8s.io/api, k8s.io/apiextensions-apiserver, k8s.io/apimachinery, k8s.io/client-go, k8s.io/component-base, k8s.io/apiserver, and k8s.io/streaming all moved from v0.36.3 to v0.37.0. This class of bump can change generated API compatibility assumptions, CRD schema validation behavior, or client defaulting/watch behavior relied on by the operator's CRD reconcilers, and typically tracks a new supported Kubernetes minor version that may not yet be in OpenShift's supported version matrix.

Recommended action: Check the k8s.io v0.37.0 release notes for breaking changes in client-go/apimachinery, verify against OpenShift's currently supported Kubernetes API version, and run the full operator e2e/chainsaw suite before accepting the bump downstream.

#### HIGH-13 — Documented auth.plain_text field no longer exists in configkafka.AuthenticationConfig

| Field | Value |
|---|---|
| Category | DOC_STALE |
| Component | kafkareceiver |
| Component type | receiver |
| Detection methods | doc-validation |
| Upstream PR | — |
| Affected config fields | auth.plain_text, auth.sasl, auth.kerberos |
| Has test coverage | false |

Description: otel-receivers-kafka-receiver.adoc shows auth: { plain_text: { username, password } }. Upstream configkafka.AuthenticationConfig only has sasl and kerberos mapstructure fields — PlainTextConfig still exists as a type but is no longer wired into AuthenticationConfig. A user following the doc's example gets an unknown-field config error.

Recommended action: Update the doc to use auth.sasl with mechanism: PLAIN (username/password under sasl) instead of auth.plain_text. Also document auth.kerberos since it is the other supported mechanism.

#### HIGH-14 — Top-level topic field no longer exists; per-signal topics (plural) is required

| Field | Value |
|---|---|
| Category | DOC_STALE |
| Component | kafkareceiver |
| Component type | receiver |
| Detection methods | doc-validation |
| Upstream PR | — |
| Affected config fields | topic, traces.topics, metrics.topics, logs.topics, exclude_topics |
| Has test coverage | false |

Description: The doc's example sets a single top-level topic: otlp_spans field. Current kafkareceiver.Config has no such field — topics are configured per-signal via logs.topics, metrics.topics, traces.topics, profiles.topics (TopicEncodingConfig.Topics []string), each defaulting to a signal-specific topic name.

Recommended action: Remove topic: from the example and document traces.topics/metrics.topics/logs.topics (list of topic names) plus the new exclude_topics (regex-mode-only exclusion) field.

#### HIGH-17 — Downstream diff baseline commit is a dangling, non-upstream commit whose unique content is a synthetic AI-generated test tree

| Field | Value |
|---|---|
| Category | baseline-integrity |
| Component | opentelemetry-operator (test baseline) |
| Component type | — |
| Detection methods | test-coverage |
| Upstream PR | — |
| Affected config fields | — |
| Has test coverage | — |

Description: The instructed diff 8fa0b8bfbf1e760b24693a8e901aae7298560ecc..origin/main --stat -- tests/ reports 335 files changed, 16340 deletions, but commit 8fa0b8b is NOT an ancestor of origin/main or local main (merge-base resolves to an earlier commit 7fb51384), and it does not appear on any local or remote branch (dangling commit). Essentially all reported deletions (270+ files, ~16246 lines) are confined to tests/e2e-otel/, whose own README (present only in the base commit) states the component README files there were generated by Claude AI based on distributed-tracing-qe test cases — this tree mirrors distributed-tracing-qe/tests/e2e-otel/* file-for-file. This strongly indicates the base commit is leftover scratch/tooling output, not a genuine upstream snapshot that later regressed.

Recommended action: Do not treat the 16340 deleted lines as an upstream test-coverage regression. Re-pin the downstream base reference to a real, branch-reachable commit of open-telemetry/opentelemetry-operator (verify with git merge-base --is-ancestor <sha> origin/main) before running this diff again, and investigate/remove the dangling commit so it isn't reused as a baseline by mistake.

## Medium

#### MED-2 — Implicit top_n default deprecated; new filelog.requireExplicitTopN gate

| Field | Value |
|---|---|
| Category | DEPRECATION |
| Component | filelogreceiver |
| Component type | receiver |
| Detection methods | changelog, feature-gates |
| Upstream PR | open-telemetry/opentelemetry-collector-contrib#47444 |
| Affected config fields | ordering_criteria.top_n, ordering_criteria.sort_by, filelog.requireExplicitTopN |
| Has test coverage | true |

Description: v0.159.0 deprecates the implicit default of top_n: 1 when sort_by is configured (root cause of duplicate log ingestion across multiple actively-written files). The filelog.requireExplicitTopN feature gate (currently Alpha/off) makes an unset top_n a startup error when sort_by is set; expected to become the default in a future release, with the implicit fallback later removed.

Recommended action: Update downstream filelogreceiver documentation/examples to always set top_n explicitly when sort_by is used, and audit example configs using ordering_criteria.sort_by without an explicit top_n, ahead of the gate becoming mandatory.

#### MED-3 — resource_to_telemetry_conversion deprecated in favor of resource_constant_labels

| Field | Value |
|---|---|
| Category | DEPRECATION |
| Component | prometheusexporter / prometheusremotewriteexporter / awsemfexporter |
| Component type | exporter |
| Detection methods | changelog, code-diff, feature-gates |
| Upstream PR | open-telemetry/opentelemetry-collector-contrib#48861, #48862 |
| Affected config fields | resource_to_telemetry_conversion, resource_constant_labels, prometheus::resource_to_telemetry_conversion, prometheusremotewrite::resource_to_telemetry_conversion, awsemf::resource_to_telemetry_conversion |
| Has test coverage | true |

Description: All three exporters deprecate resource_to_telemetry_conversion (Enabled/ExcludeServiceAttributes) in favor of a new resource_constant_labels (included/excluded wildcard pattern) setting, matching the OTel Prometheus compatibility spec; legacy enabled: true migrates to included: ["*"]. Each now has a corresponding Alpha, off-by-default feature gate (exporter.prometheus.DisableResourceToTelemetryConversion, exporter.prometheusremotewrite.DisableResourceToTelemetryConversion, exporter.awsemf.DisableLegacyResourceToTelemetryConversion) that will eventually reject the legacy fields; configuring both old and new settings simultaneously is already a validation error.

Recommended action: Update downstream docs/examples using resource_to_telemetry_conversion.enabled and plan a migration path to resource_constant_labels; not yet breaking (old field still works, gates are Alpha/off) but should be tracked ahead of the gates graduating.

#### MED-11 — Flat keepalive config fields deprecated in favor of a keepalive block

| Field | Value |
|---|---|
| Category | DEPRECATION |
| Component | confighttp (core) — used by otlpreceiver, otlphttpexporter, prometheusreceiver, prometheusremotewritereceiver, jaegerreceiver, zipkinreceiver, and any HTTP-based component |
| Component type | core |
| Detection methods | changelog, code-diff |
| Upstream PR | open-telemetry/opentelemetry-collector#14020 |
| Affected config fields | idle_conn_timeout, max_idle_conns, max_idle_conns_per_host, disable_keep_alives, idle_timeout, keep_alives_enabled, keepalive |
| Has test coverage | true |

Description: core v1.66.0/v0.160.0 deprecates flat client/server keepalive fields (client: idle_conn_timeout, max_idle_conns, max_idle_conns_per_host, disable_keep_alives; server: idle_timeout, keep_alives_enabled) in favor of a new keepalive config block (PR #14020). Deprecated fields still work and keep prior semantics but now emit a deprecation warning; combining old + new fields is a hard error. This surfaces widely — jaegerreceiver, prometheusremotewriteexporter, zipkinreceiver, jaegerremotesampling, healthcheckextension, prometheusreceiver's TA client, etc. all set the now-deprecated fields internally.

Recommended action: Since pkg/confighttp underlies nearly every HTTP-based receiver/exporter in the downstream build, update downstream config-generation code/docs to prefer the new keepalive section and avoid emitting both old and new fields together (now a startup error). Expect new deprecation warnings in collector logs across most HTTP-based components after upgrading collector-core.

#### MED-12 — Top-level HTTP client settings deprecated in favor of nested http block

| Field | Value |
|---|---|
| Category | DEPRECATION |
| Component | prometheusremotewriteexporter |
| Component type | exporter |
| Detection methods | code-diff, feature-gates |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/issues/46209 |
| Affected config fields | prometheusremotewrite::endpoint, prometheusremotewrite::http, prometheusremotewrite::tls, prometheusremotewrite::headers |
| Has test coverage | — |

Description: exporter/prometheusremotewriteexporter/config.go deprecates the squashed ClientConfig (flat endpoint, tls, headers, etc.) in favor of a new nested http: block. Config.Unmarshal copies flat settings into HTTP when http isn't set (existing configs keep working), and Validate() now checks cfg.HTTP.Compression. Behind the Alpha, off-by-default feature gate exporter.prometheusremotewritexporter.removeTopLevelHTTPSettings, setting any top-level HTTP key becomes a hard config error, signaling the eventual removal path.

Recommended action: No action required today (gate is Alpha/off), but track this gate's promotion — once it reaches Beta/Stable, downstream example configs and docs using flat prometheusremotewrite HTTP settings will need to move under an http: block.

#### MED-14 — New umbrella Alpha gates receiver.hostmetrics.DontEmitV0SystemConventions / EmitV1SystemConventions

| Field | Value |
|---|---|
| Category | FEATURE_GATE |
| Component | hostmetricsreceiver |
| Component type | receiver |
| Detection methods | feature-gates |
| Upstream PR | https://github.com/open-telemetry/semantic-conventions/issues/3041 |
| Affected config fields | — |
| Has test coverage | — |

Description: New component-wide gates supersede the existing per-scraper semconv gates. Currently Alpha/off, but once promoted this will change emitted attribute names across all hostmetrics scrapers by default.

Recommended action: Track the per-scraper gates this consolidates and plan for the default attribute-name change across hostmetricsreceiver ahead of its Beta promotion.

#### MED-15 — New Alpha gates scraper.process.DontEmitV0SystemConventions / EmitV1SystemConventions (process scraper)

| Field | Value |
|---|---|
| Category | FEATURE_GATE |
| Component | hostmetricsreceiver |
| Component type | receiver |
| Detection methods | feature-gates |
| Upstream PR | https://github.com/open-telemetry/semantic-conventions/issues/3041 |
| Affected config fields | — |
| Has test coverage | — |

Description: Process-scraper-specific counterparts to the new hostmetrics-wide semconv gates; will change emitted process.* metric attribute names by default once promoted.

Recommended action: Track alongside the hostmetrics-wide gates for a coordinated semconv migration plan.

#### MED-16 — New Alpha gate pkg.exporterhelper.queueBatchEnabled in collector core affects nearly all downstream exporters

| Field | Value |
|---|---|
| Category | FEATURE_GATE |
| Component | exporterhelper |
| Component type | core |
| Detection methods | feature-gates |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector/issues/15047 |
| Affected config fields | sending_queue |
| Has test coverage | — |

Description: Enables exporterhelper batching by default in NewDefaultQueueConfig per the batching-migration RFC. Currently Alpha/off, but this is shared infrastructure used by essentially every downstream exporter (otlpexporter, otlphttpexporter, kafkaexporter, awsxrayexporter, awsemfexporter, awscloudwatchlogsexporter, googlecloudexporter, loadbalancingexporter, fileexporter, prometheusremotewriteexporter, debugexporter), so its eventual Beta promotion has broad blast radius.

Recommended action: Add this gate to the regression-detection watchlist for the next collector-core version bump; when it reaches Beta, re-test queuing/batching throughput and latency across all downstream exporters.

#### MED-25 — tail_storage option is undocumented and is gated behind an unstable feature gate

| Field | Value |
|---|---|
| Category | FEATURE_GATE |
| Component | tailsamplingprocessor |
| Component type | processor |
| Detection methods | doc-validation |
| Upstream PR | — |
| Affected config fields | tail_storage |
| Has test coverage | false |

Description: Config.TailStorageID (mapstructure:"tail_storage") lets the processor buffer spans in an external storage extension instead of in-memory, but Validate() requires the processor.tailsamplingprocessor.tailstorageextension feature gate to be enabled, and it is mutually exclusive with num_shards > 1. None of this is documented.

Recommended action: Either explicitly exclude tail_storage from docs while the gate is unstable, or add a feature-gate callout describing --feature-gates=+processor.tailsamplingprocessor.tailstorageextension and its incompatibility with num_shards > 1.

#### MED-4 — Remote Write 2.0 payloads now include start_timestamp for cumulative types

| Field | Value |
|---|---|
| Category | BEHAVIOR_CHANGE |
| Component | prometheusremotewriteexporter |
| Component type | exporter |
| Detection methods | changelog |
| Upstream PR | open-telemetry/opentelemetry-collector-contrib#50089 |
| Affected config fields | — |
| Has test coverage | true |

Description: When using the Remote Write 2.0 protobuf message, the exporter now sends the start timestamp of cumulative sums, histograms and summaries — a wire-format addition that downstream RW2.0 consumers/backends should be able to handle, but is a behavior change from prior payloads.

Recommended action: Verify any downstream RW2.0-receiving backend (e.g. Thanos, Mimir) used in product testing tolerates the new field before enabling RW2.0 in default configs.

#### MED-13 — New validation rejects duplicate pod associations that previously loaded successfully

| Field | Value |
|---|---|
| Category | BEHAVIOR_CHANGE |
| Component | k8sattributesprocessor |
| Component type | processor |
| Detection methods | code-diff |
| Upstream PR | — |
| Affected config fields | k8sattributes::pod_association |
| Has test coverage | — |

Description: config.go's Validate() now builds an order-independent key from each pod_association entry's sources and returns duplicate pod association: ... if two associations resolve to the same set of sources (regardless of order). Configurations that previously had duplicate associations, which loaded without error, will now fail collector startup. From values replicaset and cronjob were also added to the allowed metadata sources (additive).

Recommended action: Scan downstream example k8sattributesprocessor configs for pod_association lists with duplicate/overlapping source sets before upgrading.

#### MED-17 — Sidecar injector can silently omit Deployment-derived attributes under an admission race

| Field | Value |
|---|---|
| Category | BEHAVIOR_CHANGE |
| Component | opentelemetry-operator (sidecar / pod-mutation webhook) |
| Component type | auto_instrumentation |
| Detection methods | issues |
| Upstream PR | — |
| Affected config fields | Instrumentation sidecar injection webhook |
| Has test coverage | false |

Description: Open bug (operator#5554, opened 2026-09-01, needs triage): when the pod-mutating admission webhook races a ReplicaSet lookup, the sidecar injector silently omits Deployment attributes (e.g. resource attributes normally inferred from the owning Deployment) instead of failing or retrying. Silent omission means instrumented pods can end up missing expected resource attributes with no error surfaced.

Recommended action: Watch for triage outcome/label; if confirmed, this affects auto-instrumentation and sidecar injection users on OpenShift — consider whether RHOSDT's e2e coverage exercises rapid pod creation/scaling where this race could manifest.

#### MED-1 — Overflow-bucket handling and exemplar trace/span ID corrections in native histogram conversion

| Field | Value |
|---|---|
| Category | BUG_FIX |
| Component | prometheusremotewritereceiver |
| Component type | receiver |
| Detection methods | changelog |
| Upstream PR | open-telemetry/opentelemetry-collector-contrib#50292, #50547, #50598 |
| Affected config fields | — |
| Has test coverage | true |

Description: Two related fixes: (1) the Prometheus overflow bucket is now dropped per spec instead of being mistranslated as an ordinary finite bucket (any histogram containing a bucket above the overflow bucket is now dropped entirely); (2) exemplar trace_id/span_id labels with an invalid length were previously zero-padded/truncated into a fabricated OTel ID — they are now only converted when valid, otherwise preserved unchanged as filtered attributes. A near-duplicate pending fix (issue #50598, unreleased) applies the same exemplar-ID fix to receiver/prometheus.

Recommended action: Verify downstream metrics-correctness tests don't assert on the old (incorrect) overflow-bucket or fabricated-exemplar-ID behavior; note the pending receiver/prometheus companion fix for the next release cycle.

#### MED-5 — Composite policy rate_allocation omission previously blocked a sub-policy from sampling entirely

| Field | Value |
|---|---|
| Category | BUG_FIX |
| Component | tailsamplingprocessor |
| Component type | processor |
| Detection methods | changelog |
| Upstream PR | open-telemetry/opentelemetry-collector-contrib#49828 |
| Affected config fields | rate_allocation |
| Has test coverage | true |

Description: In the composite policy, a sub-policy omitted from rate_allocation previously received a zero sampling rate that permanently blocked it, instead of its intended default equal share of the budget. This is a functional correctness bug for anyone using composite tail-sampling policies without listing every sub-policy in rate_allocation.

Recommended action: Flag to QE for regression testing of tailsamplingprocessor composite policies; recommend for inclusion in the next downstream collector-contrib bump.

#### MED-6 — Processor state not dropped on TailStorage.Take failure

| Field | Value |
|---|---|
| Category | BUG_FIX |
| Component | tailsamplingprocessor |
| Component type | processor |
| Detection methods | changelog |
| Upstream PR | open-telemetry/opentelemetry-collector-contrib#49907 |
| Affected config fields | — |
| Has test coverage | true |

Description: When TailStorage.Take fails, the processor previously left stranded trace state or could forward incomplete batches. It now drops processor state on such failures to avoid inconsistent output.

Recommended action: No config change required; recommend adopting for stability of tail-sampling under storage backend errors.

#### MED-8 — Classic histograms without explicit bucket boundaries dropped when convert_classic_histograms_to_nhcb enabled

| Field | Value |
|---|---|
| Category | BUG_FIX |
| Component | prometheusreceiver |
| Component type | receiver |
| Detection methods | changelog |
| Upstream PR | open-telemetry/opentelemetry-collector-contrib#49893 |
| Affected config fields | convert_classic_histograms_to_nhcb |
| Has test coverage | true |

Description: The receiver could silently drop classic histograms lacking explicit bucket boundaries when convert_classic_histograms_to_nhcb is enabled and classic histograms are not retained — a metrics data-loss bug now fixed.

Recommended action: No config change required; recommend adopting for correctness of NHCB conversion.

#### MED-9 — {PodName} placeholder never resolved for standard EKS pipelines; batch-size accounting also fixed

| Field | Value |
|---|---|
| Category | BUG_FIX |
| Component | awscloudwatchlogsexporter |
| Component type | exporter |
| Detection methods | changelog |
| Upstream PR | open-telemetry/opentelemetry-collector-contrib#46202, #48559 |
| Affected config fields | log_group_name, log_stream_name, max_event_payload_bytes |
| Has test coverage | true |

Description: Two related fixes: (1) {PodName} in log_group_name/log_stream_name now also resolves from the semconv k8s.pod.name attribute (previously only the legacy pod attribute), fixing it for any pipeline using k8sattributesprocessor as normally configured. (2) eventBatch.exceedsLimit was comparing cumulative batch bytes against the 256 KiB per-event limit instead of the 1 MiB per-request limit since 2022, causing batches to roll ~4x more often than necessary; also fixed, and load-bearing for the new opt-in max_event_payload_bytes config.

Recommended action: Recommend both fixes; the {PodName} fix in particular silently broke a documented feature for the common EKS/k8sattributesprocessor pairing.

#### MED-18 — loadbalancingexporter Kubernetes resolver retains deleted endpoints after a relist

| Field | Value |
|---|---|
| Category | BUG_FIX |
| Component | exporter/loadbalancing |
| Component type | exporter |
| Detection methods | issues |
| Upstream PR | — |
| Affected config fields | loadbalancing.resolver.k8s |
| Has test coverage | false |

Description: Open bug (collector-contrib#50741, opened 2026-09-03): the Kubernetes-mode resolver in loadbalancingexporter (shipped in the RHOSDT manifest) keeps stale/deleted backend endpoints after a relist, which can route spans/metrics to endpoints that no longer exist, causing export errors or load-skew in tail-sampling / spanmetrics-style fan-out topologies.

Recommended action: Track for the next collector version bump; in the interim, document that loadbalancingexporter's k8s resolver may need periodic collector restarts as a workaround if endpoint churn is high.

#### MED-19 — convert_exponential_histogram_to_histogram OTTL function emits invalid explicit histograms (missing overflow bucket)

| Field | Value |
|---|---|
| Category | BUG_FIX |
| Component | processor/transform (pkg/ottl) |
| Component type | processor |
| Detection methods | issues |
| Upstream PR | — |
| Affected config fields | transform processor: convert_exponential_histogram_to_histogram() |
| Has test coverage | false |

Description: Open bug (collector-contrib#50737, opened 2026-09-03): the convert_exponential_histogram_to_histogram function used via transformprocessor (in the RHOSDT manifest) emits explicit histograms without an overflow bucket, producing spec-invalid histogram output.

Recommended action: Audit whether any RHOSDT reference configs or documented examples use convert_exponential_histogram_to_histogram; if so, add a caveat until fixed upstream.

#### MED-20 — redactionprocessor deletes allowed keys/count attributes not in its own auto-allowlist

| Field | Value |
|---|---|
| Category | BUG_FIX |
| Component | processor/redaction |
| Component type | processor |
| Detection methods | issues |
| Upstream PR | — |
| Affected config fields | redaction.allowed_keys, redaction.summary attributes |
| Has test coverage | false |

Description: Open bug (collector-contrib#50770, opened 2026-09-05): redaction.allowed.keys and redaction.allowed.count (attributes the processor itself adds to report what it allowed/redacted) are not included in its own auto-generated allowlist, so they get deleted on re-entry (e.g. chained/multi-stage redaction). This is a security/compliance-relevant component, so losing its own audit attributes undermines traceability of what was redacted.

Recommended action: If RHOSDT documents chained/multi-stage redaction, add a note about this until fixed; otherwise track for next bump.

#### MED-21 — metricstarttimeprocessor can underflow on malformed input histograms

| Field | Value |
|---|---|
| Category | BUG_FIX |
| Component | processor/metricstarttime |
| Component type | processor |
| Detection methods | issues |
| Upstream PR | — |
| Affected config fields | metricstarttime processor |
| Has test coverage | false |

Description: Open bug (collector-contrib#50688, opened 2026-09-01): malformed input histograms can cause an underflow in metricstarttimeprocessor's start-time calculation. Underflow in a start-time field can produce nonsensical (e.g. far-future/negative-duration) metric timestamps downstream.

Recommended action: Track for next collector bump; consider adding input validation/rejection of malformed histograms as a defensive config recommendation.

#### MED-22 — Misconfigured TLS causes kafkareceiver to block shutdown

| Field | Value |
|---|---|
| Category | BUG_FIX |
| Component | receiver/kafka |
| Component type | receiver |
| Detection methods | issues |
| Upstream PR | — |
| Affected config fields | kafka receiver TLS settings |
| Has test coverage | false |

Description: Open bug (collector-contrib#50631, opened 2026-08-31): a misconfigured TLS setting on kafkareceiver causes the receiver to hang during collector shutdown rather than failing fast, which can delay pod termination/rolling restarts on OpenShift and mask the real TLS misconfiguration behind a hung shutdown instead of a clear startup error.

Recommended action: Add TLS config validation guidance for kafkareceiver in RHOSDT docs/examples; track upstream fix for the shutdown hang.

#### MED-23 — prometheusreceiver target_info precedence not spec-compliant; related exemplar trace/span ID truncation

| Field | Value |
|---|---|
| Category | BUG_FIX |
| Component | receiver/prometheus |
| Component type | receiver |
| Detection methods | issues |
| Upstream PR | — |
| Affected config fields | prometheusreceiver target_info handling, prometheusreceiver exemplars |
| Has test coverage | false |

Description: Two prometheusreceiver bugs: collector-contrib#50502 (OPEN, 2026-08-25) — target_info precedence handling doesn't match the OpenTelemetry spec, which can cause resource attributes to be attached incorrectly when multiple sources contribute to target_info. Related: collector-contrib#50598 (CLOSED, 2026-08-28) documented the same trace_id/span_id exemplar truncation pattern as prior issue #50547, indicating a recurring exemplar-encoding class of bug in the Prometheus scrape/exemplar path.

Recommended action: Track upstream discussion/fix for target_info precedence (marked 'discussion needed'); verify RHOSDT's Prometheus-to-OTLP conversion docs don't assume the current (non-compliant) precedence behavior.

#### MED-24 — Collector-config RBAC webhook rejects valid configs for users who aren't cluster-admins

| Field | Value |
|---|---|
| Category | BUG_FIX |
| Component | opentelemetry-operator (collector admission webhook / RBAC) |
| Component type | operator |
| Detection methods | issues |
| Upstream PR | — |
| Affected config fields | OpenTelemetryCollector validating webhook RBAC escalation check |
| Has test coverage | false |

Description: Open bug (operator#5525, opened 2026-08-25, needs triage): the vopentelemetrycollectorcreateupdatebeta admission webhook denies creating/upgrading an OpenTelemetryCollector when the acting user lacks RBAC for permissions the collector config would grant (e.g. pods: get,watch,list, apps/replicasets: get,watch,list), even for namespace-scoped admins rather than cluster-admins. This directly affects RHOSDT's common OpenShift pattern of shared multi-tenant clusters where teams are only admins of their own namespace but need to deploy collectors with k8sattributesprocessor-style RBAC needs.

Recommended action: Reproduce on OpenShift with a namespace-scoped admin (not cluster-admin) applying an OpenTelemetryCollector using k8sattributesprocessor; if reproducible on 0.158.0, this is a real adoption blocker for RHOSDT's most common non-cluster-admin deployment pattern and should be raised with higher urgency upstream.

#### MED-10 — Minimum Go version raised to 1.26 across upstream repos

| Field | Value |
|---|---|
| Category | DEPENDENCY |
| Component | all (build toolchain) / opentelemetry-collector |
| Component type | core |
| Detection methods | changelog, dependencies |
| Upstream PR | open-telemetry/opentelemetry-collector-contrib#50394, open-telemetry/opentelemetry-collector#15799 |
| Affected config fields | go.mod:go |
| Has test coverage | true |

Description: contrib v0.160.0 and collector core v1.66.0/v0.160.0 both raise the minimum Go toolchain version to 1.26 (core's go directive moves 1.25.0 -> 1.26.0, dropping support for 1.25.0); core also declares windows/amd64 tier-1 / windows/arm64 tier-2 support.

Recommended action: Verify the Konflux build pipeline's Go toolchain image is updated to 1.26 before bumping vendored versions in konflux-opentelemetry / redhat-opentelemetry-collector, otherwise the downstream build will fail. Confirm the downstream build pipeline's Go toolchain is already >= 1.26.0 (it already appears to be, per the operator's go.mod).

#### MED-29 — OpenTelemetry Go SDK/API and related exporters/contrib bumped 1.45.0 -> 1.46.0 (and 0.x companions in lockstep)

| Field | Value |
|---|---|
| Category | DEPENDENCY |
| Component | opentelemetry-operator (go.mod: OTel Go SDK/API) |
| Component type | — |
| Detection methods | dependencies |
| Upstream PR | — |
| Affected config fields | go.mod:go.opentelemetry.io/otel, go.mod:go.opentelemetry.io/otel/sdk, go.mod:go.opentelemetry.io/otel/metric, go.mod:go.opentelemetry.io/contrib/otelconf |
| Has test coverage | — |

Description: go.opentelemetry.io/otel, otel/metric, otel/sdk, otel/sdk/metric, otel/trace, otel/exporters/otlp/otlpmetric*, otel/exporters/prometheus, contrib/otelconf, contrib/bridges/prometheus, and various contrib/propagators/exporters/otlplog packages all bumped one minor version together. This is the operator's own self-instrumentation stack (metrics/tracing of the operator process itself), not the managed collector's runtime dependency, so blast radius is limited to operator observability.

Recommended action: Skim the OTel Go SDK v1.46.0 changelog for breaking API changes to the exporter/SDK interfaces used in the operator's own instrumentation code, then run unit tests covering operator metrics emission.

#### MED-30 — prometheus-operator bumped 0.92.0 -> 0.93.1 and prometheus/prometheus bumped 0.312.0 -> 0.314.0

| Field | Value |
|---|---|
| Category | DEPENDENCY |
| Component | opentelemetry-operator (go.mod: prometheus-operator, prometheus/prometheus) |
| Component type | — |
| Detection methods | dependencies |
| Upstream PR | — |
| Affected config fields | go.mod:github.com/prometheus-operator/prometheus-operator, go.mod:github.com/prometheus/prometheus |
| Has test coverage | — |

Description: The operator embeds prometheus-operator API types/clients for ServiceMonitor/PodMonitor support and vendors prometheus/prometheus for scrape-config/relabeling logic used by the TargetAllocator. Both moved forward multiple minor versions. prometheus/prometheus in particular carries the TargetAllocator's discovery and relabeling code paths, so behavior changes there directly affect target allocation.

Recommended action: Review prometheus-operator v0.93.x and prometheus v0.313.x/v0.314.x changelogs for CRD field or relabeling-behavior changes, and re-run TargetAllocator e2e tests.

#### MED-31 — buraksezer/consistent jumped a major version (v0.10.0 -> v1.1.0)

| Field | Value |
|---|---|
| Category | DEPENDENCY |
| Component | opentelemetry-operator (go.mod: buraksezer/consistent) |
| Component type | — |
| Detection methods | dependencies |
| Upstream PR | — |
| Affected config fields | go.mod:github.com/buraksezer/consistent |
| Has test coverage | — |

Description: This library implements the consistent-hashing algorithm used by the TargetAllocator's consistent-hashing allocation strategy. A major version bump (v0 -> v1) can carry breaking API changes even though it's a small/low-traffic dependency; TargetAllocator correctness for the consistent-hashing strategy depends directly on this package's behavior.

Recommended action: Diff buraksezer/consistent v0.10.0 vs v1.1.0 API and hashing-ring behavior; confirm the TargetAllocator's consistent-hashing allocator still builds against the new API and passes its unit tests (ring rebalancing, node addition/removal determinism).

#### MED-7 — num_shards option to parallelize decision loop under high load

| Field | Value |
|---|---|
| Category | NEW_FEATURE |
| Component | tailsamplingprocessor |
| Component type | processor |
| Detection methods | changelog, code-diff |
| Upstream PR | open-telemetry/opentelemetry-collector-contrib#48699 |
| Affected config fields | num_shards |
| Has test coverage | true |

Description: v0.159.0 adds num_shards (default 1, max 256, preserving current single-loop behavior) to run N parallel event loops sharded by trace ID, dividing num_traces, rate limits and decision-cache sizes across shards evenly (burst_capacity is not divided). Validate() rejects num_shards > 1 combined with tail_storage. Not a regression, but a significant behavior change once enabled.

Recommended action: Consider documenting num_shards as a supported tuning knob for high-throughput downstream deployments once validated by QE.

#### MED-26 — otlp_grpc exporter doc omits timeout, sending_queue, and retry_on_failure — core reliability settings

| Field | Value |
|---|---|
| Category | DOC_MISSING |
| Component | otlpexporter |
| Component type | exporter |
| Detection methods | doc-validation |
| Upstream PR | — |
| Affected config fields | timeout, sending_queue, retry_on_failure |
| Has test coverage | false |

Description: otel-exporters-otlp-grpc-exporter.adoc only documents endpoint/tls/headers. The Config struct also embeds exporterhelper.TimeoutConfig (timeout, default 5s), sending_queue (QueueBatchConfig: enabled, num_consumers, queue_size, storage, batching sub-config), and retry_on_failure (configretry.BackOffConfig). These control delivery guarantees and backpressure behavior and are enabled by default, so omitting them leaves users unaware of the retry/queue defaults or how to persist the queue with a storage extension.

Recommended action: Add a parameters section for timeout, sending_queue (including the storage sub-field for persistent queues), and retry_on_failure with their defaults.

#### MED-27 — Kubernetes Attributes Processor doc covers only filter; extract, pod_association, exclude, and metadata-wait options are entirely undocumented

| Field | Value |
|---|---|
| Category | DOC_MISSING |
| Component | k8sattributesprocessor |
| Component type | processor |
| Detection methods | doc-validation |
| Upstream PR | — |
| Affected config fields | extract, pod_association, exclude, wait_for_metadata, wait_for_metadata_timeout, watch_sync_period, pod_delete_grace_period, passthrough, auth_type |
| Has test coverage | false |

Description: otel-processors-kubernetes-attributes-processor.adoc shows a single example using only filter.namespace/filter.node_from_env_var. The Config struct additionally has passthrough, extract (metadata list, annotations, labels, otel_annotations), pod_association (list of source rules — commonly required to correlate spans/metrics to pods when the default IP-based association isn't sufficient), exclude.pods, wait_for_metadata/wait_for_metadata_timeout, watch_sync_period, pod_delete_grace_period, and the squashed k8sconfig.APIConfig (auth_type). Since pod_association and extract are usually needed to get useful metadata beyond defaults, their complete absence is a significant gap for one of the most commonly deployed processors.

Recommended action: Expand the module with sections for extract (metadata/annotations/labels), pod_association (with source types), exclude, wait_for_metadata, and auth_type — using the upstream README as the source of truth.

#### MED-28 — The openshift detector's own config fields (address, token, tls, resource_attributes) are undocumented

| Field | Value |
|---|---|
| Category | DOC_MISSING |
| Component | resourcedetectionprocessor |
| Component type | processor |
| Detection methods | doc-validation |
| Upstream PR | — |
| Affected config fields | openshift.address, openshift.token, openshift.tls, openshift.resource_attributes, refresh_interval, fail_on_missing_metadata, retry |
| Has test coverage | false |

Description: The doc's primary example uses detectors: [openshift], the Red Hat-specific detector, but only shows top-level detectors/override. The openshift detector's own Config exposes address, token, tls, and resource_attributes (enable/disable individual attributes like cloud.platform, cloud.region, k8s.cluster.name) — needed when the collector can't use the in-cluster default API endpoint/token or needs custom TLS/CA.

Recommended action: Document the openshift detector's address/token/tls/resource_attributes options, plus the common timeout, override, refresh_interval, fail_on_missing_metadata, and retry fields shared across all detectors.

## Low

#### LOW-5 — Exporter queue/batch and scraper record metric semantics changed

| Field | Value |
|---|---|
| Category | BEHAVIOR_CHANGE |
| Component | exporterhelper / scraperhelper (core) |
| Component type | core |
| Detection methods | code-diff |
| Upstream PR | — |
| Affected config fields | — |
| Has test coverage | — |

Description: Core v0.159.0/v0.160.0: exporter queue batch-size histograms (otelcol_exporter_queue_batch_send_size(_bytes)) are now recorded post-batch instead of at enqueue time (values differ for exporters with batching enabled); new otelcol_exporter_enqueue_size(_bytes) metrics preserve the old enqueue-time view. Separately, otelcol_scraper_scraped_log_records/errored_log_records and profile-record equivalents changed unit from {datapoint} to {record}.

Recommended action: Flag for teams owning collector dashboards/alerts built on otelcol_exporter_queue_batch_send_size* or the log/profile scraper record metrics — values/units will shift after upgrading collector-core.

#### LOW-3 — Shutdown could be delayed / race between pending scrape tick and shutdown (pending, unreleased)

| Field | Value |
|---|---|
| Category | BUG_FIX |
| Component | pkg/scraperhelper (hostmetricsreceiver, prometheusreceiver, and other scraper-based receivers) |
| Component type | core |
| Detection methods | changelog |
| Upstream PR | open-telemetry/opentelemetry-collector#15736 |
| Affected config fields | — |
| Has test coverage | false |

Description: Pending core .chloggen entry: if a scrape was still running when the next tick fired, the pending tick and the shutdown signal could both become ready at once and the controller chose between them at random, sometimes running one extra scrape before shutting down.

Recommended action: Low risk; note for QE's scrape-interval/shutdown-timing tests once released in the next core tag.

#### LOW-14 — resourcedetectionprocessor GCP detector ignores its configured timeout

| Field | Value |
|---|---|
| Category | BUG_FIX |
| Component | processor/resourcedetection (gcp detector) |
| Component type | processor |
| Detection methods | issues |
| Upstream PR | — |
| Affected config fields | resourcedetection.detectors=[gcp].timeout |
| Has test coverage | false |

Description: Open bug (collector-contrib#50754, opened 2026-09-04): the gcp detector in resourcedetectionprocessor ignores the user-configured timeout value. Lower impact than the ec2-detector crash since it degrades rather than crashes, but still a correctness gap in a manifest component.

Recommended action: Track for next bump; low urgency unless RHOSDT customers report collector hangs tied to GCP resource detection.

#### LOW-23 — grpc 1.82.1->1.83.2, protobuf 1.36.11->1.36.12, testify 1.11.1->1.12.1; testify's transitive yaml/check.v1/go-internal deps replaced by go.yaml.in/yaml/v3

| Field | Value |
|---|---|
| Category | DEPENDENCY |
| Component | opentelemetry-collector (go.mod: grpc/protobuf/testify) |
| Component type | — |
| Detection methods | dependencies |
| Upstream PR | — |
| Affected config fields | go.mod:google.golang.org/grpc, go.mod:google.golang.org/protobuf, go.mod:github.com/stretchr/testify |
| Has test coverage | — |

Description: Collector core's go.mod only declares testify, grpc, protobuf as direct deps plus their transitives. These are patch/minor bumps with low expected risk; the testify dependency-tree change (dropping gopkg.in/check.v1, kr/pretty, rogpeppe/go-internal, davecgh/go-spew, pmezard/go-difflib, gopkg.in/yaml.v3 in favor of go.yaml.in/yaml/v3) is a testify internal modernization with no expected effect on collector runtime behavior since these are test-only transitive deps.

Recommended action: No action expected beyond standard go mod tidy/build verification; low risk given these are core module's only deps and largely test-scoped.

#### LOW-24 — No change in versions.txt between downstream base and upstream main

| Field | Value |
|---|---|
| Category | DEPENDENCY |
| Component | opentelemetry-operator (versions.txt) |
| Component type | — |
| Detection methods | dependencies |
| Upstream PR | — |
| Affected config fields | versions.txt |
| Has test coverage | — |

Description: git diff 8fa0b8bfbf1e760b24693a8e901aae7298560ecc..origin/main -- versions.txt produced an empty diff — the pinned component versions (opentelemetry-collector=0.158.0, operator=0.158.0, targetallocator=0.158.0, operator-opamp-bridge=0.158.0, autoinstrumentation-java=2.30.0, etc.) are identical on both refs. This is informational, confirming the go.mod dependency drift above is not accompanied by a product component version bump.

Recommended action: None — no regression risk from this file; included for completeness of the diff scan.

#### LOW-1 — Optional node filesystem inode count/free metrics added

| Field | Value |
|---|---|
| Category | NEW_FEATURE |
| Component | kubeletstatsreceiver |
| Component type | receiver |
| Detection methods | changelog |
| Upstream PR | open-telemetry/opentelemetry-collector-contrib#48926 |
| Affected config fields | — |
| Has test coverage | true |

Description: v0.159.0 adds opt-in k8s.node.filesystem.inode.count and k8s.node.filesystem.inode.free metrics.

Recommended action: Consider documenting as available opt-in metrics in the next docs update.

#### LOW-2 — New k8s.statefulset.pod.available metric (pending, unreleased)

| Field | Value |
|---|---|
| Category | NEW_FEATURE |
| Component | k8sclusterreceiver |
| Component type | receiver |
| Detection methods | changelog |
| Upstream PR | open-telemetry/opentelemetry-collector-contrib#50345 |
| Affected config fields | — |
| Has test coverage | false |

Description: Pending .chloggen entry adds k8s.statefulset.pod.available reporting StatefulSetStatus.availableReplicas per stateful set.

Recommended action: Track for docs once released.

#### LOW-4 — TargetAllocator per-node fallback strategy config and OTLP self-telemetry fields added (pending)

| Field | Value |
|---|---|
| Category | NEW_FEATURE |
| Component | opentelemetry-operator (OpenTelemetryCollector CR / TargetAllocator CR) |
| Component type | operator |
| Detection methods | changelog |
| Upstream PR | open-telemetry/opentelemetry-operator#5183, #5047 |
| Affected config fields | spec.targetAllocator.allocationStrategy, spec.targetAllocator.telemetry.metrics.readers, spec.telemetry.metrics.readers |
| Has test coverage | false |

Description: Two pending .chloggen entries add allocation_strategy_config.per_node.fallback_strategy.name (deprecating the top-level allocation_fallback_strategy in favor of it) and new spec.targetAllocator.telemetry.metrics.readers / spec.telemetry.metrics.readers fields for OTLP self-telemetry export on the TargetAllocator CR. When the operand.networkpolicy feature gate is enabled, the TargetAllocator's generated NetworkPolicy now leaves egress unrestricted if self-telemetry export is configured, since the destination may be external.

Recommended action: Track for CRD/API docs updates once merged; note the NetworkPolicy egress-widening side effect for security review when operand.networkpolicy plus self-telemetry are combined.

#### LOW-6 — New opt-in independent per-partition processing

| Field | Value |
|---|---|
| Category | NEW_FEATURE |
| Component | kafkareceiver |
| Component type | receiver |
| Detection methods | code-diff |
| Upstream PR | — |
| Affected config fields | — |
| Has test coverage | — |

Description: Added partition_processing.independent (bool) and partition_processing.max_buffered_batches (default 1) to enable ordered, independent per-partition Kafka consumption. Validate() requires max_buffered_batches > 0 and consumer.autocommit.enable=true when independent is set. Purely additive/opt-in.

Recommended action: No action required; document as a new capability if surfaced to customers.

#### LOW-7 — New opt-in signal_header option reserves an otelcol.signal Kafka header

| Field | Value |
|---|---|
| Category | NEW_FEATURE |
| Component | kafkaexporter |
| Component type | exporter |
| Detection methods | code-diff |
| Upstream PR | — |
| Affected config fields | — |
| Has test coverage | — |

Description: Added signal_header (bool) to kafkaexporter config; when enabled, Validate() rejects configs that also manually set the reserved otelcol.signal header via include_metadata_keys or record_headers. Off by default, no behavior change for existing configs.

Recommended action: No action required.

#### LOW-8 — New max_event_payload_bytes config for per-event log truncation

| Field | Value |
|---|---|
| Category | NEW_FEATURE |
| Component | awscloudwatchlogsexporter |
| Component type | exporter |
| Detection methods | code-diff |
| Upstream PR | — |
| Affected config fields | — |
| Has test coverage | — |

Description: Added max_event_payload_bytes (default 0 → effectively 256 KiB for backward compatibility, capped at CloudWatch's 1 MiB API limit) with new Validate() bounds checks.

Recommended action: No action required; verify default (256 KiB) matches previously-hardcoded truncation behavior if any downstream tooling depended on exact truncation size.

#### LOW-9 — New opt-in retry_on_failure / wait_for_token_file options

| Field | Value |
|---|---|
| Category | NEW_FEATURE |
| Component | bearertokenauthextension |
| Component type | extension |
| Detection methods | code-diff |
| Upstream PR | — |
| Affected config fields | — |
| Has test coverage | — |

Description: Added retry_on_failure (RetryOnFailureConfig) and wait_for_token_file (bool) to support retrying/blocking on a not-yet-available bearer token file. Both disabled by default; new Validate() rules only trigger when explicitly enabled.

Recommended action: No action required.

#### LOW-11 — Additive CRD fields: proxy config, in-place pod resize policy, Target Allocator self-telemetry

| Field | Value |
|---|---|
| Category | NEW_FEATURE |
| Component | OpenTelemetryCollector / TargetAllocator / OpAMPBridge CRDs |
| Component type | operator |
| Detection methods | code-diff |
| Upstream PR | — |
| Affected config fields | — |
| Has test coverage | — |

Description: apis/ diff adds OpAMPBridgeSpec.Proxy (OpAMPBridgeProxyConfig) for OpAMP backend connections; OpenTelemetryCommonFields.ResizePolicy ([]corev1.ContainerResizePolicy) for in-place pod resource resize; and TelemetryConfig/MetricsConfig/MetricReader/OTLP exporter types added to both TargetAllocatorSpec (v1alpha1) and TargetAllocatorEmbedded (v1beta1) for the Target Allocator's own OTLP self-telemetry. All new fields are optional with no changed defaults on existing fields.

Recommended action: No action required; consider surfacing these as new supported/tech-preview features in product docs once validated.

#### LOW-12 — New Alpha gates processor.resourcedetection.elasticbeanstalk.DontEmitV0DeploymentConventions / EmitV1DeploymentConventions

| Field | Value |
|---|---|
| Category | NEW_FEATURE |
| Component | resourcedetectionprocessor |
| Component type | processor |
| Detection methods | feature-gates |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/issues/50130 |
| Affected config fields | — |
| Has test coverage | — |

Description: Elastic Beanstalk detector will stop emitting deprecated deployment.environment/service.instance.id in favor of deployment.environment.name/deployment.id once promoted. Alpha/off by default.

Recommended action: No action needed now; note for future semconv migration in resourcedetectionprocessor docs.

#### LOW-13 — New Alpha gate processor.resourcedetection.consul.prefixMetaAttributes

| Field | Value |
|---|---|
| Category | NEW_FEATURE |
| Component | resourcedetectionprocessor |
| Component type | processor |
| Detection methods | feature-gates |
| Upstream PR | https://github.com/open-telemetry/opentelemetry-collector-contrib/issues/49988 |
| Affected config fields | — |
| Has test coverage | — |

Description: Consul node metadata will be emitted as consul.meta.<key> instead of bare <key> once promoted. Alpha/off by default.

Recommended action: No action needed now; track for future default-behavior change in the Consul detector.

#### LOW-10 — Internal refactor: vendored clientauth logic replaces external googlecloudplatform dependency

| Field | Value |
|---|---|
| Category | COMPONENT_DRIFT |
| Component | googleclientauthextension |
| Component type | extension |
| Detection methods | code-diff |
| Upstream PR | — |
| Affected config fields | — |
| Has test coverage | — |

Description: config.go/factory.go now use an in-repo internal/clientauth package instead of importing github.com/GoogleCloudPlatform/opentelemetry-operations-go/extension/googleclientauthextension. A validation error message wording also changed. No mapstructure/config field changes detected.

Recommended action: No functional action required; note the dependency change if downstream vendors/tracks the GoogleCloudPlatform module directly for CVE/license scanning.

#### LOW-16 — Recurring nightly e2e failures against the collector-contrib development build

| Field | Value |
|---|---|
| Category | COMPONENT_DRIFT |
| Component | opentelemetry-operator (nightly e2e vs contrib-dev collector) |
| Component type | operator |
| Detection methods | issues |
| Upstream PR | — |
| Affected config fields | — |
| Has test coverage | true |

Description: Operator issue #5566 (opened 2026-09-08, OPEN) is the latest in a recurring pattern of 'Nightly e2e tests failed with contrib-dev collector' issues (also #5391, #5341, #5171, #5154, #5026, #5001, #4917, #4877 — roughly one every 1-4 weeks). This indicates ongoing drift/incompatibility between operator main and collector-contrib's unreleased development builds, a signal of integration fragility rather than one specific bug.

Recommended action: No specific downstream action; useful as a general signal that operator-vs-collector-contrib compatibility needs continuous nightly verification, which RHOSDT's own CI should already be doing against pinned release versions rather than dev builds.

#### LOW-17 — Several newer kafkareceiver top-level config blocks are undocumented

| Field | Value |
|---|---|
| Category | DOC_MISSING |
| Component | kafkareceiver |
| Component type | receiver |
| Detection methods | doc-validation |
| Upstream PR | — |
| Affected config fields | message_marking, partition_processing, header_extraction, error_backoff, telemetry, group_id, initial_offset, autocommit |
| Has test coverage | false |

Description: kafkareceiver.Config includes message_marking (after/on_error/on_permanent_error), partition_processing (independent/max_buffered_batches — requires autocommit.enable), header_extraction (extract_headers/headers), error_backoff (retry backoff for consumer errors), and telemetry.metrics.kafka_receiver_records_delay, none of which appear in the .adoc. Also group_id, initial_offset, autocommit, client_id, rack_id, metadata (from configkafka.ClientConfig/ConsumerConfig) are undocumented.

Recommended action: Add parameter descriptions for message_marking, partition_processing, header_extraction, error_backoff, telemetry, and the common ClientConfig/ConsumerConfig fields (group_id, initial_offset, autocommit, client_id).

#### LOW-18 — Multiple new tailsamplingprocessor top-level options are undocumented

| Field | Value |
|---|---|
| Category | DOC_MISSING |
| Component | tailsamplingprocessor |
| Component type | processor |
| Detection methods | doc-validation |
| Upstream PR | — |
| Affected config fields | decision_wait_after_root_received, block_on_overflow, decision_cache, sample_on_first_match, sampling_strategy, drop_pending_traces_on_shutdown, maximum_trace_size_bytes, num_shards |
| Has test coverage | false |

Description: otel-processors-tail-sampling-processor.adoc documents only decision_wait, num_traces, expected_new_traces_per_sec, and policies. The current Config struct also has: decision_wait_after_root_received, block_on_overflow, decision_cache (sampled_cache_size/non_sampled_cache_size), sample_on_first_match, sampling_strategy (trace-complete|span-ingest), drop_pending_traces_on_shutdown, maximum_trace_size_bytes, and num_shards.

Recommended action: Document each new field with its default and interaction notes (e.g. num_shards cannot exceed 256 and is incompatible with tail_storage; sampling_strategy must be trace-complete or span-ingest).

#### LOW-19 — New policy types and per-policy fields not documented

| Field | Value |
|---|---|
| Category | DOC_MISSING |
| Component | tailsamplingprocessor |
| Component type | processor |
| Detection methods | doc-validation |
| Upstream PR | — |
| Affected config fields | not, bytes_limiting, trace_flags, burst_capacity, invert_match |
| Has test coverage | false |

Description: Doc covers always_sample, latency, numeric_attribute, probabilistic, status_code, string_attribute, rate_limiting, span_count, trace_state, boolean_attribute, ottl_condition, and drop+composite. Missing: the not policy type, bytes_limiting policy type, trace_flags policy type, burst_capacity on rate_limiting/bytes_limiting, and invert_match on numeric_attribute/string_attribute/boolean_attribute; cache_max_size is only mentioned in passing.

Recommended action: Add sections for not/bytes_limiting/trace_flags policy types and document invert_match and burst_capacity on the existing policy types.

#### LOW-20 — Full configgrpc.ClientConfig surface (compression, keepalive, balancer_name, auth) undocumented

| Field | Value |
|---|---|
| Category | DOC_MISSING |
| Component | otlpexporter |
| Component type | exporter |
| Detection methods | doc-validation |
| Upstream PR | — |
| Affected config fields | compression, balancer_name, keepalive, auth, read_buffer_size, write_buffer_size |
| Has test coverage | false |

Description: Only endpoint/tls/headers from the squashed configgrpc.ClientConfig are documented. Fields such as compression, balancer_name, keepalive (client keepalive params), auth (authenticator extension reference), read_buffer_size, write_buffer_size, and wait_for_ready are not mentioned anywhere in the module.

Recommended action: Document compression, auth, balancer_name, and keepalive at least at a high level, or link to a shared 'common gRPC client settings' reference module.

#### LOW-21 — Common HTTP/gRPC server settings beyond TLS are undocumented

| Field | Value |
|---|---|
| Category | DOC_MISSING |
| Component | otlpreceiver |
| Component type | receiver |
| Detection methods | doc-validation |
| Upstream PR | — |
| Affected config fields | auth, include_metadata, max_recv_msg_size_mib, cors, traces_url_path, metrics_url_path, logs_url_path |
| Has test coverage | false |

Description: otel-receivers-otlp-receiver.adoc documents endpoint and tls for both grpc and http protocols but omits the rest of the squashed confighttp.ServerConfig/configgrpc.ServerConfig surface: max_recv_msg_size_mib, read/write buffer sizes, keepalive server parameters, include_metadata, auth (extension reference), and cors (HTTP-only) — as well as traces_url_path/metrics_url_path/logs_url_path for the HTTP protocol.

Recommended action: Add a short parameters list for auth, include_metadata, max_recv_msg_size_mib (gRPC), cors and the *_url_path overrides (HTTP), or link to a shared common-server-settings reference.

#### LOW-22 — No component-name drift found between docs and upstream type strings

| Field | Value |
|---|---|
| Category | COMPONENT_DRIFT |
| Component | filelog/kubeletstats/loadbalancing |
| Component type | — |
| Detection methods | doc-validation |
| Upstream PR | — |
| Affected config fields | — |
| Has test coverage | false |

Description: Checked the docs for the deprecated/alternate spellings called out in the task (file_log, kubelet_stats, load_balancing) — none appear. The .adoc files consistently use the canonical upstream component type strings filelog, kubeletstats, and loadbalancing, matching the factory type names in filelogreceiver, kubeletstatsreceiver, and loadbalancingexporter.

Recommended action: No action needed; keep as a passing check in future validation runs.

#### LOW-15 — Flaky upstream E2E test for k8sattributesprocessor attribute-scanner matching

| Field | Value |
|---|---|
| Category | TEST_COVERAGE |
| Component | processor/k8sattributes |
| Component type | processor |
| Detection methods | issues |
| Upstream PR | — |
| Affected config fields | k8sattributes processor extract.metadata / pod_association |
| Has test coverage | true |

Description: Open bug (collector-contrib#50630, opened 2026-08-31): upstream's own e2e test for k8sattributesprocessor is flaky because attribute scanners assert only on the first service match. This is a test-quality issue upstream, not a confirmed product regression, but it means upstream CI has reduced confidence in k8sattributesprocessor's matching behavior right now.

Recommended action: No action needed beyond awareness; if RHOSDT's own e2e suite exercises multi-service attribute-scanner matching, double-check it isn't hitting the same non-determinism.

#### LOW-27 — New upstream test suite added since base: targetallocator-otlp-selftelemetry

| Field | Value |
|---|---|
| Category | new-upstream-suite |
| Component | operator feature: target-allocator |
| Component type | — |
| Detection methods | test-coverage |
| Upstream PR | — |
| Affected config fields | — |
| Has test coverage | — |

Description: tests/e2e-targetallocator/targetallocator-otlp-selftelemetry/{00-assert.yaml,00-install.yaml,chainsaw-test.yaml} are new files present in origin/main but absent from the downstream base commit, covering target allocator OTLP self-telemetry. No corresponding downstream QE test was found.

Recommended action: Track this new upstream test suite in the next QE coverage review for the target allocator; no immediate action required.

#### LOW-28 — Upstream hardened a flaky OLM env-config propagation check

| Field | Value |
|---|---|
| Category | test-hardening |
| Component | operator feature: openshift-integration (env-config) |
| Component type | — |
| Detection methods | test-coverage |
| Upstream PR | — |
| Affected config fields | — |
| Has test coverage | — |

Description: tests/e2e-openshift/env-config/chainsaw-test.yaml changed between the base commit and origin/main to check the exact propagated LABELS_FILTER value (not just its presence) and raised a rollback timeout from 60s to 120s, addressing a known flakiness/race condition. This is a genuine, real upstream commit (unlike the e2e-otel deletions) and requires no downstream action beyond awareness.

Recommended action: No action needed; informational only.


## Confirmed Coverage Gaps

Components and operator features with no test at all — neither upstream nor QE. Anything with at least one of the two is considered covered, since the product build runs both suites.

- zpagesextension (extension) — documented, no upstream or QE test
- memorylimiterextension (extension) — undocumented, no upstream or QE test
- jaegerremotesampling (extension) — documented, no upstream or QE test
- pprofextension (extension) — documented, no upstream or QE test
- headerssetterextension (extension) — undocumented, no upstream or QE test
- spanprocessor (processor) — documented, no upstream or QE test
- cumulativetodeltaprocessor (processor) — documented, no upstream or QE test
- redactionprocessor (processor) — undocumented, no upstream or QE test
- spanmetricsconnector (connector) — documented, no upstream or QE test

