# Upstream Signing Processor Comparison

Comparative analysis of the upstream [`signingprocessor`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/signingprocessor) and [`verifyprocessor`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/verifyprocessor) in `opentelemetry-collector-contrib` versus the trace integrity signing feature specified in [`signing.md`](signing.md). This documents how the two approaches differ and what (if anything) can be reused.

The signing processor was donated as part of the upstream [Audit Logging SIG proposal](https://github.com/open-telemetry/community/pull/2409), which has an evolving [audit logging specification](https://github.com/apeirora/opentelemetry-specification/tree/auditing/specification/audit) covering signing, hash chaining, stream integrity, and canonicalization. See [`upstream-audit-logging-spec.md`](upstream-audit-logging-spec.md) for a full summary of that spec.

## Summary

Both processors sign telemetry data in the collector pipeline, but for different signals and with incompatible serialization. The upstream `signingprocessor` currently signs **log records** using JCS (JSON) for audit logging integrity. Our `signingprocessor` signs **trace spans** using deterministic protobuf for trace integrity. The two features are complementary — one signs audit logs, the other signs traces.

**Upstream trace support in progress:** [PR #52894](https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/52894) adds trace signal support to the upstream `signingprocessor`. It signs spans using the same JCS canonicalization and `audit.integrity.*` attributes already used for logs. The signed span payload covers TraceID, SpanID, ParentSpanID, name, kind, start/end timestamps, attributes, events, links, and status (excluding `audit.integrity.*` attributes, TraceState, Flags, and dropped counts). If this PR merges, the upstream processor would cover traces as well. The remaining difference would be the serialization format — the upstream uses JCS (a formally standardized canonical encoding, stable across languages and library versions), while our spec currently uses Go's deterministic protobuf marshaling, which is not a canonical encoding and is only guaranteed stable within the same Go program and protobuf library version (see [Serialization stability concern in signing.md](signing.md#canonical-serialization)). Given these limitations, adopting the upstream JCS approach should be considered.

## Side-by-Side Comparison

### Core Identity

| Dimension | Upstream `signingprocessor` | Spec'd trace integrity signing |
|---|---|---|
| Purpose | Audit logging integrity — signs log records in the collector | Trace integrity — signs trace spans in the collector |
| Signal | Logs only | Traces only |
| Stability | Development | Planned (TP) |
| Where signing happens | Collector (processor) | Collector (processor) |
| Verification | [`verifyprocessor`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/verifyprocessor) with strict/drop/mark failure modes | `signaturevalidationprocessor` with drop/flag policies |
| Upstream/downstream | Upstream (`open-telemetry/opentelemetry-collector-contrib`) | Downstream only (`redhat-opentelemetry-collector`) |

### Serialization

| | Upstream | Spec'd |
|---|---|---|
| Format | RFC 8785 / JCS (JSON Canonicalization Scheme) | Deterministic protobuf (`proto.MarshalOptions{Deterministic: true}`) |
| Signed content | Log record fields: EventName, Body, Timestamp, ObservedTimestamp, TraceID, SpanID, Attributes | Span fields: TraceID, SpanID, ParentSpanID, trace state, flags, name, kind, start/end timestamps, attributes (sorted), events, links, status, dropped counts |
| Excluded | `audit.integrity.*` attributes, SeverityNumber/Text, Flags | `otel.signing.*` attributes |
| Safety checks | UTF-8 validation, 2 MiB size limit, 128-level nesting depth | Attributes sorted by key |

**Why the upstream chose JCS over deterministic protobuf:**

1. **JCS is a formal standard (RFC 8785).** It defines a canonical byte sequence for any JSON value, stable across implementations and languages. Go's `proto.MarshalOptions{Deterministic: true}` is explicitly documented as not canonical — it only guarantees the same output from the same Go program with the same protobuf library version. Different library versions or language implementations may produce different bytes from identical data.
2. **Verification outside the OTel ecosystem.** Audit sinks (OpenSearch, Splunk, S3) store data as JSON. With JCS, a SIEM or compliance tool can verify signatures using standard JSON libraries without protobuf tooling.
3. **Human-readable.** The signed payload can be inspected without protobuf decoding tools, simplifying debugging and compliance audits.
4. **Cross-language interoperability.** JCS implementations exist in many languages with consistent behavior. Protobuf deterministic marshaling varies between Go, Java, and Python implementations.

Our spec uses deterministic protobuf because it avoids an OTLP-to-JSON conversion step (lower overhead), and the current scope is a single Go binary where stability is guaranteed. If cross-version or cross-language verification becomes a requirement, adopting JCS would align with the upstream approach and provide stronger interoperability guarantees.

### Algorithms

| Algorithm | Upstream | Spec'd |
|---|---|---|
| HMAC-SHA256 | Yes | Yes |
| ECDSA P-256 (ES256) | Yes | Yes |
| RSA (RS256, RS512) | Yes | No |
| EdDSA (Ed25519) | Yes | No |

### Attribute Names

| Information | Upstream | Spec'd | Semantic Match |
|---|---|---|---|
| Signature value | `audit.integrity.value` (log record attr) | `otel.signing.signature` (span attr) | **Equivalent.** Both hold a base64-encoded signature or MAC. |
| Algorithm | `audit.integrity.algorithm` (resource attr) | `otel.signing.algorithm` (span attr) | **Equivalent.** Both hold the algorithm identifier. Different scope — upstream sets once per ResourceLogs batch, ours repeats per span. |
| Key reference | `audit.integrity.certificate` (resource attr) | `otel.signing.key_id` (span attr) | **Similar.** Upstream is specifically a certificate reference (SHA-256 fingerprint or full DER encoding); not set for HMAC. Ours is a generic key identifier that works for both symmetric and asymmetric keys. |
| Signer origin | `audit.integrity.signer` = `"producer"` or `"collector"` (log record attr) | — | **Missing from ours.** Upstream distinguishes SDK-level signing ("producer") from collector-level signing ("collector"). |
| Verification status | `audit.verification.status` (`"verified"` or `"failed"`, set by `verifyprocessor`) | `otel.signing.valid` (boolean, span attr) | **Similar.** Upstream uses a string status with a separate `audit.verification.reason` for failure codes. Ours uses a boolean. |
| Verification reason | `audit.verification.reason` (machine-readable failure code) | — | **Missing from ours.** Upstream provides detailed failure codes (`missing_integrity_value`, `integrity_mismatch`, `unsupported_algorithm`, etc.). |
| Verification profile | `audit.verification.profile` (configured label) | — | **Missing from ours.** Upstream allows labeling which verification policy was applied. |

**Scope difference:** The upstream places algorithm and certificate at the Resource level (once per ResourceLogs batch), reducing per-record overhead. Our spec places everything at the span level (per-span), which is simpler but more verbose. If we adopted the upstream namespace, we could also adopt resource-level placement for algorithm and key reference.

**Alignment opportunity:** The core three attributes (signature, algorithm, key reference) are semantically equivalent. Adopting the upstream `audit.integrity.*` namespace would allow a single validation processor to verify both upstream-signed logs and our signed traces, and would avoid a namespace migration if the upstream audit logging spec is eventually accepted.

### Key Sources

| Source | Upstream | Spec'd |
|---|---|---|
| File | Yes | Yes |
| Environment variable | Yes (via confmap `${env:VAR}`) | Yes |
| Kubernetes / OpenShift Secret | Yes (via K8s API) | Yes |
| OpenBao / Vault | Yes | No |

### Architecture

**Upstream**: Two collector-side processors:
1. **[`signingprocessor`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/signingprocessor)**: Signs log records as they pass through the pipeline using JCS canonicalization.
2. **[`verifyprocessor`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/verifyprocessor)**: Verifies signatures on log records. Reconstructs the JCS-canonical payload and validates `audit.integrity.value`. Supports three failure modes: `strict` (reject entire batch), `drop` (drop failed records, export rest), and `mark` (annotate failures with `audit.verification.*` attributes). Also excludes its own `audit.verification.*` attributes from payload reconstruction, enabling chaining of sign→verify→sign→verify pipelines. Does not reject expired certificates (intentional for long-term audit log use cases). Logs only, development stability.

**Spec'd**: Two collector-side processors:
1. **Signing processor**: Signs spans in the collector pipeline, adding signature attributes. Runs in the sidecar or gateway collector closest to the application.
2. **Validation processor**: `signaturevalidationprocessor` verifies signatures at a downstream collector or gateway with configurable policies (`drop`/`flag` for invalid, `allow`/`drop`/`flag` for missing). Runs early in pipeline, before span-modifying processors. Includes observability metrics.

## Why the Upstream Processor Cannot Be Used Directly

1. **Wrong signal (being addressed).** The upstream processor currently implements `processor.Logs` only. However, [PR #52894](https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/52894) adds trace support. If merged, this blocker is removed.
2. **Incompatible serialization.** JCS (JSON) vs. deterministic protobuf. Both signer and verifier must agree on the canonical byte sequence. These formats produce different bytes from the same data. This remains the primary technical difference.

The attribute namespace difference (`audit.integrity.*` vs `otel.signing.*`) is not a blocker — a validation processor can be configured to source signatures from either namespace. If we adopt the upstream `audit.integrity.*` namespace, our validation processor would work with both upstream-signed logs and our signed traces without per-signal configuration.

