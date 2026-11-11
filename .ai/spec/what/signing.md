# Trace Integrity Signing

Trace integrity signing provides tamper-evidence for trace data in the collector pipeline. A collector processor signs spans as they pass through, and a downstream validation processor can verify signatures on ingestion. The feature is downstream-only and lives in `redhat-opentelemetry-collector`.

The entire signing feature is **[PLANNED: TRACING-6499] TP (Technology Preview)**.

## Architecture

```
+---------------------------+        OTLP        +------------------------------+
|   Application             | ------------------> |   Red Hat OTel Collector     |
|   (any language/SDK)      |                     |   (sidecar or gateway)       |
|                           |                     |                              |
|   No signing component    |                     |  Receivers                   |
|   required in the app     |                     |    +- OTLP                   |
|                           |                     |  Processors                  |
+---------------------------+                     |    +- signing                |
                                                  |    |   (signs spans)         |
                                                  |    |   +- HMAC-SHA256        |
                                                  |    |   +- ECDSA P-256        |
                                                  |    +- ...other processors... |
                                                  |  Exporters                   |
                                                  |    +- OTLP -> Tempo          |
                                                  |                              |
                                                  |  Span attributes added:      |
                                                  |   otel.signing.signature     |
                                                  |   otel.signing.algorithm     |
                                                  |   otel.signing.key_id        |
                                                  +------------------------------+
```

When the collector runs as a **sidecar** (same pod as the application), the trust boundary between app and collector is the pod itself — the risky network path is collector-to-backend, not app-to-collector. Collector-side signing covers the same integrity boundary that SDK-side signing would, without requiring a Go-only SDK component or changes to the application.

## Behavioral Rules

### Signing Processor

1. **[PLANNED: TRACING-6499] TP**: The `signingprocessor` signs spans in the collector pipeline using a pluggable backend (HMAC-SHA256 or ECDSA P-256).
2. The processor signs each span individually, adding signature attributes before the span continues through the pipeline.
3. Signing operates per-span. Each span receives its own signature.
4. The processor supports traces only.

### Signing Backends

5. Two backends are supported behind a common `Signer`/`Verifier` interface:

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

| Backend | Sign | Verify | Key Source | FIPS Compatible |
|---|---|---|---|---|
| HMAC-SHA256 | Shared secret | Same shared secret | OpenShift Secret, env var, file | Yes |
| ECDSA P-256 | Private key | Public key | PEM file, OpenShift Secret | Yes |

Both algorithms are sufficient for the spec's goal of **tamper-evidence** (detecting modification after signing). Neither provides non-repudiation — see the subsection below and [Design Rationale](#design-rationale-why-not-non-repudiation) for why non-repudiation was explicitly excluded.

#### Why These Algorithms Do Not Provide Non-Repudiation

Non-repudiation means the signer **cannot deny** having produced the data. It is a legal and cryptographic property that requires more than a signature algorithm — it requires an entire infrastructure stack. Neither algorithm used in this spec meets those requirements:

**HMAC-SHA256** is a symmetric algorithm. Both the signer and the verifier share the same secret key. Either party can produce a valid signature, so it is impossible to prove which one created it. Symmetric algorithms are fundamentally incompatible with non-repudiation.

**ECDSA P-256** is asymmetric — only the private key holder can produce a valid signature. This is necessary but not sufficient for non-repudiation. Without the surrounding infrastructure, the signer can plausibly claim the key was compromised, the signature was produced at a different time, or the key was not bound to their identity.

**Requirements for non-repudiation:**

| Requirement | Purpose | What's Missing From This Spec |
|---|---|---|
| Asymmetric cryptography | Only the signer holds the private key | HMAC-SHA256 is symmetric; ECDSA P-256 satisfies this requirement |
| Identity binding (X.509 PKI) | A certificate from a trusted CA ties the key to a specific entity | No certificate authority or identity chain |
| Trusted timestamping (RFC 3161) | An independent timestamp authority proves *when* the signature was created, preventing backdating | No timestamp authority |
| Key revocation (CRL/OCSP) | Compromised keys can be invalidated, bounding the window of trust | No revocation infrastructure |

**Technologies that approach non-repudiation:**

