# Non-Repudiation Signing

Non-repudiation signing provides tamper detection and authenticity guarantees for trace data. A Go SDK component signs spans before export, and a collector processor validates signatures on ingestion. The feature is downstream-only, Go-only, and lives in `redhat-opentelemetry-collector`.

The entire signing feature is **[PLANNED: TRACING-6499] TP (Technology Preview)**.

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

## Behavioral Rules

### SDK Signing Component

1. **[PLANNED: TRACING-6499] TP**: The `SigningProcessor` signs spans before export using a pluggable backend (HMAC-SHA256, ECDSA P-256, or Sigstore).
2. The signing component consists of a `SpanProcessor` (computes signatures at `OnEnd()`) and an internal exporter wrapper (attaches signatures as span attributes at the protobuf level during export). This two-piece design is required because the Go SDK's `ReadOnlySpan` is immutable at `OnEnd()`.
3. The `SigningProcessor` is the customer-facing abstraction. The exporter wrapper is an internal implementation detail.
4. Signing operates per-span. Each span receives its own signature.

### Signing Backends

5. Three backends are supported behind a common `Signer`/`Verifier` interface:

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

6. The signing component writes three span attributes:

| Attribute | Type | Description |
|---|---|---|
| `otel.signing.signature` | string (base64) | The cryptographic signature |
| `otel.signing.algorithm` | string | `hmac-sha256`, `ecdsa-p256`, or `sigstore` |
| `otel.signing.key_id` | string | Identifier of the signing key |

### Canonical Serialization

7. Both signer and verifier must produce identical byte sequences from the same span data. The span is serialized to the OTLP protobuf `Span` message using deterministic marshaling (`proto.MarshalOptions{Deterministic: true}`). Attributes are sorted by key.
8. Signed content includes: Trace ID, Span ID, Parent Span ID, trace state, flags, span name, kind, start/end timestamps, all attributes (sorted), all events (ordered, attributes sorted), all links (ordered, attributes sorted), status, dropped counts.
9. The three signing attributes (`otel.signing.signature`, `otel.signing.algorithm`, `otel.signing.key_id`) are excluded from the signed content on both sides.

### Collector Validation Processor

10. **[PLANNED: TRACING-6499] TP**: The `signaturevalidationprocessor` validates signatures on incoming spans.
11. The processor runs early in the pipeline, before any span-modifying processors.
12. Verification backends are configured in precedence order. The processor matches the span's `otel.signing.algorithm` attribute against each backend. First match wins. If no backend matches, the span is treated as unsigned.
13. Configurable behavior on invalid signatures: `drop` (discard the span, log at debug level) or `flag` (set `otel.signing.valid=false`, pass through).
14. Configurable behavior on missing signatures: `allow` (pass through without flagging), `drop`, or `flag` (sets `otel.signing.valid=false`).
15. On successful verification, the processor sets `otel.signing.valid=true`.
16. Signals supported: traces only.

### SDK Usage

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

17. A pure `SpanExporter` wrapping approach could sign at the ResourceSpans level instead of per-span, reducing signing operations. This is documented but not implemented due to trade-offs: it requires reimplementing or forking the OTLP exporter (connection management, retry, TLS, compression), locks signing to OTLP only, and creates ongoing maintenance burden. If per-span signing proves to be a performance bottleneck, this alternative should be revisited.

## Configuration Surface

### SDK (Go)

| Field | Type | Default | Description |
|---|---|---|---|
| Backend | `Signer` interface | — | Signing backend (HMAC, ECDSA, or Sigstore) |
| KeyPath | string | — | Path to signing key file |

### Collector Processor

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

| Field | Type | Default | Description |
|---|---|---|---|
| verification.backends | list | — | Ordered list of verification backends (algorithm, key_source, key_path) |
| on_missing | enum | — | Action for unsigned spans: `allow`, `drop`, `flag` |
| on_invalid | enum | — | Action for failed verification: `drop`, `flag` |

## Observability

Collector processor metrics:

| Metric | Type | Description |
|---|---|---|
| `otel_signing_spans_verified_total` | Counter | Spans that passed verification |
| `otel_signing_spans_failed_total` | Counter | Spans that failed verification |
| `otel_signing_spans_missing_total` | Counter | Spans with no signature attributes |
| `otel_signing_verification_duration_seconds` | Histogram | Time to verify a signature |

## Relationship to Upstream Signing Processor

The upstream `signingprocessor` in `opentelemetry-collector-contrib` is a separate feature that signs **log records** for audit integrity. It cannot satisfy the non-repudiation requirements here: wrong signal (logs vs traces), wrong signing location (collector vs SDK), incompatible serialization (JCS vs deterministic protobuf), no verification component, and no Sigstore support. See [`signing-upstream-comparison.md`](signing-upstream-comparison.md) for the full comparative analysis.

## Constraints

1. All signing crypto must be FIPS-compliant (HMAC-SHA256 and ECDSA P-256 use Go standard library; Sigstore uses P-256 curves).
2. The signing component lives in `redhat-opentelemetry-collector` as a Go module. It is not upstreamed.
3. Go is the only supported language.
4. The canonical serialization approach must be benchmarked during implementation. Alternative serialization methods may be substituted if deterministic protobuf marshaling is too expensive.
