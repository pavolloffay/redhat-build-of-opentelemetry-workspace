# Collector Components for 3.12

New collector components proposed for RHOSDT 3.12 under OBSDA-1475. Each component enters as **TP (Technology Preview)**. One evaluated component (Logs Transform Processor) was excluded — rationale is documented inline.

## Log Deduplication Processor

**Support Level:** TP
**Upstream Stability:** Alpha (logs only)
**Ticket:** TRACING-6697
**Feature Request:** OBSDA-1456

### Use Cases on OCP

1. **Kubernetes Events Deduplication**: Kubernetes API exposes all changes to a CR, generating high-volume duplicate logs as objects transition through states (e.g., `ADDED` → `MODIFIED` → `MODIFIED` → `MODIFIED`). The log dedup processor aggregates these into a single record with a `log_count` attribute, reducing noise for downstream consumers like SIEM systems or Ansible Event Driven Automation (EDA). Real customer case: 04523104.
2. **Multi-Tenant Log Aggregation**: The `metadata_keys` configuration ensures logs arriving with different tenant IDs are aggregated into separate, independent buckets, preventing cross-tenant data contamination. Pairs with the `headers_setter` extension for tenant-aware routing.
3. **Log Volume and Storage Cost Reduction**: Aggregate repetitive logs (health checks, heartbeats, periodic status reports) before sending to storage backends.

### Configuration Options

| Option | Type | Default | Description |
|---|---|---|---|
| `interval` | duration | `10s` | Time window for aggregation. Logs within this interval are grouped and emitted as a single record. |
| `log_count_attribute` | string | `log_count` | Attribute name for the deduplication count on emitted logs. |
| `timezone` | string | `UTC` | Timezone for timestamp handling. |
| `conditions` | list(string) | — | OTTL conditions to filter which logs are deduplicated. Logs not matching conditions pass through unchanged. |
| `exclude_fields` | list(string) | — | Log body/attribute fields to exclude from the deduplication key (e.g., timestamps that differ between otherwise-identical logs). |
| `include_fields` | list(string) | — | If set, only these fields are used as the deduplication key. Mutually exclusive with `exclude_fields`. |
| `metadata_keys` | list(string) | — | Resource attribute keys used to partition deduplication buckets. Each unique combination of metadata key values gets an independent aggregation scope. |

Example configuration:

```yaml
processors:
  log_dedup:
    interval: 30s
    log_count_attribute: log_count
    metadata_keys:
      - k8s.namespace.name
      - k8s.pod.name
    conditions:
      - 'attributes["k8s.resource.name"] == "events"'
```

### Operator Integration

No operator changes required. The log dedup processor is a pure in-memory processor with no Kubernetes RBAC requirements and no ports to expose.

### Upstream Quality Assessment

