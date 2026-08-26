---
name: otel-cr-insights
description: >
  Write Snowflake queries to analyze OpenTelemetry Collector CR usage from
  insights archives. Understands data structure, collected fields, and limits.
argument-hint: "[query-description or use-case]"
---

# OpenTelemetry CR Insights Query Skill

Write Snowflake queries to analyze OpenTelemetry Collector custom resource usage patterns from Red Hat OpenShift insights archives.

## When to Use This Skill

Use this skill when:
- Writing queries to analyze OTel collector adoption, component usage, or configuration patterns
- Understanding what data is available from insights archives
- Need to know which CR fields are collected and which are stripped
- Checking data collection limits or potential gaps
- Building dashboards or reports on collector usage

## Data Source

**Snowflake Console**: https://app.snowflake.com/gdadclc/rhprod/#/homepage

**Database**: `LIGHTSPEEDARCHIVES_DB.INSIGHTS_MARTS.ARCHIVES`

**Service ID**: `insights_daily`

**File path pattern**: `config/opentelemetry/%` (format: `config/opentelemetry/{namespace}/{name}`)

**CR Kind**: `OpenTelemetryCollector` (from `opentelemetry.io/v1beta1`)

## How to Execute Queries

1. Navigate to the [Snowflake Console](https://app.snowflake.com/gdadclc/rhprod/#/homepage)
2. In the left sidebar, click **Projects** → **Worksheets**
3. Click **+ Worksheet** to create a new SQL worksheet
4. **IMPORTANT**: In the worksheet context selector (top right), select:
   - **Role**: `LIGHTSPEEDARCHIVES_INSIGHTSMARTS_GROUP` with `DEFAULT` warehouse
   - This role provides read access to the insights data
5. Paste your query into the worksheet
6. Click **Run** (or press `Ctrl+Enter` / `Cmd+Enter`) to execute
7. Results appear in the **Results** pane below the query editor
8. Optionally, click **⋮** (three dots) on the results pane to download as CSV or other formats

## Collection Implementation

The OpenTelemetry Collector CR collection is implemented in the insights-operator:

**Primary source file**: 
- https://github.com/openshift/insights-operator/blob/master/pkg/gatherers/clusterconfig/gather_opentelemetry_collectors.go

**Key function**: `gatherOpenTelemetryCollectors`

**API reference**:
- https://github.com/open-telemetry/opentelemetry-operator/blob/main/apis/v1beta1/opentelemetrycollector_types.go

**Sample archive data**:
- https://github.com/openshift/insights-operator/blob/master/docs/insights-archive-sample/config/opentelemetry/example-namespace/otel.json

## Collection Limits

### ⚠️ CRITICAL: 5 CR Limit Per Cluster

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

### ✅ Collected (Full Data)

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

### ❌ NOT Collected (Stripped for Privacy)

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

## Ready-to-Use Queries

The following queries are **complete and runnable** - just copy, paste into Snowflake, and update the date.

### Query 1: Component Usage by Type

Shows which receivers, processors, exporters, connectors, and extensions are most used across customer clusters.

```sql
-- Component Usage by Type
-- Returns: component_category, component_type, cluster_count
WITH clusters_dedup AS (
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
  SELECT
    a.system_id,
    a.content:spec:config:service:pipelines AS pipelines,
    a.content:spec:config:service:extensions AS extensions
  FROM LIGHTSPEEDARCHIVES_DB.INSIGHTS_MARTS.ARCHIVES a
  WHERE a.service_id = 'insights_daily'
    AND a.received_on = '2026-08-24'  -- UPDATE THIS DATE
    AND a.file_path LIKE 'config/opentelemetry/%'
    AND a.content:kind::STRING = 'OpenTelemetryCollector'
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY a.system_id, a.file_path
    ORDER BY a.received_at DESC NULLS LAST
  ) = 1
),
components_raw AS (
  SELECT
    c.system_id,
    'receiver' AS component_category,
    SPLIT_PART(rcv.value::STRING, '/', 1) AS component_type
  FROM crs c
  JOIN clusters_dedup cl ON cl.cluster_id = c.system_id,
  LATERAL FLATTEN(input => c.pipelines) pipeline,
  LATERAL FLATTEN(input => pipeline.value:receivers) rcv
  
  UNION ALL
  
  SELECT
    c.system_id,
    'processor' AS component_category,
    SPLIT_PART(proc.value::STRING, '/', 1) AS component_type
  FROM crs c
  JOIN clusters_dedup cl ON cl.cluster_id = c.system_id,
  LATERAL FLATTEN(input => c.pipelines) pipeline,
  LATERAL FLATTEN(input => pipeline.value:processors) proc
  
  UNION ALL
  
  SELECT
    c.system_id,
    'exporter' AS component_category,
    SPLIT_PART(exp.value::STRING, '/', 1) AS component_type
  FROM crs c
  JOIN clusters_dedup cl ON cl.cluster_id = c.system_id,
  LATERAL FLATTEN(input => c.pipelines) pipeline,
  LATERAL FLATTEN(input => pipeline.value:exporters) exp
  
  UNION ALL
  
  SELECT
    c.system_id,
    'connector' AS component_category,
    SPLIT_PART(conn.value::STRING, '/', 1) AS component_type
  FROM crs c
  JOIN clusters_dedup cl ON cl.cluster_id = c.system_id,
  LATERAL FLATTEN(input => c.pipelines) pipeline,
  LATERAL FLATTEN(input => pipeline.value:connectors) conn
  
  UNION ALL
  
  SELECT
    c.system_id,
    'extension' AS component_category,
    SPLIT_PART(ext.value::STRING, '/', 1) AS component_type
  FROM crs c
  JOIN clusters_dedup cl ON cl.cluster_id = c.system_id,
  LATERAL FLATTEN(input => c.extensions) ext
),
components AS (
  SELECT DISTINCT
    system_id,
    component_category,
    component_type
  FROM components_raw
)
SELECT
  component_category,
  component_type,
  COUNT(DISTINCT system_id) AS cluster_count
FROM components
GROUP BY 1, 2
ORDER BY component_category, cluster_count DESC;
```

### Query 2: Signal Adoption

Shows how many clusters collect logs, metrics, and/or traces.

```sql
-- Signal Adoption
-- Returns: signal_type, cluster_count
WITH clusters_dedup AS (
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
  SELECT
    a.system_id,
    a.content:spec:config:service:pipelines AS pipelines
  FROM LIGHTSPEEDARCHIVES_DB.INSIGHTS_MARTS.ARCHIVES a
  WHERE a.service_id = 'insights_daily'
    AND a.received_on = '2026-08-24'  -- UPDATE THIS DATE
    AND a.file_path LIKE 'config/opentelemetry/%'
    AND a.content:kind::STRING = 'OpenTelemetryCollector'
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY a.system_id, a.file_path
    ORDER BY a.received_at DESC NULLS LAST
  ) = 1
),
signals AS (
  SELECT DISTINCT
    c.system_id,
    SPLIT_PART(pipeline.key::STRING, '/', 1) AS signal_type
  FROM crs c
  JOIN clusters_dedup cl ON cl.cluster_id = c.system_id,
  LATERAL FLATTEN(input => c.pipelines) pipeline
)
SELECT
  signal_type,
  COUNT(DISTINCT system_id) AS cluster_count
FROM signals
GROUP BY 1
ORDER BY cluster_count DESC;
```

### Query 3: Multi-Signal Adoption

Shows which combinations of signals are used (e.g., logs only, logs+metrics, logs+metrics+traces).

```sql
-- Multi-Signal Adoption
-- Returns: signal_combination (e.g., 'logs+metrics+traces'), cluster_count
WITH clusters_dedup AS (
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
  SELECT
    a.system_id,
    a.content:spec:config:service:pipelines AS pipelines
  FROM LIGHTSPEEDARCHIVES_DB.INSIGHTS_MARTS.ARCHIVES a
  WHERE a.service_id = 'insights_daily'
    AND a.received_on = '2026-08-24'  -- UPDATE THIS DATE
    AND a.file_path LIKE 'config/opentelemetry/%'
    AND a.content:kind::STRING = 'OpenTelemetryCollector'
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY a.system_id, a.file_path
    ORDER BY a.received_at DESC NULLS LAST
  ) = 1
),
signals AS (
  SELECT DISTINCT
    c.system_id,
    SPLIT_PART(pipeline.key::STRING, '/', 1) AS signal_type
  FROM crs c
  JOIN clusters_dedup cl ON cl.cluster_id = c.system_id,
  LATERAL FLATTEN(input => c.pipelines) pipeline
),
cluster_signals AS (
  SELECT
    system_id,
    MAX(IFF(signal_type = 'logs', 1, 0)) AS has_logs,
    MAX(IFF(signal_type = 'metrics', 1, 0)) AS has_metrics,
    MAX(IFF(signal_type = 'traces', 1, 0)) AS has_traces
  FROM signals
  GROUP BY system_id
)
SELECT
  ARRAY_TO_STRING(
    ARRAY_COMPACT([
      IFF(has_logs = 1, 'logs', NULL),
      IFF(has_metrics = 1, 'metrics', NULL),
      IFF(has_traces = 1, 'traces', NULL)
    ]), 
    '+'
  ) AS signal_combination,
  COUNT(DISTINCT system_id) AS cluster_count
FROM cluster_signals
GROUP BY 1
ORDER BY cluster_count DESC;
```

### Query 4: Deployment Mode Distribution

Shows how collectors are deployed (deployment, daemonset, statefulset, sidecar).

```sql
-- Deployment Mode Distribution
-- Returns: deployment_mode, cluster_count
WITH clusters_dedup AS (
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
  SELECT
    a.system_id,
    a.content:spec:mode::STRING AS mode
  FROM LIGHTSPEEDARCHIVES_DB.INSIGHTS_MARTS.ARCHIVES a
  WHERE a.service_id = 'insights_daily'
    AND a.received_on = '2026-08-24'  -- UPDATE THIS DATE
    AND a.file_path LIKE 'config/opentelemetry/%'
    AND a.content:kind::STRING = 'OpenTelemetryCollector'
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY a.system_id, a.file_path
    ORDER BY a.received_at DESC NULLS LAST
  ) = 1
)
SELECT
  COALESCE(NULLIF(c.mode, ''), 'unset') AS deployment_mode,
  COUNT(DISTINCT c.system_id) AS cluster_count
FROM crs c
JOIN clusters_dedup cl ON cl.cluster_id = c.system_id
GROUP BY 1
ORDER BY cluster_count DESC;
```

### Query 5: Receiver → Exporter Pairs

Shows which receivers feed data to which exporters (data flow patterns).

```sql
-- Receiver → Exporter Pairs (Data Flow)
-- Returns: receiver, exporter, cluster_count
WITH clusters_dedup AS (
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
  SELECT
    a.system_id,
    a.content:spec:config:service:pipelines AS pipelines
  FROM LIGHTSPEEDARCHIVES_DB.INSIGHTS_MARTS.ARCHIVES a
  WHERE a.service_id = 'insights_daily'
    AND a.received_on = '2026-08-24'  -- UPDATE THIS DATE
    AND a.file_path LIKE 'config/opentelemetry/%'
    AND a.content:kind::STRING = 'OpenTelemetryCollector'
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY a.system_id, a.file_path
    ORDER BY a.received_at DESC NULLS LAST
  ) = 1
),
pairs AS (
  SELECT DISTINCT
    c.system_id,
    SPLIT_PART(rcv.value::STRING, '/', 1) AS receiver,
    SPLIT_PART(exp.value::STRING, '/', 1) AS exporter
  FROM crs c
  JOIN clusters_dedup cl ON cl.cluster_id = c.system_id,
  LATERAL FLATTEN(input => c.pipelines) pipeline,
  LATERAL FLATTEN(input => pipeline.value:receivers) rcv,
  LATERAL FLATTEN(input => pipeline.value:exporters) exp
)
SELECT
  receiver,
  exporter,
  COUNT(DISTINCT system_id) AS cluster_count
FROM pairs
GROUP BY 1, 2
ORDER BY cluster_count DESC
LIMIT 20;
```

### Query 6: CR Density Per Cluster

Shows how many collector CRs are deployed per cluster.

```sql
-- CR Density Per Cluster
-- Returns: cr_count_bucket, cluster_count
WITH clusters_dedup AS (
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
  SELECT
    a.system_id,
    a.file_path
  FROM LIGHTSPEEDARCHIVES_DB.INSIGHTS_MARTS.ARCHIVES a
  WHERE a.service_id = 'insights_daily'
    AND a.received_on = '2026-08-24'  -- UPDATE THIS DATE
    AND a.file_path LIKE 'config/opentelemetry/%'
    AND a.content:kind::STRING = 'OpenTelemetryCollector'
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY a.system_id, a.file_path
    ORDER BY a.received_at DESC NULLS LAST
  ) = 1
),
cr_counts AS (
  SELECT
    system_id,
    COUNT(*) AS cr_count,
    CASE
      WHEN COUNT(*) = 1 THEN '1 CR'
      WHEN COUNT(*) BETWEEN 2 AND 3 THEN '2-3 CRs'
      WHEN COUNT(*) BETWEEN 4 AND 5 THEN '4-5 CRs (might be truncated)'
      ELSE '6+ CRs (ERROR: should not see this)'
    END AS cr_count_bucket
  FROM crs c
  JOIN clusters_dedup cl ON cl.cluster_id = c.system_id
  GROUP BY system_id
)
SELECT
  cr_count_bucket,
  COUNT(*) AS cluster_count
FROM cr_counts
GROUP BY cr_count_bucket
ORDER BY MIN(cr_count);
```

---

## Common Query Patterns (Reference)

**NOTE**: The patterns below use placeholders `(...)` for illustration. Use the "Ready-to-Use Queries" section above for complete, runnable queries.

**IMPORTANT**: In the example queries below, `WITH clusters_dedup AS (...)` is a **placeholder**. Replace `(...)` with the full CTE definition from the "Standard Query Pattern" section above. The complete `clusters_dedup` CTE is:

```sql
WITH clusters_dedup AS (
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
```

### Pattern 1: Component Usage

Count clusters using each component type (receiver/processor/exporter/connector/extension).

```sql
WITH clusters_dedup AS (...),
    crs AS (
SELECT
    a.system_id,
    a.content:spec:config:service:pipelines AS pipelines,
    a.content:spec:config:service:extensions AS extensions
FROM LIGHTSPEEDARCHIVES_DB.INSIGHTS_MARTS.ARCHIVES a
WHERE a.service_id = 'insights_daily'
  AND a.received_on = '2026-08-24'
  AND a.file_path LIKE 'config/opentelemetry/%'
  AND a.content:kind::STRING = 'OpenTelemetryCollector'
    QUALIFY ROW_NUMBER() OVER (
    PARTITION BY a.system_id, a.file_path
    ORDER BY a.received_at DESC NULLS LAST
    ) = 1
    ),
    components_raw AS (
-- Extract receivers
SELECT
    c.system_id,
    'receiver' AS component_category,
    SPLIT_PART(rcv.value::STRING, '/', 1) AS component_type
FROM crs c
    JOIN clusters_dedup cl ON cl.cluster_id = c.system_id,
    LATERAL FLATTEN(input => c.pipelines) pipeline,
    LATERAL FLATTEN(input => pipeline.value:receivers) rcv

UNION ALL

-- Extract processors
SELECT
    c.system_id,
    'processor' AS component_category,
    SPLIT_PART(proc.value::STRING, '/', 1) AS component_type
FROM crs c
    JOIN clusters_dedup cl ON cl.cluster_id = c.system_id,
    LATERAL FLATTEN(input => c.pipelines) pipeline,
    LATERAL FLATTEN(input => pipeline.value:processors) proc

UNION ALL

-- Extract exporters
SELECT
    c.system_id,
    'exporter' AS component_category,
    SPLIT_PART(exp.value::STRING, '/', 1) AS component_type
FROM crs c
    JOIN clusters_dedup cl ON cl.cluster_id = c.system_id,
    LATERAL FLATTEN(input => c.pipelines) pipeline,
    LATERAL FLATTEN(input => pipeline.value:exporters) exp

UNION ALL

-- Extract connectors
SELECT
    c.system_id,
    'connector' AS component_category,
    SPLIT_PART(conn.value::STRING, '/', 1) AS component_type
FROM crs c
    JOIN clusters_dedup cl ON cl.cluster_id = c.system_id,
    LATERAL FLATTEN(input => c.pipelines) pipeline,
    LATERAL FLATTEN(input => pipeline.value:connectors) conn

UNION ALL

-- Extract extensions
SELECT
    c.system_id,
    'extension' AS component_category,
    SPLIT_PART(ext.value::STRING, '/', 1) AS component_type
FROM crs c
    JOIN clusters_dedup cl ON cl.cluster_id = c.system_id,
    LATERAL FLATTEN(input => c.extensions) ext
    ),
    components AS (
-- Deduplicate: one row per (cluster, category, type)
SELECT DISTINCT
    system_id,
    component_category,
    component_type
FROM components_raw
    )
SELECT
    component_category,
    component_type,
    COUNT(DISTINCT system_id) AS cluster_count
FROM components
GROUP BY 1, 2
ORDER BY component_category, cluster_count DESC;
```

### Pattern 2: Signal Adoption

Count clusters collecting each signal type (logs/metrics/traces).

```sql
WITH clusters_dedup AS (...),
crs AS (
  SELECT
    a.system_id,
    a.content:spec:config:service:pipelines AS pipelines
  FROM LIGHTSPEEDARCHIVES_DB.INSIGHTS_MARTS.ARCHIVES a
  WHERE a.service_id = 'insights_daily'
    AND a.received_on = '2026-08-24'
    AND a.file_path LIKE 'config/opentelemetry/%'
    AND a.content:kind::STRING = 'OpenTelemetryCollector'
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY a.system_id, a.file_path
    ORDER BY a.received_at DESC NULLS LAST
  ) = 1
),
signals AS (
  SELECT DISTINCT
    c.system_id,
    SPLIT_PART(pipeline.key::STRING, '/', 1) AS signal_type
  FROM crs c
  JOIN clusters_dedup cl ON cl.cluster_id = c.system_id,
  LATERAL FLATTEN(input => c.pipelines) pipeline
)
SELECT
  signal_type,
  COUNT(DISTINCT system_id) AS cluster_count
FROM signals
GROUP BY 1
ORDER BY cluster_count DESC;
```

### Pattern 3: Multi-Signal Adoption

Show which signal combinations are used (e.g., logs+metrics, logs+metrics+traces).

```sql
WITH clusters_dedup AS (...),
crs AS (...),
signals AS (
  SELECT DISTINCT
    c.system_id,
    SPLIT_PART(pipeline.key::STRING, '/', 1) AS signal_type
  FROM crs c
  JOIN clusters_dedup cl ON cl.cluster_id = c.system_id,
  LATERAL FLATTEN(input => c.pipelines) pipeline
),
cluster_signals AS (
  SELECT
    system_id,
    MAX(IFF(signal_type = 'logs', 1, 0)) AS has_logs,
    MAX(IFF(signal_type = 'metrics', 1, 0)) AS has_metrics,
    MAX(IFF(signal_type = 'traces', 1, 0)) AS has_traces
  FROM signals
  GROUP BY system_id
)
SELECT
  ARRAY_TO_STRING(
    ARRAY_COMPACT([
      IFF(has_logs = 1, 'logs', NULL),
      IFF(has_metrics = 1, 'metrics', NULL),
      IFF(has_traces = 1, 'traces', NULL)
    ]), 
    '+'
  ) AS signal_combination,
  COUNT(DISTINCT system_id) AS cluster_count
FROM cluster_signals
GROUP BY 1
ORDER BY cluster_count DESC;
```

### Pattern 4: Deployment Mode Distribution

```sql
WITH clusters_dedup AS (...),
crs AS (
  SELECT
    a.system_id,
    a.content:spec:mode::STRING AS mode
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
SELECT
  COALESCE(NULLIF(c.mode, ''), 'unset') AS deployment_mode,
  COUNT(DISTINCT c.system_id) AS cluster_count
FROM crs c
JOIN clusters_dedup cl ON cl.cluster_id = c.system_id
GROUP BY 1
ORDER BY cluster_count DESC;
```

### Pattern 5: Component Pairs (Receiver → Exporter)

Find which receivers feed which exporters (data flow patterns).

```sql
WITH clusters_dedup AS (...),
crs AS (
  SELECT
    a.system_id,
    a.content:spec:config:service:pipelines AS pipelines
  FROM LIGHTSPEEDARCHIVES_DB.INSIGHTS_MARTS.ARCHIVES a
  WHERE a.service_id = 'insights_daily'
    AND a.received_on = '2026-08-24'
    AND a.file_path LIKE 'config/opentelemetry/%'
    AND a.content:kind::STRING = 'OpenTelemetryCollector'
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY a.system_id, a.file_path
    ORDER BY a.received_at DESC NULLS LAST
  ) = 1
),
pairs AS (
  SELECT DISTINCT
    c.system_id,
    SPLIT_PART(rcv.value::STRING, '/', 1) AS receiver,
    SPLIT_PART(exp.value::STRING, '/', 1) AS exporter
  FROM crs c
  JOIN clusters_dedup cl ON cl.cluster_id = c.system_id,
  LATERAL FLATTEN(input => c.pipelines) pipeline,
  LATERAL FLATTEN(input => pipeline.value:receivers) rcv,
  LATERAL FLATTEN(input => pipeline.value:exporters) exp
)
SELECT
  receiver,
  exporter,
  COUNT(DISTINCT system_id) AS cluster_count
FROM pairs
GROUP BY 1, 2
ORDER BY cluster_count DESC
LIMIT 20;
```

### Pattern 6: CR Density Per Cluster

How many collector CRs per cluster?

```sql
WITH clusters_dedup AS (...),
crs AS (
  SELECT
    a.system_id,
    a.file_path
  FROM LIGHTSPEEDARCHIVES_DB.INSIGHTS_MARTS.ARCHIVES a
  WHERE a.service_id = 'insights_daily'
    AND a.received_on = '2026-08-24'
    AND a.file_path LIKE 'config/opentelemetry/%'
    AND a.content:kind::STRING = 'OpenTelemetryCollector'
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY a.system_id, a.file_path
    ORDER BY a.received_at DESC NULLS LAST
  ) = 1
),
cr_counts AS (
  SELECT
    system_id,
    COUNT(*) AS cr_count,
    CASE
      WHEN COUNT(*) = 1 THEN '1 CR'
      WHEN COUNT(*) BETWEEN 2 AND 3 THEN '2-3 CRs'
      WHEN COUNT(*) BETWEEN 4 AND 5 THEN '4-5 CRs (might be truncated)'
      ELSE '6+ CRs (ERROR: should not see this)'
    END AS cr_count_bucket
  FROM crs c
  JOIN clusters_dedup cl ON cl.cluster_id = c.system_id
  GROUP BY system_id
)
SELECT
  cr_count_bucket,
  COUNT(*) AS cluster_count
FROM cr_counts
GROUP BY cr_count_bucket
ORDER BY MIN(cr_count);
```

## Best Practices

### 1. Always Filter to External Clusters

Use the `clusters_dedup` CTE to exclude internal Red Hat clusters, CI clusters, and test environments.

### 2. Always Deduplicate CRs

Use `QUALIFY ROW_NUMBER() OVER (PARTITION BY system_id, file_path ORDER BY received_at DESC) = 1` to get the latest archive per CR.

### 3. Use SPLIT_PART for Component Names

Component and pipeline names may include instance names (e.g., `otlphttp/production`). Use `SPLIT_PART(name, '/', 1)` to extract the type.

### 4. Deduplicate Before Counting

A component may appear in multiple pipelines within the same CR. Use `SELECT DISTINCT system_id, component_type` before counting clusters.

### 5. Handle NULL/Missing Fields

Use `COALESCE()` and `NULLIF()` for optional fields:
```sql
COALESCE(NULLIF(a.content:spec:mode::STRING, ''), 'unset') AS mode
```

### 6. Document the Query

Add a header comment explaining:
- What the query measures
- The grain (one row per what?)
- Which clusters are included/excluded
- The date snapshot

### 7. Be Aware of the 5 CR Limit

Mention in query documentation if results might be affected by the 5 CR limit. Consider adding a separate check for clusters with exactly 5 CRs.

## Common Use Cases

1. **Component Adoption** — Which receivers/processors/exporters are most used?
2. **Signal Coverage** — How many clusters collect logs vs metrics vs traces?
3. **Multi-Signal Adoption** — What percentage use full observability (logs+metrics+traces)?
4. **Deployment Patterns** — DaemonSet vs Deployment usage?
5. **Data Flow** — Which backends (exporters) receive data from which sources (receivers)?
6. **Best Practice Adoption** — How many pipelines use batch processor?
7. **Vendor Distribution** — OTLP vs vendor-specific exporters?
8. **Pipeline Complexity** — Average number of components per pipeline?
9. **Collector Density** — How many collector instances per cluster?
10. **Version Distribution** — Which collector versions are deployed?

## Troubleshooting

### Query returns no results

Check:
1. Date is correct (`received_on = 'YYYY-MM-DD'`)
2. File path filter is correct (`LIKE 'config/opentelemetry/%'`)
3. Kind filter is exact (`content:kind::STRING = 'OpenTelemetryCollector'`)
4. The field path exists in the JSON (test with a sample query)

### Duplicate rows for same cluster

You're missing the deduplication:
```sql
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY a.system_id, a.file_path
  ORDER BY a.received_at DESC NULLS LAST
) = 1
```

### Component appears multiple times in results

Add deduplication before the final GROUP BY:
```sql
components AS (
  SELECT DISTINCT
    system_id,
    component_category,
    component_type
  FROM components_raw
)
```

### Extensions/connectors show zero usage

Check that you're extracting from the right path:
- Extensions: `service.extensions` (array at service level, not in pipelines)
- Connectors: `pipeline.value:connectors` (array within each pipeline)

## Maintenance

When updating this skill:

1. **Check insights-operator changes** — the collection logic may change:
   - Limit might increase/decrease
   - Fields collected might expand/shrink
   - New CR types might be added

2. **Update the source links** if they change (use main branch or specific release tag)

3. **Test queries** against current Snowflake schema — JSON paths may change

4. **Update sample data** if the CR API evolves (check opentelemetry-operator releases)

## References

- [Insights Operator GitHub](https://github.com/openshift/insights-operator)
- [OpenTelemetry Operator API](https://github.com/open-telemetry/opentelemetry-operator/blob/main/apis/v1beta1/opentelemetrycollector_types.go)
- [OpenTelemetry Collector Documentation](https://opentelemetry.io/docs/collector/)
