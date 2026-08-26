---
name: otel-cr-insights
description: >
  Write Snowflake queries to analyze OpenTelemetry Collector CR usage from
  insights archives. Use when the user asks to analyze OpenTelemetry Collector CR usage patterns from insights archives.
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

## Query Execution Options

### Option 1: Dataverse MCP (Cursor IDE Only)

**For Cursor IDE users**, you can query Snowflake directly using the Dataverse MCP server:

1. Add the MCP server in Cursor Settings → Tools & MCP → Add New MCP Server:
   ```json
   {
     "mcpServers": {
       "dataverse": {
         "url": "https://mcp.dataverse.redhat.com/mcp/"
       }
     }
   }
   ```

2. Toggle on the `dataverse` server and complete Red Hat SSO authentication in your browser

3. Use the MCP tools to query Snowflake directly without opening the Snowflake console

**Prerequisites:**
- Connected to Red Hat VPN
- Cursor IDE (the MCP server is not compatible with Claude Code CLI)

**Reference:** https://dataverse.pages.redhat.com/consumer/use/dataverse-agent/#direct-mcp-usage-in-cursor

### Option 2: Snowflake Console (All Users)

**For Claude Code CLI users** or those who prefer manual queries, use the Snowflake web console:

## Data Source

The OpenTelemetry Collector CR data is stored in Snowflake:

**Database**: `LIGHTSPEEDARCHIVES_DB.INSIGHTS_MARTS.ARCHIVES`

**Service ID**: `insights_daily`

**File path pattern**: `config/opentelemetry/%` (format: `config/opentelemetry/{namespace}/{name}`)

**CR Kind**: `OpenTelemetryCollector` (from `opentelemetry.io/v1beta1`)

**Access:**
- Via MCP (Cursor IDE): Use the Dataverse MCP server (see Option 1 above)
- Via Web UI: [Snowflake Console](https://app.snowflake.com/gdadclc/rhprod/#/homepage) (see Option 2 above)

## How to Execute Queries (Snowflake Console)

**This section applies to Option 2 (manual Snowflake console). If using the Dataverse MCP in Cursor, you can query directly via MCP tools.**

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

For complete, copy-paste-ready Snowflake queries, see **[queries.md](queries.md)**.

The queries file includes:
1. **Component Usage by Type** - Which receivers, processors, exporters, connectors, and extensions are most used
2. **Signal Adoption** - How many clusters collect logs, metrics, and/or traces
3. **Multi-Signal Adoption** - Signal combinations (logs+metrics+traces)
4. **Deployment Mode Distribution** - DaemonSet vs Deployment usage
5. **CR Density Per Cluster** - How many collector CRs per cluster

---

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

## References

- [Insights Operator GitHub](https://github.com/openshift/insights-operator)
- [OpenTelemetry Operator API](https://github.com/open-telemetry/opentelemetry-operator/blob/main/apis/v1beta1/opentelemetrycollector_types.go)
- [OpenTelemetry Collector Documentation](https://opentelemetry.io/docs/collector/)
