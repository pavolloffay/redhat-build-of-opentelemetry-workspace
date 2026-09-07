# Ready-to-Use OpenShift Telemetry OLM Queries

Operator install (CSV / subscription) and uncapped collector CR counts from `OPENSHIFTTELEMETRY_DB.MARTS`.

Role: `OPENSHIFTTELEMETRY_MARTS_GROUP`. For collector pipeline/component config, see **[queries-insights-crs.md](queries-insights-crs.md)** (Insights archives).

Queries are **complete and runnable** — copy, paste, and update the date. Use `clusters_dedup` so results match the Insights queries (external, non-CI, not redhat.com/ibm.com, not Eval/Self-support).

## Query 0: Latest received_on

```sql
-- Latest telemetry date
-- Returns: max_date
SELECT MAX(received_on) AS max_date
FROM OPENSHIFTTELEMETRY_DB.MARTS.CSV_SUCCEEDED;
```

## Query 1: Operator CSV Adoption

Clusters with a succeeded OpenTelemetry operator CSV.

```sql
-- Operator CSV Adoption
-- Source: OPENSHIFTTELEMETRY_DB.MARTS.CSV_SUCCEEDED
-- Date: received_on = 'YYYY-MM-DD'
-- Returns: cluster_count
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
)
SELECT COUNT(DISTINCT c.cluster_id) AS cluster_count
FROM OPENSHIFTTELEMETRY_DB.MARTS.CSV_SUCCEEDED c
JOIN clusters_dedup cl ON cl.cluster_id = c.cluster_id
WHERE c.received_on = '2026-08-30'  -- UPDATE THIS DATE
  AND LOWER(c.labels:name::STRING) LIKE 'opentelemetry-operator%';
```

## Query 2: Operator CSV Versions

Installed operator versions from succeeded CSVs. Hyphenated builds (e.g. `0.152.0-3`) are Red Hat product; unhyphenated (e.g. `0.158.0`) are typically community.

```sql
-- Operator CSV Versions
-- Returns: version, cluster_count
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
)
SELECT
  c.labels:version::STRING AS version,
  COUNT(DISTINCT c.cluster_id) AS cluster_count
FROM OPENSHIFTTELEMETRY_DB.MARTS.CSV_SUCCEEDED c
JOIN clusters_dedup cl ON cl.cluster_id = c.cluster_id
WHERE c.received_on = '2026-08-30'  -- UPDATE THIS DATE
  AND LOWER(c.labels:name::STRING) LIKE 'opentelemetry-operator%'
GROUP BY 1
ORDER BY cluster_count DESC;
```

## Query 3: Product vs Community Subscriptions

OLM package split. `opentelemetry-product` is Red Hat build of OpenTelemetry; `opentelemetry-operator` is the community operator.

```sql
-- Product vs Community Subscriptions
-- Returns: package, cluster_count
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
)
SELECT
  s.labels:package::STRING AS package,
  COUNT(DISTINCT s.cluster_id) AS cluster_count
FROM OPENSHIFTTELEMETRY_DB.MARTS.SUBSCRIPTION_SYNC_TOTAL s
JOIN clusters_dedup cl ON cl.cluster_id = s.cluster_id
WHERE s.received_on = '2026-08-30'  -- UPDATE THIS DATE
  AND s.labels:package::STRING IN (
    'opentelemetry-product',
    'opentelemetry-operator'
  )
GROUP BY 1
ORDER BY cluster_count DESC;
```

## Query 4: Abnormal Operator CSVs

CSVs not in Succeeded (Failed, Pending, Installing, …).

```sql
-- Abnormal Operator CSVs
-- Returns: csv_name, phase, reason, cluster_count
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
)
SELECT
  a.labels:name::STRING AS csv_name,
  a.labels:phase::STRING AS phase,
  a.labels:reason::STRING AS reason,
  COUNT(DISTINCT a.cluster_id) AS cluster_count
FROM OPENSHIFTTELEMETRY_DB.MARTS.CSV_ABNORMAL a
JOIN clusters_dedup cl ON cl.cluster_id = a.cluster_id
WHERE a.received_on = '2026-08-30'  -- UPDATE THIS DATE
  AND LOWER(a.labels:name::STRING) LIKE 'opentelemetry-operator%'
GROUP BY 1, 2, 3
ORDER BY cluster_count DESC;
```

