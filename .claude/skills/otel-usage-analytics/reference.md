# OpenTelemetry Usage Analytics — Reference

Background detail for `otel-usage-analytics`: collection limits, which fields are
collected vs. stripped, the raw CR data shape, and the standard query template
with CTE explanations. See [queries-insights-crs.md](queries-insights-crs.md) and [queries-olm.md](queries-olm.md) for ready-to-run queries.

## Collection Limits

### 5 CR Limit Per Cluster

**Only the first 5 OpenTelemetryCollector CRs per cluster are collected.**

Source: `gather_opentelemetry_collectors.go` line 85:
```go
const limit = 5
```

**Implications**:
- Clusters with >5 CRs have incomplete data
- Component usage queries **undercount** if 6th+ CRs use different components
- **No metadata is stored** indicating truncation occurred or total CR count
- Cannot definitively identify which clusters hit the limit (can only detect clusters with exactly 5 CRs as "suspicious")
- For an **uncapped** collector CR count, use `OPENSHIFTTELEMETRY_DB.MARTS.CLUSTER_USAGE_RESOURCES_SUM` ([queries-olm.md](queries-olm.md) query 6)

**Detection query** (clusters that might be truncated):
```sql
SELECT system_id, COUNT(*) AS cr_count
FROM (
  SELECT a.system_id, a.file_path
  FROM LIGHTSPEEDARCHIVES_DB.INSIGHTS_MARTS.ARCHIVES a
  WHERE a.service_id = 'insights_daily'
    AND a.received_on = '2026-08-24'
    AND a.file_path LIKE 'config/opentelemetry/%'
    AND a.content:kind::STRING = 'OpenTelemetryCollector'
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY a.system_id, a.file_path
    ORDER BY a.received_at DESC NULLS LAST
  ) = 1
)
GROUP BY system_id
HAVING COUNT(*) = 5;
```

## Fields Collected

### Collected (Full Data)

**Metadata**:
- `metadata.name` - CR name
- `metadata.namespace` - CR namespace
- `metadata.uid` - unique identifier
- `metadata.creationTimestamp` - creation time
- `metadata.generation` - update counter
- `metadata.resourceVersion` - K8s version

**spec.config.service** (ONLY the service section):
- `service.pipelines.<signal_type>` - pipeline definitions
  - `pipelines.<signal>/receivers[]` - array of receiver component references
  - `pipelines.<signal>/processors[]` - array of processor component references
  - `pipelines.<signal>/exporters[]` - array of exporter component references
  - `pipelines.<signal>/connectors[]` - array of connector component references
- `service.extensions[]` - array of extension component references
- `service.telemetry` - collector's own telemetry config

**Other spec fields**:
- `spec.mode` - deployment mode (deployment/daemonset/statefulset/sidecar)
- `spec.replicas` - replica count
- `spec.managementState` - managed/unmanaged
- `spec.upgradeStrategy` - upgrade strategy
- `spec.targetAllocator` - target allocator config
- `spec.deploymentUpdateStrategy`
- `spec.observability`
- `spec.resources`

**Status**:
- `status.image` - collector image reference
- `status.version` - collector version
- `status.scale` - scale information

### NOT Collected (Stripped for Privacy)

The top-level component **configuration definitions** are removed by `cleanCollectorSpecConfig()`:

- `spec.config.receivers.<name>` - receiver configs (may contain endpoints, credentials)
- `spec.config.exporters.<name>` - exporter configs (may contain API keys, URLs, tokens)
- `spec.config.processors.<name>` - processor configs (may contain PII transformation rules)
- `spec.config.extensions.<name>` - extension configs (may contain auth tokens)
- `spec.config.connectors.<name>` - connector configs

**What this means**: You can see WHICH components are referenced in pipelines (e.g., `["otlp", "batch", "otlp_http"]`), but NOT their configuration (e.g., endpoint URLs, auth credentials, sampling rates).

Source: `gather_opentelemetry_collectors.go` lines 50-72 (`cleanCollectorSpecConfig` function)

## Data Structure

### Component Name Format

Component references use the format: `<type>[/<instance-name>]`

Examples:
- `otlp` - single instance, no name
- `otlphttp/dynatrace_saas` - named instance
- `transform/normalize` - named instance

**For queries**: Use `SPLIT_PART(component_name, '/', 1)` to extract the component type.

### Pipeline Name Format

Pipeline keys use the format: `<signal>[/<name>]`

Examples:
- `logs` - single logs pipeline
- `traces/production` - named traces pipeline
- `metrics/mybackend` - named metrics pipeline

**For queries**: Use `SPLIT_PART(pipeline_key, '/', 1)` to extract the signal type (logs/metrics/traces).

