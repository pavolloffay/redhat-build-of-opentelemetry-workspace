# Ready-to-Use Snowflake Queries

The following queries are **complete and runnable** - just copy, paste into Snowflake (or use via Dataverse MCP in Cursor), and update the date.

## Query 1: Component Usage by Type

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

## Query 2: Signal Adoption

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

## Query 3: Multi-Signal Adoption

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

## Query 4: Deployment Mode Distribution

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

## Query 5: CR Density Per Cluster

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
