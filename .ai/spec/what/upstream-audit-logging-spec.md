# Upstream Audit Logging Specification Summary

Summary of the upstream OpenTelemetry Audit Logging specification being developed as part of the [Audit Logging SIG proposal](https://github.com/open-telemetry/community/pull/2409). The specification lives in the [apeirora/opentelemetry-specification](https://github.com/apeirora/opentelemetry-specification/tree/auditing/specification/audit) repo on the `auditing` branch. The [`signingprocessor`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/signingprocessor) in collector-contrib is a Phase 1 prototype artifact from this effort.

**Status**: Development (Phase 1 prototype). The OTel Governance Committee has not yet accepted the SIG — the team is running standalone and plans to return when Phase 1 results are ready.

## Core Concept

The upstream spec proposes **Audit Logging as a dedicated OTel signal**, separate from the existing Log signal. Audit records reuse the `LogRecord` protobuf as wire transport but travel through an independent pipeline with stricter guarantees: no sampling, no dropping, no transformation, at-least-once delivery.

The key insight is that compliance frameworks (ISO 27001, SOC 2, PCI-DSS, HIPAA) require audit records to be delivered **without loss, modification, or sampling** — properties the standard Log pipeline intentionally does not guarantee.

## Architecture

```
Application code
      |
      v
 AuditLogger.emit(AuditRecord) --> returns AuditReceipt
      |   RecordId (caller-generated)
      v
 AuditProvider  (no sampling, no dropping)
      |   +-- AuditRecordProcessor (enrich only, never redact or drop)
      |           +-- Simple processor (sync, default)
      |           +-- Batching processor (async, high-volume)
      |           +-- Signing processor (adds audit.integrity.value)
      v
 AuditExporter --> Tier-2 Collector (optional) --> Audit sinks
             or --> Audit sink directly                    |
                        |                    (OpenSearch, Splunk, S3 WORM)
                        +-- returns AuditReceipt
                              (RecordId + IntegrityHash + SinkTimestamp)
```

Three tiers:
1. **SDK (Tier-1)**: `AuditProvider` / `AuditLogger` / `AuditRecordProcessor` / `AuditRecordExporter`
2. **Collector (Tier-2)**: Optional intermediary that verifies integrity, validates hash chains, distributes to multiple sinks
3. **Audit sinks**: Final storage (OpenSearch, Splunk, S3 WORM, SIEM)

## Data Model

### AuditRecord

An `AuditRecord` is a `LogRecord` with mandatory `audit.*` semantic attributes:

| Attribute | Type | Required | Description |
|---|---|---|---|
| `audit.record.id` | string | MUST | Unique stable identifier (UUID v4 recommended) |
| `audit.actor.id` | string | MUST | Identity that performed the action |
| `audit.actor.type` | string | MUST | `user`, `service`, or `system` |
| `audit.action` | string | MUST | Verb describing what was done |
| `audit.outcome` | string | MUST | `success`, `failure`, or `unknown` |

Required LogRecord fields: `Timestamp`, `ObservedTimestamp`, `EventName`.

### AuditReceipt

Proof-of-delivery returned by the sink after persisting a record:

| Field | Type | Description |
|---|---|---|
| `RecordId` | string | Echoes `audit.record.id` |
| `IntegrityHash` | string | SHA-256 of the record as persisted |
| `SinkTimestamp` | fixed64 | When the sink wrote the record |

## Integrity Features

### Signing

The SDK `SigningProcessor` computes `audit.integrity.value` — a base64-encoded signature or HMAC over the JCS-canonical (RFC 8785) serialization of the record.

| Attribute | Scope | Description |
|---|---|---|
| `audit.integrity.value` | log record | Base64-encoded signature or MAC |
| `audit.integrity.signer` | log record | `producer` (SDK) or `collector` |
| `audit.integrity.algorithm` | resource | JWA identifier (RS256, ES256, EdDSA, HMAC-SHA256, HMAC-SHA512) |
| `audit.integrity.certificate` | resource | Certificate reference (fingerprint, full DER, key ID, SKI, or issuer+serial) |
| `audit.integrity.canonicalization` | log record | Canonicalization scheme (`jcs` default) |
| `audit.integrity.new_value` | log record | Incoming key's signature on key-transition records |

The spec explicitly distinguishes **producer signing** (SDK — attests point of action) from **collector signing** (attests pipeline custody). The two tiers answer different questions and should not be treated interchangeably.

### Hash Chaining

Optional ordering attributes for tamper-evidence across a sequence of records:

| Attribute | Type | Description |
|---|---|---|
| `audit.sequence.number` | int | Monotonic counter within a stream |
| `audit.sequence.previous_hash` | string | `IntegrityHash` of the preceding record |
| `audit.sequence.previous_record_id` | string | `audit.record.id` of the preceding record (resolvable locator) |
| `audit.sequence.stream_id` | string | Scopes the chain to a logical audit stream (UUID v4) |
| `audit.sequence.end` | bool | `true` on the final record of a gracefully closed stream |

Genesis: the first record of a stream MUST omit `previous_hash` and `previous_record_id` (no sentinel value).

### Key Rotation

When rotating signing keys, the SDK MUST emit a dedicated `audit.integrity.key-transition` record:
- `audit.integrity.value` carries the **outgoing** key's signature
- `audit.integrity.new_value` carries the **incoming** key's signature
- `Body` contains `incoming_key` metadata (certificate, fingerprint, key_id, algorithm)
- The outgoing key explicitly endorses the incoming key, preventing silent chain truncation

### Security Scope

The spec is honest about what hash chains do and don't provide:
- **Against an adversary without the signing key**: detects deletion, insertion, reordering of records
- **Against an adversary with the signing key**: cannot prevent fork attacks (two internally-consistent chains). Requires an external witness/cosigner — explicitly out of scope

## Delivery Guarantees

The SDK pipeline enforces:
- **No sampling**: `AuditProvider` MUST NOT accept sampler configuration
- **No dropping**: Queue MUST NOT silently discard records (disk-backed or unbounded in-memory)
- **No transformation**: Processors may only enrich (add attributes), never redact, filter, or aggregate
- **At-least-once delivery**: `emit()` blocks until the sink acknowledges, returns `AuditReceipt`
- **Hard errors on failure**: If delivery fails after retry budget, surface error to caller (never silently drop)
- **Idempotency**: `audit.record.id` is the dedup key; duplicate with same hash returns success, different hash returns 409

## Collector (Tier-2) Behavior

The collector exposes `/v1/audit` (dedicated endpoint, separate from `/v1/logs`) and:
- Verifies `audit.integrity.value` against configured trust policy
- Validates hash-chain continuity (`sequence.number`, `previous_hash`)
- Distributes to all required sinks before returning success
- MUST NOT return partial success — if any required sink fails, reject the entire batch
- May optionally re-sign records (`audit.integrity.signer: collector`) while preserving the original producer signature

## Serialization

Canonical form uses **RFC 8785 / JCS** (JSON Canonicalization Scheme):
- OTLP `AnyValue` scalars encoded as type-tagged wrapper objects (`{"stringValue": "foo"}`, `{"intValue": "123"}` — int values quoted as decimal strings to preserve int64 precision)
- Nanosecond timestamps and large int64 values serialized as decimal strings (avoids IEEE 754 precision loss)
- `audit.integrity.*` attributes excluded from signed payload
- `SeverityNumber` / `SeverityText` excluded (SHOULD NOT be set on audit records)
- `Body`, when set, included in signed payload

## Relevance to Our Signing Spec

See [`signing-upstream-comparison.md`](signing-upstream-comparison.md) for the detailed comparison. Key considerations:

1. **Attribute namespace**: Our spec uses `otel.signing.*`; the upstream uses `audit.integrity.*` and `audit.sequence.*`. If we want future alignment, adopting the upstream namespace would reduce migration cost.
2. **Serialization**: Our spec uses deterministic protobuf; the upstream uses JCS. The upstream processor already implements JCS with safety checks (UTF-8 validation, size limits, nesting depth). Aligning on JCS would allow interoperability with the upstream verification tooling.
3. **Features the upstream spec has that ours lacks**: hash chaining, stream IDs, key rotation protocol, genesis handling, producer-vs-collector distinction, canonicalization declaration, delivery guarantees (at-least-once, AuditReceipt), and honest scoping of security properties.
4. **Signal difference**: The upstream is logs-only (audit events). Our spec is traces-only (span signing). These could be complementary — audit events for compliance-critical actions, span signing for trace integrity — but the integrity mechanisms should ideally share a common foundation.
5. **Maturity**: The upstream spec is significantly more mature on integrity semantics, despite being in development status. The community discussion (including OCSF crosswalk, fork resistance analysis, key rotation protocols) has refined the design through multiple rounds of expert review.