| Technology | How It Works | Trade-Off |
|---|---|---|
| Sigstore (Fulcio + Rekor) | Short-lived certificates tied to OIDC identity, recorded in a transparency log. Closest to turnkey non-repudiation for cloud-native workloads. | Requires OIDC provider, Fulcio CA, and Rekor transparency log. Was in the previous version of this spec but removed — see [Design Rationale](#design-rationale-why-not-non-repudiation). |
| Traditional X.509 PKI | CA-issued long-lived certificates, CRL/OCSP for revocation, RFC 3161 timestamping service. The enterprise standard. | Heavy to operate: requires running or contracting a CA, a timestamping authority, and revocation infrastructure. |
| Qualified Electronic Signatures (eIDAS) | Hardware security modules (HSMs), qualified CAs, qualified timestamps. Carries legal standing in the EU. | Extreme operational overhead. Designed for document signing, not high-throughput telemetry. |

None of these technologies are justified by the actual requirements — see [Tracing the Requirements](#tracing-the-requirements) for the analysis.

### Span Attributes

6. The signing processor writes three span attributes:

| Attribute | Type | Description |
|---|---|---|
| `otel.signing.signature` | string (base64) | The cryptographic signature |
| `otel.signing.algorithm` | string | `hmac-sha256` or `ecdsa-p256` |
| `otel.signing.key_id` | string | Identifier of the signing key |

### Canonical Serialization

7. Both signer and verifier must produce identical byte sequences from the same span data. The span is serialized to the OTLP protobuf `Span` message using deterministic marshaling (`proto.MarshalOptions{Deterministic: true}`). Attributes are sorted by key.
8. Signed content includes: Trace ID, Span ID, Parent Span ID, trace state, flags, span name, kind, start/end timestamps, all attributes (sorted), all events (ordered, attributes sorted), all links (ordered, attributes sorted), status, dropped counts.
9. The three signing attributes (`otel.signing.signature`, `otel.signing.algorithm`, `otel.signing.key_id`) are excluded from the signed content on both sides.

**Serialization stability concern:** Go's `proto.MarshalOptions{Deterministic: true}` is documented as producing deterministic output only within the same Go program built with the same protobuf library version. The Go protobuf documentation explicitly states this is not a canonical encoding — different library versions or different language implementations may produce different byte sequences from the same data. This means:

- Signatures produced by one collector binary version may fail verification after a collector upgrade if the protobuf library changed its deterministic encoding.
- Cross-language verification (e.g., a Java collector verifying signatures from a Go collector) is not guaranteed to work.
- Heterogeneous deployments with different collector versions may produce verification failures.

This is acceptable for the current scope (single Go binary signing and validating within the same deployment), but limits future interoperability. The upstream `signingprocessor` chose JCS (RFC 8785) — a formally standardized canonical JSON scheme — specifically to avoid this problem. If cross-version or cross-language verification becomes a requirement, JCS should be reconsidered as the serialization format. See [`signing-upstream-comparison.md`](signing-upstream-comparison.md) for the full serialization comparison.

### Collector Validation Processor

10. **[PLANNED: TRACING-6499] TP**: The `signaturevalidationprocessor` validates signatures on incoming spans at a downstream collector or gateway.
11. The validation processor runs early in the pipeline, before any span-modifying processors.
12. Verification backends are configured in precedence order. The processor matches the span's `otel.signing.algorithm` attribute against each backend. First match wins. If no backend matches, the span is treated as unsigned.
13. Configurable behavior on invalid signatures: `drop` (discard the span, log at debug level) or `flag` (set `otel.signing.valid=false`, pass through).
14. Configurable behavior on missing signatures: `allow` (pass through without flagging), `drop`, or `flag` (sets `otel.signing.valid=false`).
15. On successful verification, the processor sets `otel.signing.valid=true`.
16. Signals supported: traces only.

## Configuration Surface

### Signing Processor

```yaml
processors:
  signing:
    algorithm: hmac-sha256   # or ecdsa-p256
    key_source:
      type: file             # file | env | k8s_secret
      file:
        key_path: /etc/otel/keys/hmac.key
      # k8s_secret:
      #   name: signing-secret
      #   namespace: default
      #   key: hmac.key
```

| Field | Type | Default | Description |
|---|---|---|---|
| algorithm | string | — | `hmac-sha256` or `ecdsa-p256` |
| key_source.type | string | — | `file`, `env`, or `k8s_secret` |
| key_source.file.key_path | string | — | Path to signing key file |
| key_source.k8s_secret.name | string | — | Kubernetes Secret name |
| key_source.k8s_secret.namespace | string | `default` | Kubernetes Secret namespace |
| key_source.k8s_secret.key | string | — | Key within the Secret data |

### Validation Processor

```yaml
processors:
  signature_validation:
    verification:
      backends:
        - algorithm: hmac-sha256
          key_source: file
          key_path: /etc/otel/keys/hmac.key
        - algorithm: ecdsa-p256
          key_source: file
          key_path: /etc/otel/keys/verify.pem
    on_missing: allow | drop | flag
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

## Design Rationale: Why Not Non-Repudiation

An earlier version of this spec was titled "Non-Repudiation Signing" and required SDK-side signing with Sigstore keyless signing support. That approach was removed after analysis showed that the actual requirements call for **tamper-evidence**, not non-repudiation, and that collector-side signing satisfies those requirements with significantly less complexity.

### What Changed and Why

**Non-repudiation** means the signer cannot deny having produced the data. It requires identity binding (who signed), trusted timestamping (when), certificate chains, and key revocation infrastructure. **Tamper-evidence** means modifications after signing are detectable — a strictly weaker but sufficient property.

The previous spec claimed non-repudiation but could not deliver it:

- **HMAC-SHA256 cannot provide non-repudiation.** It is a symmetric algorithm — both parties share the secret, so either party could have produced the signature.
- **ECDSA P-256 provides authentication but not non-repudiation** without certificate chains, trusted timestamping, and key revocation.
- **Only Sigstore approached non-repudiation** (OIDC identity binding, Rekor transparency log, short-lived Fulcio certificates), but at significant operational complexity — and nothing in the requirements asked for it.

### Tracing the Requirements

The requirement chain from the Jira tickets shows that non-repudiation was introduced without justification from compliance frameworks:

| Ticket | Title | What It Actually Asks For |
|---|---|---|
| [OBSDA-1416](https://redhat.atlassian.net/browse/OBSDA-1416) | Platform Observability for agentic AI audit | **Tamper-resistant** logging, WORM storage, integrity checks. No mention of non-repudiation. |
| [OBSDA-1453](https://redhat.atlassian.net/browse/OBSDA-1453) | Capturing Attestations in Traces | Hardware attestation for **code identity** (what code ran), not data signing. Links to EU AI Act compliance. |
| [OBSDA-1454](https://redhat.atlassian.net/browse/OBSDA-1454) | Non-repudiation signing in Traces | Where the term "non-repudiation" was introduced. Describes SDK SpanProcessor + W3C tracestate + Central Gateway Collector validation. |
| [TRACING-6499](https://redhat.atlassian.net/browse/TRACING-6499) | Attestation and Signing for OTEL collector data | Implementation epic. Ships with immutable storage in Tempo. |

The parent initiative (OBSDA-1416) asks for "tamper-resistant" logging — a property that tamper-evidence signing satisfies. OBSDA-1454 escalated this to "non-repudiation" without grounding in a specific compliance requirement.

### EU AI Act Analysis

EU AI Act Article 12 requires "automatic recording of events ('logs')" with traceability, but does not mandate non-repudiation, cryptographic signing, or any specific integrity mechanism. Industry consensus for AI Act compliance converges on tamper-evidence approaches: hash chains, WORM storage, and collector/gateway-level signing — not SDK-side non-repudiation.

### Why Collector-Side Signing Is Sufficient

Moving signing from the SDK to the collector provides several advantages:

1. **Language-agnostic.** Any OTel SDK (Go, Java, Python, .NET, etc.) can emit unsigned spans. No SDK component to maintain.
2. **Simpler deployment.** Key material lives in the collector (infrastructure), not in application code.
3. **Same trust boundary in sidecar mode.** When the collector runs as a sidecar in the same pod, the app-to-collector path is localhost. The untrusted path (collector-to-backend) is what the collector signs over.
4. **Alignment with upstream.** The upstream `signingprocessor` in `opentelemetry-collector-contrib` also signs in the collector. Collector-side signing aligns with the community direction.
5. **No Sigstore complexity.** Tamper-evidence does not need OIDC identity binding, transparency logs, or short-lived certificates.

### What Was Removed

- SDK-side `SigningProcessor` (Go `SpanProcessor` + exporter wrapper)
- Sigstore backend (Fulcio keyless signing, Rekor transparency log)
- Go-only language restriction
- Two-piece SDK design required by Go SDK `ReadOnlySpan` immutability
- Exporter API alternative discussion

## Relationship to Upstream Signing Processor

The upstream [`signingprocessor`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/signingprocessor) and [`verifyprocessor`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/verifyprocessor) in `opentelemetry-collector-contrib` sign and verify **log records** for audit integrity using JCS (RFC 8785) canonical JSON serialization. Our processors sign and verify **trace spans** using deterministic protobuf serialization. The two feature sets are complementary — one handles audit logs, the other handles traces — but use incompatible serialization formats and different attribute namespaces (`audit.integrity.*` vs `otel.signing.*`). See [`signing-upstream-comparison.md`](signing-upstream-comparison.md) for the full comparative analysis.

## Constraints

1. All signing crypto must be FIPS-compliant (HMAC-SHA256 and ECDSA P-256 use Go standard library).
2. The signing processors live in `redhat-opentelemetry-collector`. They are not upstreamed.
3. The canonical serialization approach must be benchmarked during implementation. Alternative serialization methods may be substituted if deterministic protobuf marshaling is too expensive.