## Query 5: CRD vs Instances

Clusters that have the CRD installed vs clusters that have at least one instance. Flatten `value` (timestamp→count map) and take `MAX` per cluster so intra-day readings do not double-count.

```sql
-- CRD vs Instances
-- Returns: resource, clusters_with_crd, clusters_with_instances, max_instances
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
)
SELECT
  r.resource,
  COUNT(DISTINCT r.cluster_id) AS clusters_with_crd,
  COUNT(DISTINCT CASE
    WHEN TRY_CAST(f.value::STRING AS FLOAT) > 0 THEN r.cluster_id
  END) AS clusters_with_instances,
  MAX(TRY_CAST(f.value::STRING AS FLOAT)) AS max_instances
FROM OPENSHIFTTELEMETRY_DB.MARTS.CLUSTER_USAGE_RESOURCES_SUM r
JOIN clusters_dedup cl ON cl.cluster_id = r.cluster_id,
LATERAL FLATTEN(input => r.value) f
WHERE r.received_on = '2026-08-30'  -- UPDATE THIS DATE
  AND r.resource IN (
    'opentelemetrycollectors.opentelemetry.io',
    'instrumentations.opentelemetry.io',
    'targetallocators.opentelemetry.io',
    'clusterobservabilities.opentelemetry.io'
  )
GROUP BY r.resource
ORDER BY clusters_with_crd DESC;
```

## Query 6: Collector CR Density (Uncapped)

Instance-count buckets for `OpenTelemetryCollector` CRs. Unlike Insights archives, this metric is **not** capped at 5 CRs per cluster. `0 (CRD only)` means the CRD is installed but no collector CRs exist.

```sql
-- Collector CR Density (Uncapped)
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
per_cluster AS (
  SELECT
    r.cluster_id,
    MAX(TRY_CAST(f.value::STRING AS FLOAT)) AS max_crs
  FROM OPENSHIFTTELEMETRY_DB.MARTS.CLUSTER_USAGE_RESOURCES_SUM r
  JOIN clusters_dedup cl ON cl.cluster_id = r.cluster_id,
  LATERAL FLATTEN(input => r.value) f
  WHERE r.received_on = '2026-08-30'  -- UPDATE THIS DATE
    AND r.resource = 'opentelemetrycollectors.opentelemetry.io'
  GROUP BY r.cluster_id
)
SELECT
  CASE
    WHEN max_crs = 0 THEN '0 (CRD only)'
    WHEN max_crs = 1 THEN '1 CR'
    WHEN max_crs BETWEEN 2 AND 3 THEN '2-3 CRs'
    WHEN max_crs BETWEEN 4 AND 5 THEN '4-5 CRs'
    WHEN max_crs BETWEEN 6 AND 10 THEN '6-10 CRs'
    ELSE '11+ CRs'
  END AS cr_count_bucket,
  COUNT(*) AS cluster_count
FROM per_cluster
GROUP BY 1
ORDER BY MIN(max_crs);
```

## Query 7: OTel-Related Alerts

Firing alerts whose namespace, alert name, or service looks like OpenTelemetry. Avoid a bare `%otel%` namespace match — it hits names like `hotel`.

```sql
-- OTel-Related Alerts
-- Returns: alertname, namespace, service, cluster_count
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
)
SELECT
  a.labels:alertname::STRING AS alertname,
  a.labels:namespace::STRING AS namespace,
  a.labels:service::STRING AS service,
  COUNT(DISTINCT a.cluster_id) AS cluster_count
FROM OPENSHIFTTELEMETRY_DB.MARTS.ALERTS a
JOIN clusters_dedup cl ON cl.cluster_id = a.cluster_id
WHERE a.received_on = '2026-08-30'  -- UPDATE THIS DATE
  AND (
    LOWER(COALESCE(a.labels:namespace::STRING, '')) LIKE '%opentelemetry%'
    OR LOWER(COALESCE(a.labels:namespace::STRING, '')) LIKE '%otel-%'
    OR LOWER(COALESCE(a.labels:namespace::STRING, '')) LIKE '%-otel%'
    OR LOWER(COALESCE(a.labels:alertname::STRING, '')) LIKE '%otel%'
    OR LOWER(COALESCE(a.labels:service::STRING, '')) LIKE '%opentelemetry%'
  )
GROUP BY 1, 2, 3
ORDER BY cluster_count DESC;
```
