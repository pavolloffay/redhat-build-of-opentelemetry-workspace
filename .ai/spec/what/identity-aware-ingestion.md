# Identity-Aware Authentication and Authorization for Telemetry Ingestion

[PLANNED: OBSDA-1512] Research spec — documents how the OTEL collector could support identity-aware authentication and authorization at the ingestion layer, with multi-tenant routing as the primary use case.

Related tickets: [OBSDA-1512](https://redhat.atlassian.net/browse/OBSDA-1512), [RHAIRFE-3630](https://redhat.atlassian.net/browse/RHAIRFE-3630), [RHAISTRAT-2925](https://redhat.atlassian.net/browse/RHAISTRAT-2925).

## Problem Summary

Organizations that deploy the collector as a shared telemetry gateway need to:

1. **Authenticate senders** — verify _who_ is sending telemetry (not just that they can reach the endpoint).
2. **Authorize per destination** — enforce _what_ a verified sender may write to (which tenant, project, or backend).
3. **Bind identity to data** — replace self-declared identity (headers, attributes) with verified identity so attribution is trustworthy.
4. **Forward identity downstream** — carry verified identity to backends so cross-system correlation is possible.


## Current Collector Capabilities

### Authentication Extensions

The collector has a server-side auth extension interface (`extensionauth.Server`). An extension's `Authenticate(ctx, sources)` validates credentials from request headers/metadata and returns a context enriched with `client.Info` containing `client.AuthData`. Downstream pipeline components access this via `client.FromContext(ctx)`.

| Extension | Support Level | Capabilities | Limitations |
|---|---|---|---|
| **OIDC Auth** (`oidcauth`) | **TP** | Validates JWT tokens via OIDC discovery or JWK file. Multi-provider. Exposes `subject`, `membership` (groups), and arbitrary JWT claims (e.g. `claims.tenant_id`) as auth attributes. | Requires JWT tokens — not all senders have them. No built-in K8s SA token support. |
| **Bearer Token Auth** (`bearertokenauth`) | **GA** | Static token match (single token, list, or file). | No identity extraction — validates the token matches but sets no `AuthData` attributes. Cannot distinguish senders. |
| **OAuth2 Client** (`oauth2clientauth`) | **TP** | Client-side only (for exporters authenticating to backends). | Not a server authenticator — irrelevant for receiver auth. |

**Bottom line:** OIDC auth is the only extension that both authenticates _and_ extracts identity attributes. Bearer token auth is identity-blind.

### Identity Propagation Through the Pipeline

Authenticated identity (`client.Info.Auth`) is per-request context — it is available to pipeline components but lost at the batch processor boundary. Two mechanisms use it for different purposes:

**1. Routing connector** — reads auth attributes directly via the OTTL otelcol context to decide which pipeline data goes to. This is per-request and does not persist identity into the telemetry data:

```yaml
connectors:
  routing:
    table:
      - condition: otelcol.client.auth.attributes["namespace"] == "team-a"
        pipelines: [traces/team-a]
      - condition: otelcol.client.auth.attributes["namespace"] == "team-b"
        pipelines: [traces/team-b]
    default_pipelines: [traces/default]
```

Documented in [`pkg/ottl/contexts/ottlotelcol/README.md`](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/pkg/ottl/contexts/ottlotelcol/README.md): `otelcol.client.auth.attributes["key"]` reads a specific auth attribute; the full map is also available.

**2. Resource/attributes processors** — stamps identity into resource attributes via `from_context` with the `auth.` prefix, so it persists in the telemetry data, survives batching, and is exported with the spans/metrics/logs. Without this, the backend has no record of who sent the data:

```yaml
processors:
  resource:
    attributes:
      - key: sender.namespace
        from_context: "auth.namespace"
        action: upsert
      - key: sender.service_account
        from_context: "auth.service_account"
        action: upsert
```

Confirmed in [`internal/coreinternal/attraction/attraction.go`](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/internal/coreinternal/attraction/attraction.go) (line 371: `authPrefix = "auth."`).

### Identity Forwarding to Backends

The **headers setter extension** (`headerssetter`) can set outbound headers on exporter requests. It supports two source types:

1. **`from_context`** — reads from `client.Info.Metadata` (request headers/gRPC metadata). Requires `include_metadata: true` on the receiver. Resolves any key present in the incoming request metadata (case-insensitive). Implementation: [`headerssetterextension/internal/source/context.go`](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/extension/headerssetterextension/internal/source/context.go).

2. **`from_attribute`** — reads from `client.Info.Auth.GetAttribute(key)` (auth extension attributes like `subject`, `membership`, `claims.*`). Implementation: [`headerssetterextension/internal/source/attribute.go`](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/extension/headerssetterextension/internal/source/attribute.go).

**Important:** The headers setter's `from_context` and `from_attribute` are different from the resource processor's `from_context`. The resource processor's `from_context` supports the `auth.` prefix to read auth attributes (e.g., `from_context: "auth.claims.tenant_id"`). The headers setter does NOT — its `from_context` reads only from request metadata, and `from_attribute` reads from auth attributes.

**Example — forwarding a tenant ID claim as `X-Scope-OrgID` to a multi-tenant backend:**

### Identity Forwarding and Token Passthrough Example

This example combines both patterns: forwarding a **derived tenant header** (`X-Scope-OrgID`) and passing through the **raw bearer token** so the backend can perform its own authorization. This matches the RHOAI use case — the collector authenticates and routes by namespace, while MLflow receives the original token for its own SubjectAccessReview.

This example assumes the `k8s_token_auth` extension from Approach 1 (Option B) exists — it does not exist yet. When `include_metadata: true` is set on the receiver, ALL incoming headers (including `Authorization`) are stored in `client.Info.Metadata`. The headers setter extension forwards them using `from_context` (which reads from metadata). This works for both gRPC ([`configgrpc.go`](https://github.com/open-telemetry/opentelemetry-collector/blob/main/config/configgrpc/configgrpc.go) copies all gRPC metadata) and HTTP ([`confighttp/clientinfohandler.go`](https://github.com/open-telemetry/opentelemetry-collector/blob/main/config/confighttp/clientinfohandler.go) clones all HTTP headers) receivers.

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        include_metadata: true
        auth:
          authenticator: k8s_token_auth
      http:
        include_metadata: true
        auth:
          authenticator: k8s_token_auth

extensions:
  k8s_token_auth:
    audiences: [shared-audience]  # optional; must be accepted by BOTH collector and backend for passthrough
  headers_setter:
    headers:
      - action: upsert
        key: X-Scope-OrgID              # derived tenant header for multi-tenant backends (Tempo, Mimir, Loki)
        from_attribute: namespace        # reads from client.Info.Auth (only works without batching)
      - action: upsert
        key: Authorization              # raw bearer token passthrough for backend authorization (e.g., MLflow SSAR)
        from_context: authorization      # reads from client.Info.Metadata

processors:
  resource/stamp-identity:
    attributes:
      - key: sender.namespace
        from_context: "auth.namespace"
        action: upsert
      - key: sender.service_account
        from_context: "auth.service_account"
        action: upsert

exporters:
  otlphttp/mlflow:
    endpoint: http://mlflow:5000/v1/traces   # MLflow OTLP/HTTP endpoint (since v3.6.0, OTLP/gRPC not supported)
    auth:
      authenticator: headers_setter
    sending_queue:                          # replaces the deprecated batchprocessor (QueueBatchConfig)
      batch:                                # batching config within the sending queue
        partition:                          # partitioning controls how requests are grouped into batches
          metadata_keys:                    # requests with different values for these keys get separate batches
            - authorization                 # each unique bearer token gets its own batch, preserving the token across batching

service:
  extensions: [k8s_token_auth, headers_setter]
  pipelines:
    traces:
      receivers: [otlp]
      processors: [resource/stamp-identity]
      exporters: [otlphttp/mlflow]
```

**Two forwarding mechanisms in one config:**
- **`from_attribute: namespace`** — reads from `client.Info.Auth` (set by the auth extension). Sets `X-Scope-OrgID` for multi-tenant backends. Lost during batching — only works if the exporter does not batch, or if batching is disabled.
- **`from_context: authorization`** — reads from `client.Info.Metadata` (raw request headers). Passes through the original bearer token. Survives batching when `metadata_keys` includes `authorization`.

**Batching caveat:** `metadata_keys` preserves specified metadata keys across batching but creates per-token batching buckets — each unique token gets its own batch. This preserves correctness but reduces batching efficiency. The `from_attribute: namespace` header will be lost after batching (see Context Lifecycle above); for pipelines with batching, use `from_context` with a metadata key instead. The config above uses exporter-level batching (`sending_queue::batch`) which replaces the deprecated `batchprocessor` (see migration RFC: [`docs/rfcs/batching-migration.md`](https://github.com/open-telemetry/opentelemetry-collector/blob/main/docs/rfcs/batching-migration.md)).

**Audience constraint for passthrough:** When a backend validates the forwarded token via its own TokenReview, the token's audience must match what the backend expects. If the sender projected the token with a collector-specific audience (e.g., `otel-gateway`), the backend will reject it. The audience must be shared between collector and backend, or the backend must accept the collector's audience. See the audience discussion in Approach 1 below.

The headers setter extension is in the Red Hat distro manifest (`headerssetterextension v0.158.0`). Not supported — present in source but not documented (see `what/collector.md`).

### Routing Connector

The routing connector (TP in the Red Hat distro) routes telemetry to different pipelines based on OTTL conditions. It supports resource, span, log, metric, datapoint, and otelcol contexts. Key capabilities:

- Routes on `otelcol.client.auth.attributes["key"]` — identity-based routing without stamping attributes first.
- Routes on `otelcol.client.metadata["key"]` or `otelcol.grpc.metadata["key"]` — header-based routing.
- Routes on `resource.attributes["key"]` — attribute-based routing (after identity has been stamped).
- Static routing table — adding/removing tenants requires config changes and collector reload.

### Context Lifecycle and Batching

`client.Info` (including auth data) is per-request context. **Both the legacy batch processor and its replacement (exporter-level batching via `sending_queue::batch`, RFC: [`docs/rfcs/batching-migration.md`](https://github.com/open-telemetry/opentelemetry-collector/blob/main/docs/rfcs/batching-migration.md)) discard `client.Info.Auth` during batching.** The new batcher's merge function ([`metadata_partitioner.go`](https://github.com/open-telemetry/opentelemetry-collector/blob/main/exporter/exporterhelper/internal/queuebatch/metadata_partitioner.go)) creates a new context with only `client.Info{Metadata: ...}` — Auth and Addr are explicitly not carried over.

| Context field | What it holds | Preserved after batching? |
|---|---|---|
| `client.Info.Metadata` | Request headers (HTTP) or metadata (gRPC), populated when `include_metadata: true`. E.g., `authorization`, `content-type`, custom headers. | Only entries whose key name is in `metadata_keys` are preserved (both old and new batcher); all other metadata entries are dropped |
| `client.Info.Auth` | Structured identity from an auth extension: claims, subject, groups, raw token. Set by extensions like OIDC (`subject`, `membership`, `claims.*`, `raw`) or the proposed K8s SA auth (`namespace`, `service_account`). | **Never** — lost in all batching scenarios, including persistent queue (not serialized) |
| `client.Info.Addr` | The client's network address (`net.Addr`). | Lost in memory batching; preserved in persistent queue serialization |

**Implications for pipeline ordering:**
- The **routing connector** must run before batching — it reads `client.Info.Auth` directly.
- The **resource processor** must stamp auth attributes into resource attributes before batching — stamped attributes survive in the telemetry data.
- The headers setter's **`from_attribute`** reads from `client.Info.Auth` — it won't work if the exporter uses batching. Use `from_context` with `metadata_keys` instead (see Token Passthrough below).
- The headers setter's **`from_context`** reads from `client.Info.Metadata` — works after batching if the key is listed in `metadata_keys`.

## Gap Analysis

### What Works Today

| Need | Mechanism | Status |
|---|---|---|
| Authenticate JWT-bearing senders | OIDC auth extension | **Works** (TP) |
| Extract identity claims to pipeline context | OIDC auth → `client.Info.Auth` | **Works** |
| Stamp verified identity into resource attributes | Resource processor `from_context: "auth.claims.*"` | **Works** |
| Route to per-tenant pipelines based on identity | Routing connector `otelcol.client.auth.attributes["key"]` | **Works** (TP) |
| Forward identity to multi-tenant backends | Headers setter extension `from_context` | **Works** — extension in distro (undocumented) |

### What Is Missing

| Need | Gap | Severity |
|---|---|---|
| **Kubernetes SA token authentication** | The OIDC extension **cannot** validate K8s SA tokens on OpenShift out of the box (see below). A new TokenReview auth extension is needed. | **High** — K8s workloads are the primary sender type on OpenShift |
| **Authorization enforcement** | Auth extensions authenticate (who?) but nothing authorizes (may this sender write here?). The routing connector provides implicit authorization (route or drop) via its static routing table — this is sufficient for the use case (see Authorization section). | **Medium** — implicit authorization via routing is acceptable |
| **Rejection signaling** | When the routing connector has no matching route, data goes to `default_pipelines` or is dropped silently. There is no mechanism to send an error response to the sender explaining why data was rejected. | **Medium** — operators need visibility; senders need feedback |

## Approaches

The problem has two layers: **authentication** (verify who is sending) and **authorization** (enforce what they may send to). This section covers both.

### Authentication: Validating K8s Service Account Tokens

Kubernetes service account tokens are JWTs signed by the cluster's service account issuer. Three options for validating them at the collector:

#### Option A: OIDC Auth Extension — Does Not Work on OpenShift

The OIDC auth extension fetches `{issuer_url}/.well-known/openid-configuration` at startup using a plain HTTP client with no bearer token. On OpenShift, the API server **requires authentication** for this endpoint — the extension gets HTTP 401.

**Additional complications:**
- **Issuer URL varies by cluster type.** Standard OpenShift uses `iss: https://kubernetes.default.svc`. AWS STS uses an S3 bucket URL. Azure WIF ARO uses `https://{region}.oic.aro.azure.net/{tenant}/{uuid}`.
- **CA cert pool is exclusive.** The OIDC extension creates a new empty cert pool with only the issuer CA — system roots are not included.
- **Audience must be projected.** Default SA tokens use `aud: ["https://kubernetes.default.svc"]`. Senders must project tokens with a custom audience.

**Workaround — `public_keys_file`:** Load a JWKS file directly, bypassing discovery. Operationally viable but adds a distribution mechanism (e.g., CronJob to refresh the JWKS).

**Verdict:** Does not work out of the box for K8s SA tokens on OpenShift. The workaround is fragile.

#### Option B: K8s SA Auth Extension (TokenReview)

A dedicated extension that validates the bearer token via the K8s TokenReview API, extracts identity (namespace, service account name, groups), and exposes them as auth attributes. This does not exist upstream yet — an external implementation exists: [`github.com/Jamstah/k8ssaauthextension`](https://github.com/Jamstah/k8ssaauthextension) by James Hewitt (IBM).

```yaml
extensions:
  k8s_token_auth:
    audiences: [opentelemetry-collector]  # optional; defaults to cluster API server audience
```

The extension can optionally include a **SubjectAccessReview** step for authorization at the auth layer — see Authorization section below.

**Current status:** Development stability, 6 commits, not proposed for `opentelemetry-collector-contrib`. The related core collector issue [#6987](https://github.com/open-telemetry/opentelemetry-collector/issues/6987) (closed) was about client-side K8s SA auth, not server-side.

**Gaps:**
- Auth attributes exposed via `client.Info.Auth` are not documented.
- No caching of TokenReview results.

**Path forward:** Evaluate and improve the Jamstah extension (caching, auth attribute exposure), propose for `opentelemetry-collector-contrib`. The `k8sattributesprocessor` provides precedent for K8s-specific components in contrib.

**Upstream discussion:** Issue [#48895](https://github.com/open-telemetry/opentelemetry-collector-contrib/issues/48895) ("Support Multitenant Kubernetes Self-Service") — the closest upstream conversation to this use case.

#### Option C: Auth Proxy Sidecar (kube-rbac-proxy)

Deploy `kube-rbac-proxy` as a sidecar in front of the collector. The proxy validates SA tokens via TokenReview, optionally checks SubjectAccessReview, and forwards authenticated identity as HTTP headers.

kube-rbac-proxy must be started with `--auth-header-fields-enabled=true`. It then sets `x-remote-user` (e.g. `system:serviceaccount:ns:name`) and `x-remote-groups` on proxied requests. The collector reads these via `include_metadata: true`:

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: localhost:4317  # only reachable from the sidecar
        include_metadata: true
      http:
        endpoint: localhost:4318
        include_metadata: true
```

The routing connector routes on `otelcol.client.metadata["x-remote-user"]`. gRPC is supported via `--upstream-force-h2c`.

**Security requirement:** The identity headers are untrusted metadata from the collector's perspective. The receiver must bind to `localhost` and a NetworkPolicy must prevent pods from bypassing the proxy. Without this, any sender can set `x-remote-user` and impersonate any identity.

**Pros:** Well-established OpenShift pattern. No collector code changes. Works for both HTTP and gRPC. Interim solution while the K8s SA auth extension matures.
**Cons:** Identity is metadata headers, not `client.Info.Auth`. Adds a sidecar and network hop. The operator would need to inject the sidecar via `additionalContainers`.

#### Authentication Recommendation

**Option B** (TokenReview extension) is the target — simplest, cleanest integration. **Option C** (kube-rbac-proxy) is the interim solution. **Option A** (OIDC) does not work on OpenShift.

### Authorization: Enforcing What Senders May Send To

Authentication tells us _who_ is sending. Authorization enforces _where_ they can send. Two models:

#### Option A: Implicit Authorization via Routing Connector

The routing connector's OTTL conditions act as an implicit authorization layer: authenticated senders are routed to their allowed pipelines, and unmatched senders go to a reject pipeline.

```yaml
connectors:
  routing:
    table:
      - condition: otelcol.client.auth.attributes["namespace"] == "team-a"
        pipelines: [traces/team-a]
      - condition: otelcol.client.auth.attributes["namespace"] == "team-b"
        pipelines: [traces/team-b]
    default_pipelines: [traces/reject]
```

Each routing rule is an allow rule (identity → pipeline). Per-tenant pipeline isolation prevents cross-tenant writes. Static routing table — adding a tenant requires a config change and collector reload, acceptable for the expected tenant counts.

**Limitation:** The sender receives a success response even when data is dropped (silent drop, no error).

#### Option B: Explicit Authorization via K8s RBAC (SubjectAccessReview)

The K8s SA auth extension (Authentication Option B) can include a SubjectAccessReview step that rejects unauthorized senders _before_ data enters the pipeline:

```yaml
extensions:
  k8s_sa_auth:
    audiences: [opentelemetry-collector]
    resource_attributes:
      group: telemetry.opentelemetry.io
      resource: telemetry
      verb: export
```

Authorization is managed via standard K8s RBAC — an admin creates a Role granting `export` on `telemetry` resources and binds it to the sender's SA. Senders without the binding get an error.

**Pros over Option A:** True rejection (sender gets an error, not silent drop). Managed via K8s RBAC — adding a sender is a RoleBinding, not a collector config change. Auditable via K8s audit logs.
**Cons:** Coarse-grained — SAR checks a single resource/verb, not per-destination policies. Routing still needs to map identity → pipeline. Adds a synchronous API call per request (cacheable).

**Both can coexist:** SAR gates entry (reject unauthorized senders with an error), routing directs traffic to the correct pipeline. SAR answers "may this sender use the collector at all?" while routing answers "which backend does this sender's data go to?"

#### Authorization Recommendation

**Option B** (SAR) is preferable if the K8s SA auth extension is adopted — it provides true rejection and uses standard K8s RBAC. **Option A** (routing connector) works today without new components and is sufficient on its own for expected tenant counts.

**Note on Authorino/Kuadrant:** RHAISTRAT-2925 mentions Authorino/Kuadrant, but these sit in front of the **MaaS gateway** (not the collector). Authorino authenticates callers at the MaaS API layer and forwards identity as HTTP headers. The collector receives traces from the MaaS payload processor after authentication has already happened.


## End-to-End Example: Multi-Tenant Gateway

Combining components for a two-tenant setup where each tenant uses a K8s service account with a projected token. This example assumes the TokenReview auth extension (Approach 1 Option B) exists.

```yaml
extensions:
  k8s_token_auth:
    audiences: [otel-gateway]
  headers_setter/team-a:
    headers:
      - action: upsert
        key: X-Scope-OrgID
        value: team-a
  headers_setter/team-b:
    headers:
      - action: upsert
        key: X-Scope-OrgID
        value: team-b

receivers:
  otlp:
    protocols:
      grpc:
        auth:
          authenticator: k8s_token_auth
      http:
        auth:
          authenticator: k8s_token_auth

processors:
  resource/stamp-identity:
    attributes:
      - key: sender.namespace
        from_context: "auth.namespace"
        action: upsert
      - key: sender.service_account
        from_context: "auth.service_account"
        action: upsert
  batch/team-a:
    timeout: 5s
  batch/team-b:
    timeout: 5s

connectors:
  routing:
    table:
      - condition: otelcol.client.auth.attributes["namespace"] == "team-a"
        pipelines: [traces/team-a]
      - condition: otelcol.client.auth.attributes["namespace"] == "team-b"
        pipelines: [traces/team-b]
    default_pipelines: [traces/reject]

exporters:
  otlp/team-a-tempo:
    endpoint: tempo-team-a:4317
    auth:
      authenticator: headers_setter/team-a
  otlp/team-b-tempo:
    endpoint: tempo-team-b:4317
    auth:
      authenticator: headers_setter/team-b
  debug/reject:
    verbosity: basic

service:
  extensions: [k8s_token_auth, headers_setter/team-a, headers_setter/team-b]
  pipelines:
    traces/ingress:
      receivers: [otlp]
      processors: [resource/stamp-identity]
      exporters: [routing]
    traces/team-a:
      receivers: [routing]
      processors: [batch/team-a]
      exporters: [otlp/team-a-tempo]
    traces/team-b:
      receivers: [routing]
      processors: [batch/team-b]
      exporters: [otlp/team-b-tempo]
    traces/reject:
      receivers: [routing]
      processors: []
      exporters: [debug/reject]
```

**Key points:**
- The TokenReview extension validates SA tokens and exposes structured identity (`namespace`, `service_account`, `pod`) as auth attributes.
- Identity stamping (`resource/stamp-identity`) happens before the routing connector, so identity survives batching in per-tenant pipelines.
- Routing uses the `namespace` auth attribute — each namespace maps to a tenant pipeline.
- Each tenant pipeline has its own batch processor and exporter with tenant-specific headers.
- Unrecognized senders go to `traces/reject` — data is logged and dropped.
- Senders can project their SA token with an explicit audience via a `serviceAccountToken` volume (optional — if omitted, the token uses the cluster's default audience, typically `https://kubernetes.default.svc`). When set, the audience is a deployment choice:
  - **Collector-terminated:** Use a collector-specific audience (e.g., `otel-gateway`). The token is validated and consumed at the collector; identity is forwarded as derived attributes (e.g., `X-Scope-OrgID`). Suitable when backends trust the collector's identity assertions.
  - **Token passthrough:** Use the backend's expected audience (or a shared audience accepted by both collector and backend). The original token is forwarded via the headers setter extension so backends can perform their own TokenReview/SubjectAccessReview. Required when backends (e.g., MLflow) need the sender's token for their own authorization.
- The collector's service account needs a ClusterRole with `create` on `tokenreviews` in `authentication.k8s.io`.

## RHOAI Use Case Mapping

The RHOAI use case (RHAIRFE-3630, RHAISTRAT-2925) wants identity-based OTel trace routing from MaaS (Model-as-a-Service) endpoints to MLflow experiments. MaaS is an RHOAI feature that provides hosted LLM inference endpoints on OpenShift — agents/applications send prompts and get completions back. The MaaS architecture consists of an Envoy gateway with Authorino/Kuadrant for authentication, a payload processor (`ai-gateway-payload-processing`, an Envoy ext-proc plugin handling request/response mutation), and the model serving backend (KServe). RHAISTRAT-2925 describes **two trace flows**:

**Flow 1 — MaaS-captured traces (RHAISTRAT-2925 primary flow):** The MaaS payload processor (`ai-gateway-payload-processing`) captures LLM call traces (prompt, completion, latency, tokens) at the gateway layer without any agent instrumentation. The payload processor resolves routing via a `TraceRoutingRule` CRD that maps identity → workspace + experiment, stamps a `maas.trace.target_experiment` attribute on the span, and exports to the OTel Collector. RHAISTRAT-2925 proposes a **custom MLflow exporter** — an RHOAI-specific collector component (not an upstream OTel component) that uses the MLflow Go SDK (`opendatahub-io/mlflow-go`) to call the MLflow REST tracking API (e.g., `POST /api/2.0/mlflow/runs/create`, `/log-batch`). The exporter reads the `maas.trace.target_experiment` attribute to determine which experiment to write to, and passes workspace context via HTTP headers on the API calls. This component does not exist yet — it is part of the proposed RHAISTRAT-2925 design (auto-generated strategy, `New` status). An alternative that avoids building a custom exporter: use MLflow's native OTLP/HTTP endpoint (`/v1/traces`, since v3.6.0) with a standard `otlphttp` exporter and pass the experiment via the `x-mlflow-experiment-id` header. In this flow, Authorino/Kuadrant authenticates the caller at the MaaS API layer — the collector does not perform authentication.

**Flow 2 — Agent-emitted traces (OBSDA-1512 scope):** Agents send their own OTel traces directly to the collector with their K8s SA token. The collector authenticates the sender, routes by identity to the correct pipeline, and forwards to MLflow with the original token. This flow is what OBSDA-1512 enables — the collector itself is the authenticator.

Both flows converge at the collector and use the same downstream path to MLflow. OBSDA-1512 provides the collector primitives for Flow 2 and the routing/forwarding infrastructure for both.

| RHOAI Need | Flow 1 (MaaS-captured) | Flow 2 (Agent-emitted, OBSDA-1512) |
|---|---|---|
| Identify caller | Authorino/Kuadrant at MaaS gateway | K8s SA token auth at the collector |
| Route to MLflow experiment | `maas.trace.target_experiment` attribute set by payload processor | Routing connector with identity-based OTTL conditions |
| Prevent cross-tenant writes | MaaS gateway authorization + MLflow SAR | Collector auth + MLflow SAR with forwarded token |
| Correlate agent ↔ MaaS traces | Shared identity stamped into resource attributes by both payload processor and collector |

**MLflow authorization model:**

MLflow on RHOAI uses the [`mlflow-kubernetes-plugins`](https://github.com/HumairAK/mlflow-kubernetes-plugins) authorization plugin (`MLFLOW_K8S_AUTH_AUTHORIZATION_MODE=self_subject_access_review`). Every API request triggers a `SelfSubjectAccessReview` using the caller's bearer token, checking whether the token has permission on **pseudo-resources** in the `mlflow.kubeflow.org` API group. These pseudo-resources (`experiments`, `datasets`, `registeredmodels`, etc.) are not real CRDs — they exist only for RBAC policy evaluation.

Three built-in ClusterRoles:

| ClusterRole | Purpose | Verbs on `mlflow.kubeflow.org` pseudo-resources |
|---|---|---|
| `mlflow-operator-mlflow-view` | Read-only | `get`, `list` |
| `mlflow-operator-mlflow-edit` | Full write (human-facing) | `create`, `update`, `delete` + control-plane |
| `mlflow-operator-mlflow-integration` | Data-plane for service accounts | `get`, `list`, `create`, `update` (no `delete`) |

The **`mlflow-integration`** role is intended for the collector/agent use case. It supports `resourceName` granularity — a SA can be restricted to a specific experiment. Bound via a **RoleBinding** in the target workspace namespace.

Workspace = K8s namespace. The workspace provider maps MLflow workspaces to namespaces. The `X-MLFLOW-WORKSPACE` header selects the workspace on API calls.

**RHOAI-specific notes:**
- Authorization is **per service account**. MLflow performs a `SelfSubjectAccessReview` checking whether the SA has `create`/`update` on `experiments` in `mlflow.kubeflow.org` within the target namespace. "Namespace-level" isolation is an operational convention via RoleBindings, not a technical constraint — a SA could be granted cross-namespace access if needed.
- Each workspace contains multiple experiments; the experiment is targeted via the `x-mlflow-experiment-id` header (OTLP approach) or as an API parameter (custom exporter approach).
- The `TraceRoutingRule` CRD (RHAISTRAT-2925) is an RHOAI-specific abstraction, not a collector/operator feature. OBSDA-1512 provides the underlying collector primitives that such a CRD would configure.
- The `data-science-collector-mlflow-trace-export` ClusterRole mentioned in RHAISTRAT-2925 does not match any real role — the actual role is `mlflow-operator-mlflow-integration`.
- **Token passthrough (Flow 2 only):** MLflow needs the sender's original SA token to perform its own `SelfSubjectAccessReview`. The collector forwards the token via the headers setter extension's metadata passthrough (see "Identity Forwarding and Token Passthrough Example" above). This constrains the audience — the token must be acceptable to both collector and MLflow.

## Components Needed in the Red Hat Distro

| Component | Currently in Distro? | Required For |
|---|---|---|
| K8s SA Auth Extension (TokenReview + SAR) | **No — exists externally ([Jamstah](https://github.com/Jamstah/k8ssaauthextension)), not yet in contrib** | Sender authentication and authorization on OpenShift |
| OIDC Auth Extension | Yes (TP) | Sender authentication for JWT-bearing (non-K8s) senders |
| Routing Connector | Yes (TP) | Identity-based routing and implicit authorization |
| Resource Processor | Yes (GA) | Stamping verified identity into attributes |
| Attributes Processor | Yes (GA) | Stamping verified identity into span/log/metric attributes |
| Headers Setter Extension | Yes (undocumented) | Forwarding identity to backends |
| Transform Processor | Yes (GA) | Complex identity transformations |

**Action required:** Evaluate and improve the Jamstah `k8ssaauthextension`, then propose it for inclusion in `opentelemetry-collector-contrib`. Document the headers setter extension.

## Risks and Open Questions

### Risks

1. **K8s SA auth extension is early-stage.** The Jamstah `k8ssaauthextension` exists but is at development stability (6 commits, not yet proposed upstream). It needs improvements (caching, documented auth attributes) before production use. The kube-rbac-proxy sidecar pattern can serve as an interim solution.

2. **OIDC extension does not work for K8s SA tokens on OpenShift.** The OIDC discovery endpoint requires authentication (HTTP 401), and the issuer URL varies across cluster types (standard, AWS STS, Azure WIF). The `public_keys_file` workaround exists but is fragile. For non-K8s senders (external services with JWT tokens), the OIDC extension works as-is.

3. **Context loss at batch processor boundary.** If the pipeline order is wrong (batch before identity stamping), auth context is silently lost. This is a configuration footgun that documentation must address clearly.

4. **No error signaling to senders.** When data is dropped due to routing (implicit authorization), the sender receives a success response. This matches how many multi-tenant telemetry systems work but makes debugging harder.

5. **Routing connector and OIDC extension are both TP.** Building a supported multi-tenant capability on TP components has product implications. Promotion to GA should be evaluated.

### Open Questions

1. **Upstream path for `k8ssaauthextension`?** The Jamstah implementation exists but is not proposed upstream. Should Red Hat collaborate with the author (James Hewitt, IBM) to improve it (add caching, document auth attributes) and propose it for `opentelemetry-collector-contrib`? The `k8sattributesprocessor` provides precedent for K8s-specific components. Related upstream discussion: [#48895](https://github.com/open-telemetry/opentelemetry-collector-contrib/issues/48895).

2. **Should the operator generate multi-tenant config?** If this becomes a common pattern, operator-level support (Approach 3B) would reduce configuration burden significantly. Is there appetite for this API surface?

3. **What support level should identity-aware ingestion have?** The OIDC extension and routing connector are both TP today. Should this capability be GA, requiring promotion of both components?

4. **How does this interact with the signing spec (TRACING-6499)?** Signing provides non-repudiation — proof that telemetry was produced by a specific entity. Identity-aware ingestion provides sender authentication at the gateway. These are complementary: signing proves origin, auth proves the sender is allowed to submit. Should they share identity primitives?

5. **TokenReview caching strategy.** TokenReview is a synchronous per-request API call — unlike the K8s informer (List+Watch) pattern used by `k8sattributesprocessor` and `k8sclusterreceiver` for resource discovery. None of the existing collector auth extensions (OIDC, bearer token) cache token validation results — they validate every request. A TokenReview auth extension would be the first to need a per-request validation cache.

   The K8s ecosystem pattern is **passive TTL-based expiration with no active revocation** — no project implements push-based cache invalidation for TokenReview results:
   - **kube-rbac-proxy:** 10s default TTL (configurable via `--authentication-token-webhook-cache-ttl`)
   - **kube-apiserver:** 2 min default for webhook token cache (`--authentication-token-webhook-cache-ttl`), 30s for unauthorized SAR results
   - **Asymmetric caching is standard:** cache positive (authenticated) results longer, negative (rejected) results briefly or not at all

   Revocation is handled by **short-lived bound SA tokens** — projected tokens are bound to the pod, so deleting the pod triggers revocation within ~60s plus the cache TTL. This is the ecosystem's preferred revocation mechanism over explicit cache invalidation.

   **Recommendation:** configurable TTL with a short default (10s–2 min range), asymmetric positive/negative caching, cache key as SHA-256 hash of the token (not the raw token). What is the expected QPS and can the K8s API server handle it?

## Constraints

1. All approaches must work with the upstream OpenTelemetry Collector — no proprietary forks.
2. New components should be contributed upstream to opentelemetry-collector-contrib, not maintained only in the Red Hat distro.
3. The solution must work for OTLP over both gRPC and HTTP protocols.
4. SA token projection with a custom audience requires sender-side pod spec changes (`serviceAccountToken` volume with `audience` field) — this is a deployment requirement, not a collector change. The audience is optional (defaults to the cluster's API server audience). When set, the value depends on how identity is forwarded: a collector-specific audience when the collector terminates the token, or the backend's expected audience when the token is passed through for downstream authorization.
