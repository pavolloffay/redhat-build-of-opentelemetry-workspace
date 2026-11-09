# Upstream Signing Processor Comparison

Comparative analysis of the upstream `signingprocessor` in `opentelemetry-collector-contrib` versus the non-repudiation signing feature specified in [`signing.md`](signing.md). This documents why the upstream processor cannot satisfy TRACING-6499 requirements and what (if anything) can be reused.

## Summary

The upstream `signingprocessor` solves a different problem (audit log integrity) with a fundamentally different architecture (collector-only, logs, JCS serialization). The two features are complementary, not competing — one signs audit logs in the collector while the other provides non-repudiation for trace spans from the SDK. The spec requires building from scratch in `redhat-opentelemetry-collector`.

## Side-by-Side Comparison

### Core Identity

| Dimension | Upstream `signingprocessor` | Spec'd non-repudiation signing |
|---|---|---|
| Purpose | Audit logging integrity — signs log records in the collector | Non-repudiation — signs trace spans in the SDK, verifies in collector |
| Signal | Logs only | Traces only |
| Stability | Development | Planned (TP) |
| Where signing happens | Collector (processor) | SDK (Go `SpanProcessor` + exporter wrapper) |
| Verification | None — sign only | Full `signaturevalidationprocessor` with drop/flag policies |
| Upstream/downstream | Upstream (`open-telemetry/opentelemetry-collector-contrib`) | Downstream only (`redhat-opentelemetry-collector`) |

### Serialization

| | Upstream | Spec'd |
|---|---|---|
| Format | RFC 8785 / JCS (JSON Canonicalization Scheme) | Deterministic protobuf (`proto.MarshalOptions{Deterministic: true}`) |
| Signed content | Log record fields: EventName, Body, Timestamp, ObservedTimestamp, TraceID, SpanID, Attributes | Span fields: TraceID, SpanID, ParentSpanID, trace state, flags, name, kind, start/end timestamps, attributes (sorted), events, links, status, dropped counts |
| Excluded | `audit.integrity.*` attributes, SeverityNumber/Text, Flags | `otel.signing.*` attributes |
| Safety checks | UTF-8 validation, 2 MiB size limit, 128-level nesting depth | Attributes sorted by key |

### Algorithms

| Algorithm | Upstream | Spec'd |
|---|---|---|
| HMAC-SHA256 | Yes | Yes |
| ECDSA P-256 (ES256) | Yes | Yes |
| RSA (RS256, RS512) | Yes | No |
| EdDSA (Ed25519) | Yes | No |
| Sigstore (Fulcio keyless) | No | Yes |

### Attribute Names

| | Upstream | Spec'd |
|---|---|---|
| Signature | `audit.integrity.value` (log record attr) | `otel.signing.signature` (span attr) |
| Algorithm | `audit.integrity.algorithm` (resource attr) | `otel.signing.algorithm` (span attr) |
| Key reference | `audit.integrity.certificate` (resource attr) | `otel.signing.key_id` (span attr) |
| Signer origin | `audit.integrity.signer` = `"collector"` (log record attr) | — |
| Validation result | — | `otel.signing.valid` (boolean, span attr) |

Note: The upstream processor places algorithm and certificate at the Resource level (once per ResourceLogs block). The spec places everything at the span level (per-span).

### Key Sources

| Source | Upstream | Spec'd |
|---|---|---|
| File | Yes | Yes |
| Environment variable | Yes (via confmap `${env:VAR}`) | Yes |
| Kubernetes / OpenShift Secret | Yes (via K8s API) | Yes |
| OpenBao / Vault | Yes | No |
| Sigstore (Fulcio/Rekor) | No | Yes |

### Architecture

**Upstream**: Single collector-side processor. Signs log records as they pass through the pipeline. No SDK component. No verification counterpart. The collector is both the signer and the only component.

**Spec'd**: Two-component architecture spanning SDK and collector:
1. **SDK side**: `SigningProcessor` (`SpanProcessor` + internal exporter wrapper) signs spans before export. The two-piece design is required because the Go SDK's `ReadOnlySpan` is immutable at `OnEnd()`.
2. **Collector side**: `signaturevalidationprocessor` verifies signatures with configurable policies (`drop`/`flag` for invalid, `allow`/`drop`/`flag` for missing). Runs early in pipeline, before span-modifying processors. Includes observability metrics.

## Why the Upstream Processor Cannot Be Used

1. **Wrong signal.** The upstream processor implements `processor.Logs`, not `processor.Traces`. It has no trace support.
2. **Wrong signing location.** The spec requires signing in the SDK (customer's Go app), not in the collector. Non-repudiation means the signature must originate from the application — if the collector signs, it only proves the collector saw the data, not that the application produced it.
3. **Incompatible serialization.** JCS (JSON) vs. deterministic protobuf. Both signer and verifier must agree on the canonical byte sequence. These formats produce different bytes from the same data.
4. **No verification component.** The spec requires a validation processor with configurable drop/flag behavior and observability metrics. The upstream processor has no verification counterpart.
5. **Missing Sigstore support.** Required by the spec for keyless signing via Fulcio/Rekor, absent from the upstream processor.
6. **Different attribute semantics.** Different attribute names (`audit.integrity.*` vs `otel.signing.*`) and different placement (resource-level vs span-level).

## Reusable Patterns

The upstream code cannot be directly reused (it lives in a different repo with a different license scope), but several patterns and design decisions can inform the downstream implementation:

| Pattern | Upstream implementation | Applicability |
|---|---|---|
| Key material provider interface | `KeyMaterialProvider` with `GetPrivateKey()`, `GetCertificate()`, `GetHMACKey()` | The `Signer`/`Verifier` interface in the spec serves the same role. The file/k8s/env provider structure is a useful reference. |
| HMAC-SHA256 signing | `hmac.New(sha256.New, key)` + `mac.Write()` + `mac.Sum()` | Identical crypto — standard Go library usage. |
| ECDSA signing | `ecdsa.SignASN1(rand.Reader, ecKey, hashBytes)` | Same algorithm, same library. |
| Processor lifecycle | `Start`/`Shutdown`/`Capabilities` pattern, factory registration | Standard collector processor patterns. |
| Safety checks | UTF-8 validation, size limits, nesting depth caps | Good defensive practices to carry over, even with a different serialization format. |