- **Open issues**: 1 enhancement request (#43647 — preserve first occurrence timestamp). No open bugs.
- **Performance concern**: #50851 flags O(n^2) key lookup in shared `pkg/pdatautil` hashing used for deduplication keys. Not blocking for TP but should be monitored for high-cardinality deployments.
- **Maintenance**: Active — steady stream of feature PRs (OTTL conditions, multi-tenant `metadata_keys`, `include_fields`). Active codeowner (MikeGoldsmith).

**Upstream tickets to consider fixing:**

| Ticket | Summary | Priority |
|---|---|---|
| #50851 | `pkg/pdatautil` O(n^2) key lookup in `writeMapHash` | Medium — affects dedup performance at high cardinality |
| #43647 | Preserve first occurrence timestamp | Low — enhancement, not correctness |

---

## Syslog Exporter

**Support Level:** TP
**Upstream Stability:** Alpha (logs only)
**Ticket:** TRACING-6788

### Use Cases on OCP

1. **SIEM and Security Platform Integration**: Export OTel-collected logs to SIEM systems (Splunk, QRadar, ArcSight) that consume syslog. Common in regulated environments (government, financial services).
2. **Compliance and Audit Log Archiving**: Forward audit logs from OpenShift to syslog-based archival systems required by compliance frameworks (PCI-DSS, HIPAA, SOX).
3. **Open Standard Log Export**: syslog (RFC 5424/3164) is a widely supported standard for log forwarding across heterogeneous infrastructure.

### Documentation Note

The product documentation for the syslog exporter should reference and align with the **OCP Logging SIEM support documentation**. OCP Logging already documents syslog forwarding to SIEM systems — the OTEL docs should provide equivalent guidance covering the same SIEM targets and configuration patterns, ensuring users migrating from OCP Logging to OpenTelemetry have a consistent experience. Include a cross-reference to the OCP Logging docs for users evaluating both approaches.

### Configuration Options

| Option | Type | Default | Description |
|---|---|---|---|
| `endpoint` | string | *required* | Target syslog server address (host:port). |
| `network` | string | `tcp` | Transport protocol: `tcp`, `udp`, `unix`, `unixgram`. |
| `port` | int | `514` | Target port (can also be specified in `endpoint`). |
| `protocol` | string | `rfc5424` | Syslog message format: `rfc5424` or `rfc3164`. |
| `enable_octet_counting` | bool | `false` | Use octet counting framing (RFC 5425) for TCP transport. |
| `tls` | object | — | TLS configuration (cert, key, CA, insecure). Supports mTLS. |
| `retry_on_failure` | object | — | Retry configuration (enabled, initial_interval, max_interval, max_elapsed_time). |
| `sending_queue` | object | — | Queue configuration (enabled, num_consumers, queue_size). **Note:** `block_on_overflow: true` does not create backpressure — see #48041. |
| `timeout` | duration | `5s` | Connection timeout. |

Log attributes used for syslog formatting:

| Attribute | Maps to | Default |
|---|---|---|
| `appname` | APP-NAME field | — |
| `hostname` | HOSTNAME field | — |
| `priority` | PRI field | — |
| `structured_data` | STRUCTURED-DATA (RFC 5424 only) | — |
| `message` | MSG field | Log body |

Example configuration:

```yaml
exporters:
  syslog:
    endpoint: siem.example.com
    port: 514
    network: tcp
    protocol: rfc5424
    tls:
      insecure: false
      ca_file: /etc/otel/ca.crt
```

### Operator Integration

No operator changes required. The syslog exporter makes outbound connections only — no Kubernetes RBAC or Service ports needed.

### Upstream Quality Assessment

- **Open bugs**:
  - **#49234 — Frame injection via unescaped newlines**: Log attributes containing newlines can inject additional syslog frames, enabling SIEM record forgery. Security-adjacent, marked Stale. **Critical for compliance use cases** — the primary driver for this exporter.
  - **#48041 — No backpressure with `sending_queue` + `block_on_overflow: true`**: P1 bug on the syslog receiver but affects round-trip reliability.
- **Beta promotion**: #49729 — checklist entirely unchecked (config stability, defaults, production testing, docs all pending).
- **Maintenance**: Active — 3 codeowners, recent PRs (datagram support Sep 2026, octet counting Jun 2026).

**Upstream tickets to consider fixing:**

| Ticket | Summary | Priority |
|---|---|---|
| #49234 | Frame injection via unescaped newline in log attributes — SIEM record forgery | **High** — security-adjacent, directly undermines the compliance use case |
| #48041 | `sending_queue` + `block_on_overflow: true` doesn't create backpressure | Medium — affects reliability under load |
| #49729 | Promote syslog exporter to beta (checklist) | Low — aspirational, tracks upstream progress |

---

## Webhook Event Receiver (Existing — TP since 3.11)

**Support Level:** TP (keep for 3.12 — not ready for GA)
**Upstream Stability:** Beta (logs only)
**Tickets:** TRACING-6641 (add to distro, In Progress), TRACING-6642 (docs, In Progress)

The webhook event receiver was added as TP in RHOSDT 3.11. This section covers 3.12 updates and operator improvements.

### Use Cases on OCP

1. **Audit Log Collection via Webhooks**: Collect audit logs from applications that offer HTTP webhooks but lack OTLP endpoints (CI/CD systems, SaaS platforms).
2. **CI/CD Pipeline Events**: Ingest events from CI/CD pipelines (Tekton, Jenkins, GitHub Actions) directly into the collector for observability correlation.
3. **Batch Log Splitting**: Split logs sent in batches or NDJSON format into individual OTEL log records.

### Configuration Options

| Option | Type | Default | Description |
|---|---|---|---|
| `endpoint` | string | `localhost:8088` | HTTP listen address. |
| `path` | string | `/events` | URL path for receiving webhook events. **Must include leading `/`** — see #50893. |
| `health_path` | string | `/health` | URL path for health checks. |
| `read_timeout` | duration | `500ms` | Read timeout for HTTP requests. |
| `write_timeout` | duration | `500ms` | Write timeout for HTTP responses. |
| `required_header.key` | string | — | HMAC authentication header name. |
| `required_header.value` | string | — | HMAC secret value for signature verification. |

Example configuration:

```yaml
receivers:
  webhook_event:
    endpoint: 0.0.0.0:8088
    path: /events
    required_header:
      key: X-Hub-Signature-256
      value: "${env:WEBHOOK_SECRET}"
```

### Operator Improvements (3.12)

**[PLANNED: needs TRACING ticket]** Register a receiver parser for `webhook_event` in the operator's component registry (`internal/components/receivers/helpers.go`). Currently the operator falls back to a generic handler that cannot auto-detect the default HTTP port (8088). This means:

- Users must manually configure Service ports in their OpenTelemetryCollector CR
- No automatic Service creation for the webhook endpoint
- Inconsistent UX compared to OTLP, Jaeger, Zipkin receivers which get auto-detected

The fix is ~10 lines: register `webhook_event` (with alias `webhookeventreceiver`) as a `SinglePortParser` with default port 8088.

### GA Blockers

The webhook event receiver is **not ready for GA** in 3.12 due to:

1. **#50893 — Panic on path misconfiguration**: Missing leading `/` in `path` or `health_path` causes a panic in `httprouter`, holding the port and blocking restart. Production deployments cannot tolerate unrecoverable crashes from a config typo. Needs upstream fix (validate at config load time).
2. Upstream naming migration in progress (`webhookeventreceiver` → `webhook_event`).

**Upstream tickets to consider fixing:**

| Ticket | Summary | Priority |
|---|---|---|
| #50893 | Path misconfiguration causes panic and port-binding loop | **High** — blocks GA, config validation fix |
| #50730 | Add `SplitLogsAsArray` mode for JSON arrays | Low — enhancement |

---

## Excluded: Logs Transform Processor

**Decision:** Do not include in RHOSDT 3.12.
**Ticket:** TRACING-6698 (cancelled)

### Rationale

1. **Upstream stability is `development`** — the lowest tier, below alpha. The component is explicitly excluded from all upstream distributions (`distributions: []` in metadata.yaml).
2. **Explicitly slated for deprecation** — upstream issue #19775 proposes deprecation. The README states: "its functionality will be reimplemented in the transform processor in the future."
3. **Quality concerns**: Open bug #31140 (wrong context in long-running tasks, open since Apr 2024). Three merged PRs skip flaky tests (#9773, #13219, #17448). Only 1 active codeowner.
4. **Alternative exists**: The Transform Processor (already GA in RHOSDT) covers log transformation via OTTL. The OTTL roadmap (#18643) is actively porting Stanza operators into the transform processor.

### Recommendation

Document OTTL-based log transformation patterns in the Transform Processor docs section. For users needing advanced parsing of non-filelog logs (the primary logstransform use case), provide OTTL examples for:
- Regex parsing of unstructured log bodies
- Timestamp extraction and normalization
- Severity mapping from raw text

## Constraints

1. All new components enter as TP. Promotion to GA requires: upstream stability at Beta or higher, no open P1/security bugs, production validation on OCP, and complete documentation.
2. The logs transform processor is excluded from the distro despite having a TRACING ticket. The ticket should be closed as "Won't Do" with a reference to this spec.
3. The syslog exporter's frame injection bug (#49234) must be tracked and ideally fixed before any consideration of GA promotion. Users should be warned in docs that log attributes containing newlines may cause malformed syslog messages.
