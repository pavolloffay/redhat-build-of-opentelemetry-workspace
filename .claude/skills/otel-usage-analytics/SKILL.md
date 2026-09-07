---
name: otel-usage-analytics
description: >
  Use when analyzing OpenTelemetry adoption, collector component usage,
  deployment patterns, or operator install metrics on OpenShift clusters.
  Produces Snowflake queries against Insights archives and OpenShift telemetry.
argument-hint: "[query-description or use-case]"
---

# OpenTelemetry Usage Analytics Skill

Write Snowflake queries to analyze OpenTelemetry Collector custom resource usage from Insights archives, and OpenTelemetry operator / collector install metrics from OpenShift telemetry.

## When to Use This Skill

Use this skill when:
- Writing queries to analyze OTel collector adoption, component usage, or configuration patterns
- Understanding what data is available from insights archives
- Need to know which CR fields are collected and which are stripped
- Checking data collection limits or potential gaps
- Building dashboards or reports on collector usage
- Measuring operator install (CSV / OLM subscription), product vs community package, or CSV versions
- Counting collector / Instrumentation / TargetAllocator CRs without the Insights 5-CR cap
- Checking whether OpenShift telemetry has otelcol_* or operator controller metrics (it does not)

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

## Data Sources

Choose the source from the question, then use the matching role and query file.

| Question | Source | Role | Queries |
|---|---|---|---|
| How are collectors configured (pipelines, components, mode)? | Insights archives | `LIGHTSPEEDARCHIVES_INSIGHTSMARTS_GROUP` | [queries-insights-crs.md](queries-insights-crs.md) |
| Is the operator installed? Which package/version? | OpenShift telemetry OLM | `OPENSHIFTTELEMETRY_MARTS_GROUP` | [queries-olm.md](queries-olm.md) |
| How many collector CRs exist (uncapped)? | OpenShift telemetry resource usage | `OPENSHIFTTELEMETRY_MARTS_GROUP` | [queries-olm.md](queries-olm.md) |

