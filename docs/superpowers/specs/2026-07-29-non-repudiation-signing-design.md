# Non-Repudiation Signing in Traces

**Jira:** [TRACING-6499](https://redhat.atlassian.net/browse/TRACING-6499) (Epic), parent: [OBSDA-1454](https://redhat.atlassian.net/browse/OBSDA-1454) (Feature)
**Support Level:** Technology Preview
**Scope:** Go SDK signing component + collector validation processor
**Repo:** `redhat-opentelemetry-collector`

## Overview

Non-repudiation signing for OpenTelemetry traces provides tamper detection and authenticity guarantees for span data. Two components work together: a Go SDK component signs spans before export, and a collector processor validates signatures before ingestion into a backend (e.g., Tempo).

This is a downstream-only feature targeting Technology Preview. Go is the only supported language.

## Architecture

```
+---------------------------+        OTLP        +------------------------------+
|   Customer Go App         | ------------------> |   Red Hat OTel Collector     |
|                           |                     |                              |
|  OTel SDK                 |                     |  Receivers                   |
|    +- SigningProcessor    |                     |    +- OTLP                   |
|    |   (SpanProcessor +   |                     |  Processors                  |
|    |    exporter wrapper)  |                     |    +- signaturevalidation    |
|    |                      |                     |         |                    |
|    +- Signing backends    |                     |         +- on valid: pass    |
|         +- HMAC-SHA256    |                     |         +- on invalid: drop/ |
|         +- ECDSA P-256    |                     |              flag            |
|         +- Sigstore       |                     |         +- verify backends   |
|                           |                     |  Exporters                   |
|  Span attributes:         |                     |    +- OTLP -> Tempo          |
|   otel.signing.signature  |                     +------------------------------+
|   otel.signing.algorithm  |
|   otel.signing.key_id     |
+---------------------------+
```

## SDK Signing Component

### SpanProcessor + Exporter Wrapper

The signing component consists of two internal pieces:

1. **`SigningProcessor`** (implements `sdktrace.SpanProcessor`): In `OnEnd()`, serializes the span canonically, signs it using the configured backend, and stores the signature in an internal concurrent map keyed by span context.

2. **Internal exporter wrapper**: Retrieves pre-computed signatures from the processor's map and attaches `otel.signing.signature`, `otel.signing.algorithm`, and `otel.signing.key_id` as span attributes at the protobuf level during export.

This two-piece design is necessary because the Go SDK's `ReadOnlySpan` interface (received at `OnEnd`) is immutable — it includes a `private()` method that prevents external implementation, and `SetAttributes()` is a no-op after `End()` is called. The only mutable access point (`OnStart`) receives an incomplete span (no end time, events/attributes may still be added), which makes it unsuitable for signing.

The `SigningProcessor` is the customer-facing abstraction. The exporter wrapper is an internal implementation detail.

### Usage

```go
import "github.com/openshift/redhat-opentelemetry-collector/pkg/signing"

signer, err := signing.NewHMACSigner(signing.HMACConfig{
    KeyPath: "/etc/otel/keys/hmac.key",
})

tp := sdktrace.NewTracerProvider(
    sdktrace.WithSpanProcessor(signing.NewSigningProcessor(signer)),
    sdktrace.WithBatcher(otlpExporter),
)
```

### Exporter API Alternative

A pure `SpanExporter` wrapping approach could sign at the ResourceSpans level instead of per-span, reducing signing operations (e.g., one sign per batch of 512 spans sharing a Resource). However, this approach has significant trade-offs:

- **Must replace, not wrap, the OTLP exporter.** `SpanExporter.ExportSpans()` takes `[]ReadOnlySpan`. The signing exporter must convert to protobuf, add signatures, and handle OTLP export directly — it cannot pass modified data back through the `ExportSpans` interface to an inner exporter. This means reimplementing or forking connection management, retry logic, compression, TLS, and batching.
- **Locked to OTLP.** The signing exporter cannot compose with non-OTLP exporters (debug, Jaeger, Kafka).
- **Maintenance burden.** Must track upstream OTLP exporter changes (config options, protocol updates, bug fixes).

If serialization benchmarks during implementation show per-span signing is a performance bottleneck, this approach should be revisited.

## Signing Backends

Three pluggable backends behind a common interface:

```go
type Signer interface {
    Sign(data []byte) ([]byte, error)
    Algorithm() string
    KeyID() string
}

type Verifier interface {
    Verify(data []byte, signature []byte) (bool, error)
    Algorithm() string
}
```

| Backend | SDK (sign) | Collector (verify) | Key Source | FIPS Compatible |
|---|---|---|---|---|
| HMAC-SHA256 | Shared secret | Same shared secret | OpenShift Secret, env var, file | Yes |
| ECDSA P-256 | Private key | Public key | PEM file, OpenShift Secret | Yes |
| Sigstore | Fulcio keyless signing (OIDC identity) | Rekor transparency log + Fulcio root | OpenShift Sigstore integration | Yes (P-256 curves) |

### Span Attributes

| Attribute | Type | Example |
|---|---|---|
| `otel.signing.signature` | string (base64) | `dGVzdC1zaWc=...` |
| `otel.signing.algorithm` | string | `hmac-sha256`, `ecdsa-p256`, `sigstore` |
| `otel.signing.key_id` | string | `my-signing-key-1` |

## Canonical Serialization

Both the SDK signer and collector verifier must produce identical byte sequences from the same span data. Any divergence breaks verification.

**Approach:** Serialize the span to the OTLP protobuf `Span` message using deterministic marshaling (`proto.MarshalOptions{Deterministic: true}`). Attributes are sorted by key before serialization to ensure determinism.

**Signed content includes:**
- Trace ID, Span ID, Parent Span ID
- Trace state, flags
- Span name, kind
- Start/end timestamps
- All attributes (sorted by key)
- All events (in order, with their attributes sorted by key)
- All links (in order, with their attributes sorted by key)
- Status (code + message)
- Dropped counts

**Excluded from signed content** (stripped before serialization on both sides):
- `otel.signing.signature`
- `otel.signing.algorithm`
- `otel.signing.key_id`

**Implementation note:** Run serialization benchmarks during implementation. If deterministic protobuf marshaling proves too expensive, alternative serialization approaches (e.g., hash-based canonical form, custom binary encoding) should be evaluated.

## Collector Validation Processor

A new processor in the Red Hat collector distro: `signaturevalidationprocessor`.

### Configuration

```yaml
processors:
  signature_validation:
    verification:
      # Backends listed in precedence order.
      # The processor matches the span's otel.signing.algorithm
      # attribute against each backend in order. First match wins.
      # If no backend matches, the span is treated as unsigned
      # (on_missing applies).
      backends:
        - algorithm: hmac-sha256
          key_source: file
          key_path: /etc/otel/keys/hmac.key
        - algorithm: ecdsa-p256
          key_source: file
          key_path: /etc/otel/keys/verify.pem
        - algorithm: sigstore
          rekor_url: https://rekor.sigstore.dev

    # What to do with unsigned spans (no signature attributes present)
    on_missing: allow | drop | flag

    # What to do when signature verification fails
    on_invalid: drop | flag
```

### Behavior

- Runs early in the processor chain, before any span-modifying processors.
- Strips the three signing attributes, re-serializes using the same canonical format, verifies the signature.
- `on_invalid: flag`: sets `otel.signing.valid=false` and passes the span through.
- `on_invalid: drop`: drops invalid spans silently (logged at debug level).
- `on_missing: flag`: sets `otel.signing.valid=false` (unsigned spans are treated as invalid for flagging purposes) and passes the span through.
- `on_missing: drop`: drops unsigned spans silently (logged at debug level).
- `on_missing: allow`: passes unsigned spans through without any flag attribute, for mixed environments during rollout.
- On successful verification: sets `otel.signing.valid=true`.
- Signals supported: traces only.

## Testing

- Unit tests for each signing backend (HMAC, ECDSA, Sigstore) — sign/verify round-trip.
- Unit tests for canonical serialization — determinism, attribute ordering, exclusion of signing attributes.
- Integration test: SDK signing processor -> OTLP -> collector validation processor -> verify pass/fail.
- Negative tests: tampered spans rejected, missing signatures handled per config, wrong algorithm rejected.
- Serialization benchmarks to validate the protobuf deterministic marshaling approach.

## Observability

Collector processor metrics:

| Metric | Type | Description |
|---|---|---|
| `otel_signing_spans_verified_total` | Counter | Spans that passed verification |
| `otel_signing_spans_failed_total` | Counter | Spans that failed verification |
| `otel_signing_spans_missing_total` | Counter | Spans with no signature attributes |
| `otel_signing_verification_duration_seconds` | Histogram | Time to verify a signature |

## Decisions Log

| Decision | Choice | Alternatives Considered |
|---|---|---|
| Scope | Collector validation + Go SDK signing | Collector-only; full stack with auto-instrumentation |
| Signing mechanism | Pluggable: HMAC, ECDSA, Sigstore | Single algorithm only |
| Signed content | Full span content | Core identity only; configurable subset |
| Signature storage | Span attributes | W3C tracestate; both tracestate + attributes |
| Validation failure | Configurable: drop or flag | Fixed behavior; route to separate pipeline |
| Upstream strategy | Downstream-only | Upstream-first; hybrid |
| Repo structure | Single repo (redhat-opentelemetry-collector) | Two repos; three repos |
| SDK interception point | SpanProcessor + exporter wrapper | Pure SpanExporter; SpanProcessor only |
| Support level | Technology Preview | GA |
| Language support | Go only | Multi-language |