### Sample CR Structure (as stored in archive)

```json
{
  "kind": "OpenTelemetryCollector",
  "metadata": {
    "name": "otel",
    "namespace": "openshift-opentelemetry-operator",
    "uid": "3a3d8225-d567-45a1-b938-1f34b69d43a4"
  },
  "spec": {
    "mode": "deployment",
    "config": {
      "service": {
        "pipelines": {
          "logs": {
            "receivers": ["otlp"],
            "processors": ["batch", "transform/normalize"],
            "exporters": ["otlphttp/dynatrace_saas"]
          },
          "metrics": {
            "receivers": ["otlp", "prometheus"],
            "exporters": ["otlp_grpc"]
          }
        },
        "extensions": ["health_check", "pprof"],
        "telemetry": {
          "metrics": {
            "readers": [...]
          }
        }
      }
    }
  },
  "status": {
    "image": "registry.redhat.io/rhosdt/opentelemetry-collector-rhel9@sha256:...",
    "version": "0.144.0"
  }
}
```

## Standard Query Pattern

All queries should follow this structure:

```sql
-- <Query Title>
-- Source: LIGHTSPEEDARCHIVES_DB.INSIGHTS_MARTS.ARCHIVES (insights_daily)
-- Date: received_on = 'YYYY-MM-DD'
-- Grain: <one row per...>
-- Cluster filter: external, non-CI, not redhat.com/ibm.com, not Eval/Self-support

WITH clusters_dedup AS (
  -- Filter to external customer clusters
  SELECT cluster_id
  FROM OPENSHIFT_DB.MARTS.CLUSTERS
  WHERE COALESCE(internal, FALSE) = FALSE
    AND COALESCE(ci, FALSE) = FALSE
    AND (
      email_domain IS NULL
      OR (
        LOWER(email_domain) NOT LIKE '%redhat.com'
        AND LOWER(email_domain) NOT LIKE '%ibm.com'
      )
    )
    AND LOWER(COALESCE(support, '')) NOT IN ('eval', 'self-support')
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY cluster_id
    ORDER BY last_report_on DESC NULLS LAST
  ) = 1
),
crs AS (
  -- Get latest archive per cluster per CR
  SELECT
    a.system_id,
    a.file_path,
    a.content:spec:config:service:pipelines AS pipelines,
    a.content:spec:config:service:extensions AS extensions,
    a.content:spec:mode::STRING AS mode
  FROM LIGHTSPEEDARCHIVES_DB.INSIGHTS_MARTS.ARCHIVES a
  WHERE a.service_id = 'insights_daily'
    AND a.received_on = '2026-08-24'  -- Use current date
    AND a.file_path LIKE 'config/opentelemetry/%'
    AND a.content:kind::STRING = 'OpenTelemetryCollector'
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY a.system_id, a.file_path
    ORDER BY a.received_at DESC NULLS LAST
  ) = 1
)
-- ... rest of query
```

### Key CTE Explanations

**CTE** = Common Table Expression — a temporary named result set defined with `WITH` that you can reference within a query. CTEs make complex queries more readable by breaking them into logical steps.

**clusters_dedup**:
- Filters to external customer clusters (excludes internal Red Hat clusters)
- Excludes CI/test clusters
- Excludes Red Hat/IBM employee clusters (by email domain) — see "Cluster Filtering Logic" below
- Excludes evaluation and self-support clusters
- Takes latest report per cluster (handles duplicate cluster records)

### Cluster Filtering Logic

The `clusters_dedup` CTE filters out internal Red Hat and IBM clusters to focus on external customer usage:

**Why exclude Red Hat/IBM email domains?**
- Red Hat and IBM employees run internal development, testing, and staging clusters
- These internal clusters often have experimental configurations not representative of customer usage
- Including them would skew adoption metrics and component usage statistics
- Customer-facing product decisions should be based on actual customer behavior, not internal testing

**Filter criteria:**
```sql
LOWER(email_domain) NOT LIKE '%redhat.com'  -- Exclude internal Red Hat clusters
AND LOWER(email_domain) NOT LIKE '%ibm.com'  -- Exclude internal IBM clusters
```

**Additional filters:**
- `COALESCE(internal, FALSE) = FALSE` — excludes clusters marked as internal
- `COALESCE(ci, FALSE) = FALSE` — excludes CI/test clusters
- `LOWER(COALESCE(support, '')) NOT IN ('eval', 'self-support')` — excludes evaluation and self-support clusters

These filters ensure metrics reflect production customer usage patterns.

**crs**:
- Filters to OpenTelemetryCollector CRs
- Extracts commonly-used fields from JSON
- Deduplicates to latest archive per `(system_id, file_path)` - handles multiple archives per day