**Access:**
- Via MCP (Cursor IDE): Use the Dataverse MCP server (see Option 1 above)
- Via Web UI: [Snowflake Console](https://app.snowflake.com/gdadclc/rhprod/#/homepage) (see Option 2 above)

### Insights archives (collector CR config)

**Database**: `LIGHTSPEEDARCHIVES_DB.INSIGHTS_MARTS.ARCHIVES`

**Service ID**: `insights_daily`

**File path pattern**: `config/opentelemetry/%` (format: `config/opentelemetry/{namespace}/{name}`)

**CR Kind**: `OpenTelemetryCollector` (from `opentelemetry.io/v1beta1`)

### OpenShift telemetry (operator OLM + CR counts)

**Database**: `OPENSHIFTTELEMETRY_DB.MARTS`

**Role**: `OPENSHIFTTELEMETRY_MARTS_GROUP`

**Always filter** `received_on = 'YYYY-MM-DD'`. Tables are clustered on that column and are hundreds of millions of rows.

These are curated cluster-level Prometheus metrics from OpenShift telemetry, not collector self-telemetry. There is no dedicated OpenTelemetry table. OTel signal lives in labels (and the `resource` column) of OLM and resource-usage tables.

**Tables that contain OTel data:**

| Table | Prometheus metric | What it tells you |
|---|---|---|
| `CSV_SUCCEEDED` | `csv_succeeded` | OLM CSV in Succeeded phase — operator installed. Labels: `name` (e.g. `opentelemetry-operator.v0.152.0-3`), `version`, `exported_namespace` |
| `CSV_ABNORMAL` | `csv_abnormal` | CSV in Failed / Pending / Installing. Extra labels: `phase`, `reason` |
| `SUBSCRIPTION_SYNC_TOTAL` | `subscription_sync_total` | OLM subscription. Labels: `package` (`opentelemetry-product` = Red Hat, `opentelemetry-operator` = community), `name`, `channel`, `installed` |
| `CLUSTER_USAGE_RESOURCES_SUM` | `cluster:usage:resources:sum` | Instance count per CRD. `resource` is the CRD (`opentelemetrycollectors.opentelemetry.io`, `instrumentations.opentelemetry.io`, `targetallocators.opentelemetry.io`, `clusterobservabilities.opentelemetry.io`). `value` is a timestamp→count map — flatten it |
| `ALERTS` | Alertmanager alerts | Firing alerts. Filter labels `namespace` / `alertname` / `service` for `opentelemetry` or `otel` |

**Not in this mart:**
- No ClusterOperator named OpenTelemetry (`CLUSTER_OPERATOR_CONDITIONS` is empty for otel)
- No collector self-telemetry (`otelcol_*` receiver/processor/exporter/queue metrics)
- No operator controller-runtime metrics
- No pipeline or component config (that is Insights archives only)

**Query shape:** `LABELS` is VARIANT JSON (`labels:name::STRING`). `VALUE` is a VARIANT dict of epoch timestamps to numbers; use `LATERAL FLATTEN(input => value)` for instance counts. Presence of a `CSV_SUCCEEDED` row is enough to count an installed operator.

**Insights 5-CR cap does not apply** to `CLUSTER_USAGE_RESOURCES_SUM`. That metric is the fleet-wide CR count.

## How to Execute Queries (Snowflake Console)

**This section applies to Option 2 (manual Snowflake console). If using the Dataverse MCP in Cursor, you can query directly via MCP tools.**

1. Navigate to the [Snowflake Console](https://app.snowflake.com/gdadclc/rhprod/#/homepage)
2. In the left sidebar, click **Projects** → **Worksheets**
3. Click **+ Worksheet** to create a new SQL worksheet
4. **IMPORTANT**: In the worksheet context selector (top right), select the role for the data source:
   - Insights archives: `LIGHTSPEEDARCHIVES_INSIGHTSMARTS_GROUP` with `DEFAULT` warehouse
   - OpenShift telemetry OLM / CR counts: `OPENSHIFTTELEMETRY_MARTS_GROUP` with `DEFAULT` warehouse
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

**Only the first 5 OpenTelemetryCollector CRs per cluster are collected**, so component usage queries can undercount clusters with more than 5 CRs. For an uncapped CR count, use `CLUSTER_USAGE_RESOURCES_SUM` ([queries-olm.md](queries-olm.md) query 6). See [reference.md](reference.md#collection-limits) for the detection query and details.

## Fields Collected

Only `spec.config.service` (pipelines, extensions, telemetry), metadata, and a few top-level spec/status fields are collected. Component **configuration** (`spec.config.receivers/exporters/processors/extensions/connectors`) is stripped for privacy — you can see which components are referenced, not their config. See [reference.md](reference.md#fields-collected) for the full field list and a sample CR.

## Data Structure

Component names use `<type>[/<instance-name>]` and pipeline keys use `<signal>[/<name>]` — use `SPLIT_PART(name, '/', 1)` to extract the type/signal. See [reference.md](reference.md#data-structure) for examples and a sample archived CR.

## Standard Query Pattern

Every query should use a `clusters_dedup` CTE (external customers only, deduplicated) and a `crs` CTE (latest archive per CR). See [reference.md](reference.md#standard-query-pattern) for the full template and CTE-by-CTE explanation, including why Red Hat/IBM email domains are excluded.

## Ready-to-Use Queries

Insights CR config (pipelines, components, mode, 5-CR cap): **[queries-insights-crs.md](queries-insights-crs.md)**

1. **Component Usage by Type** - Which receivers, processors, exporters, connectors, and extensions are most used
2. **Signal Adoption** - How many clusters collect logs, metrics, and/or traces
3. **Multi-Signal Adoption** - Signal combinations (logs+metrics+traces)
4. **Deployment Mode Distribution** - DaemonSet vs Deployment usage
5. **CR Density Per Cluster** - How many collector CRs per cluster (capped at 5)

OpenShift telemetry OLM and uncapped CR counts: **[queries-olm.md](queries-olm.md)**

1. **Operator CSV adoption** - Clusters with a succeeded OpenTelemetry operator CSV
2. **Operator CSV versions** - Installed operator versions
3. **Product vs community** - `opentelemetry-product` vs `opentelemetry-operator` subscriptions
4. **Abnormal CSVs** - Failed / pending / installing operator installs
5. **CRD vs instances** - Clusters with the CRD vs clusters with ≥1 CR
6. **Collector CR density** - Uncapped instance-count buckets
7. **OTel-related alerts** - Firing alerts in otel namespaces or with otel alert names

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

### 6. Always Filter `received_on` on Telemetry Tables

`OPENSHIFTTELEMETRY_DB.MARTS` tables are clustered on `received_on` and are huge. Unfiltered scans are slow and expensive. Pick a recent date (`SELECT MAX(received_on) FROM ...`).

### 7. Flatten `VALUE` Only for Counts

CSV / subscription presence: count distinct `cluster_id` without flattening. CR instance counts: `LATERAL FLATTEN(input => value)` then `MAX(TRY_CAST(f.value::STRING AS FLOAT))` per cluster so intra-day timestamp variation does not double-count.

## References

- [reference.md](reference.md) - Collection limits, full field list, sample CR JSON, standard query template
- [Insights Operator GitHub](https://github.com/openshift/insights-operator)
- [OpenShift telemetry data collection](https://github.com/openshift/cluster-monitoring-operator/blob/main/Documentation/data-collection.md)
- [OpenTelemetry Operator API](https://github.com/open-telemetry/opentelemetry-operator/blob/main/apis/v1beta1/opentelemetrycollector_types.go)
- [OpenTelemetry Collector Documentation](https://opentelemetry.io/docs/collector/)
