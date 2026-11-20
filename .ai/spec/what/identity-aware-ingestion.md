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
        action: delete                       # clear any sender-supplied value first
      - key: sender.service_account
        action: delete                       # clear any sender-supplied value first
      - key: sender.namespace
        from_context: "auth.namespace"
        action: insert                       # skipped silently if the auth attribute is missing
      - key: sender.service_account
        from_context: "auth.service_account"
        action: insert
```

**Security: delete before stamping, and reject unstamped data.** Using `upsert` alone is unsafe — if the auth extension does not provide the requested attribute, `upsert` leaves any pre-existing value unchanged, so a sender could supply a `sender.namespace` resource attribute that downstream consumers mistake for verified identity. The `delete` first removes any sender-supplied value. Caveat: `insert` does **not** fail visibly — in `attraction.go` (checked at v0.163.0) the action is silently skipped when the `from_context` value is not found, with no log or error, and after the `delete` it behaves the same as `upsert`. The data continues with no `sender.namespace` and nothing tells the operator. The actual enforcement must therefore be structural: route data without a verified identity to the reject pipeline (see the routing connector's `default_pipelines` in the examples below) so unstamped data never reaches a tenant exporter.

Confirmed in [`internal/coreinternal/attraction/attraction.go`](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/internal/coreinternal/attraction/attraction.go) (line 371: `authPrefix = "auth."`).

### Identity Forwarding to Backends

The **headers setter extension** (`headerssetter`) can set outbound headers on exporter requests. It supports two source types:

1. **`from_context`** — reads from `client.Info.Metadata` (request headers/gRPC metadata). Requires `include_metadata: true` on the receiver. Resolves any key present in the incoming request metadata (case-insensitive). Implementation: [`headerssetterextension/internal/source/context.go`](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/extension/headerssetterextension/internal/source/context.go).

2. **`from_attribute`** — reads from `client.Info.Auth.GetAttribute(key)` (auth extension attributes like `subject`, `membership`, `claims.*`). Implementation: [`headerssetterextension/internal/source/attribute.go`](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/extension/headerssetterextension/internal/source/attribute.go).

**Important:** The headers setter's `from_context` and `from_attribute` are different from the resource processor's `from_context`. The resource processor's `from_context` supports the `auth.` prefix to read auth attributes (e.g., `from_context: "auth.claims.tenant_id"`). The headers setter does NOT — its `from_context` reads only from request metadata, and `from_attribute` reads from auth attributes.

### Identity Forwarding and Token Passthrough Example

This example shows the RHOAI Flow 2 pattern for MLflow: the routing connector selects a per-identity pipeline using verified auth attributes, each pipeline sets a **static** experiment header, and the raw bearer token is passed through so MLflow can perform its own `SelfSubjectAccessReview`. It assumes the `k8s_sa_auth` extension (Authentication Option B) exists — it does not exist yet.

When `include_metadata: true` is set on the receiver, ALL incoming headers (including `Authorization`) are stored in `client.Info.Metadata`. The headers setter extension forwards the token using `from_context` (which reads from metadata). This works for both gRPC ([`configgrpc.go`](https://github.com/open-telemetry/opentelemetry-collector/blob/main/config/configgrpc/configgrpc.go) copies all gRPC metadata) and HTTP ([`confighttp/clientinfohandler.go`](https://github.com/open-telemetry/opentelemetry-collector/blob/main/config/confighttp/clientinfohandler.go) clones all HTTP headers) receivers.

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        include_metadata: true            # store request headers in client.Info.Metadata
        auth:
          authenticator: k8s_sa_auth
      http:
        include_metadata: true
        auth:
          authenticator: k8s_sa_auth

extensions:
  k8s_sa_auth: {}                         # audiences defaults to the API server audience — required for MLflow passthrough (see audience note below)
  headers_setter/team-a:
    headers:
      - action: upsert
        key: x-mlflow-experiment-id        # static per-tenant experiment — never taken from sender metadata
        value: "12345"
      - action: upsert
        key: Authorization                 # raw bearer token passthrough for MLflow SSAR
        from_context: authorization        # reads from client.Info.Metadata

processors:
  resource/stamp-identity:
    attributes:
      - key: sender.namespace
        action: delete                     # clear sender-supplied value
      - key: sender.service_account
        action: delete                     # clear sender-supplied value
      - key: sender.namespace
        from_context: "auth.namespace"
        action: insert                     # insert verified identity
      - key: sender.service_account
        from_context: "auth.service_account"
        action: insert

connectors:
  routing:
    table:
      - condition: otelcol.client.auth.attributes["namespace"] == "team-a"
        pipelines: [traces/team-a]
    default_pipelines: [traces/reject]     # data without verified identity never reaches a tenant exporter

exporters:
  otlphttp/mlflow-team-a:
    endpoint: http://mlflow:5000           # the exporter auto-appends /v1/traces; MLflow OTLP/HTTP requires v3.7.0+ (v3.6.0 has gzip and content-type bugs), gRPC not supported. Use TLS in production.
    auth:
      authenticator: headers_setter/team-a
    sending_queue:                         # replaces the deprecated batchprocessor (QueueBatchConfig)
      batch:                               # batching config within the sending queue
        partition:                         # partitioning controls how requests are grouped into batches
          metadata_keys:                   # requests with different values for these keys get separate batches
            - authorization                # each unique bearer token gets its own batch, preserving the token across batching
  debug/reject:
    verbosity: basic

service:
  extensions: [k8s_sa_auth, headers_setter/team-a]
  pipelines:
    traces/ingress:
      receivers: [otlp]
      processors: [resource/stamp-identity]
      exporters: [routing]
    traces/team-a:
      receivers: [routing]
      exporters: [otlphttp/mlflow-team-a]
    traces/reject:
      receivers: [routing]
      exporters: [debug/reject]
```

The `traces/team-a` pipeline pattern repeats per tenant — one headers setter, one exporter, one routing table entry each.

**Three header sources, different trust and durability characteristics:**
- **Static `value:`** — the per-tenant experiment (or tenant) header. The routing connector already selected the pipeline using verified auth attributes before batching, so a hardcoded value is trusted. Safe under batching. This is the only safe way to set a tenant identifier on a batched exporter.
- **`from_context: authorization`** — token passthrough. The sender controls the header, but the auth extension validates the token at ingestion, so forwarding it is safe. Survives batching when `metadata_keys` includes `authorization`.
- **`from_attribute`** — reads verified identity from `client.Info.Auth`. **Do not use with a batched exporter:** the headers setter's `AttributeSource.Get` calls `cl.Auth.GetAttribute` with no nil check, and when a second request merges into an existing batch the batch context carries `client.Info{Metadata: ...}` only — `Auth` is nil and the collector **panics** (same code at v0.158.0 and v0.163.0; a single request per batch keeps its original context, so the crash appears only under load). Without batching it works and is spoof-proof. With batching, use static per-pipeline values instead.

**Security: never derive a tenant header from sender metadata.** `from_context` reads from request metadata — the sender controls all incoming headers. **Never use `from_context` with a sender-supplied header as a tenant identifier** (e.g., `X-Scope-OrgID` or `x-mlflow-experiment-id`), because the sender can set any value and select another tenant even when authentication succeeds. The safe patterns:
- **Without batching:** use `from_attribute` (reads verified identity from `client.Info.Auth`).
- **With batching:** per-tenant pipelines with **static** header values, as in the example above — the routing decision is made on verified auth attributes before batching, and the headers setter uses a hardcoded `value:`.

**Batching caveat:** `metadata_keys` preserves specified metadata keys across batching but creates per-token batching buckets — each unique token gets its own batch. This preserves correctness but reduces batching efficiency. The config above uses exporter-level batching (`sending_queue::batch`) which replaces the deprecated `batchprocessor` (see migration RFC: [`docs/rfcs/batching-migration.md`](https://github.com/open-telemetry/opentelemetry-collector/blob/main/docs/rfcs/batching-migration.md)).

**Audience constraint for passthrough:** a shared custom audience **cannot work** when the backend validates the forwarded token via the K8s API. MLflow performs its `SelfSubjectAccessReview` with the forwarded token as a bearer credential against kube-apiserver, and the API server only accepts tokens that carry its own audience. A `serviceAccountToken` volume projection takes a single audience, so in practice the sender must use the **default-audience** token (audience `https://kubernetes.default.svc`) and the collector's TokenReview must accept that audience — which is the default. A collector-specific audience (e.g., `otel-gateway`) works only for the collector-terminated pattern, where identity is forwarded as derived attributes and the backend never sees the token. See the audience discussion in the End-to-End Example below.

The headers setter extension is Technology Preview since 3.11 (docs module in review: [openshift/openshift-docs#124255](https://github.com/openshift/openshift-docs/pull/124255), TRACING-6505). The 3.12 build ships `headerssetterextension` v0.163.0 (see `what/collector.md`).

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
| `client.Info.Auth` | Structured identity from an auth extension: claims, subject, groups, raw token. Set by extensions like OIDC (`subject`, `membership`, `claims.*`, `raw`) or the proposed K8s SA auth (`namespace`, `service_account`). | **Never** — absent in all batching scenarios, including persistent queue (not serialized). Reading it via the headers setter's `from_attribute` after a batch merge **panics the collector** (nil `Auth`, no nil check in `AttributeSource.Get`) |
| `client.Info.Addr` | The client's network address (`net.Addr`). | Lost in memory batching; preserved in persistent queue serialization |

**Implications for pipeline ordering:**
- The **routing connector** must run before batching — it reads `client.Info.Auth` directly.
- The **resource processor** must stamp auth attributes into resource attributes before batching — stamped attributes survive in the telemetry data.
- The headers setter's **`from_attribute`** reads from `client.Info.Auth` — after a batch merge `Auth` is nil and the collector **panics**. Do not use it with a batched exporter; use static per-pipeline header values instead (see Identity Forwarding and Token Passthrough Example above).
- The headers setter's **`from_context`** reads from `client.Info.Metadata` — works after batching if the key is listed in `metadata_keys`. Use it only for token passthrough, never for tenant identifiers (sender-controlled).

## Gap Analysis

### What Works Today

| Need | Mechanism | Status |
|---|---|---|
| Authenticate JWT-bearing senders | OIDC auth extension | **Works** (TP) |
| Extract identity claims to pipeline context | OIDC auth → `client.Info.Auth` | **Works** |
| Stamp verified identity into resource attributes | Resource processor `from_context: "auth.claims.*"` | **Works** |
| Route to per-tenant pipelines based on identity | Routing connector `otelcol.client.auth.attributes["key"]` | **Works** (TP) |
| Forward identity to multi-tenant backends | Headers setter extension with static per-pipeline values (plus `from_context` for token passthrough only) | **Works** — extension in distro (TP since 3.11) |

### What Is Missing

| Need | Gap | Severity |
|---|---|---|
| **Kubernetes SA token authentication** | The OIDC extension **cannot** validate K8s SA tokens on OpenShift out of the box (see below). A new TokenReview auth extension is needed. | **High** — K8s workloads are the primary sender type on OpenShift |
| **Authorization enforcement** | Auth extensions authenticate (who?) but nothing authorizes (may this sender write here?). The routing connector provides implicit authorization (route or drop) via its static routing table — a workable baseline, but explicit SubjectAccessReview-based rejection is preferred (see Authorization section). | **Medium** — implicit authorization drops silently; explicit rejection is preferred |
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

A dedicated extension that validates the bearer token via the K8s TokenReview API, extracts identity (namespace, service account name, groups), and exposes them as auth attributes. This does not exist upstream yet — contrib v0.163.0 (the version 3.12 ships) and contrib main have no Kubernetes token auth extension. An external implementation exists: [`github.com/Jamstah/k8ssaauthextension`](https://github.com/Jamstah/k8ssaauthextension) by James Hewitt (IBM). Its component type is `k8ssaauth` and `audiences` defaults to `["https://kubernetes.default.svc"]`.

```yaml
extensions:
  k8s_sa_auth:   # component type in the Jamstah implementation: k8ssaauth
    # audiences defaults to ["https://kubernetes.default.svc"] (the API server audience)
```

The Jamstah implementation also includes a **SubjectAccessReview** step — and it is **mandatory**, not optional: `resource_attributes` (the SAR target) is a required setting, so the extension always performs TokenReview + SAR. See Authorization section below.

**Current status:** Development stability, 6 commits, not proposed for `opentelemetry-collector-contrib`. The related core collector issue [#6987](https://github.com/open-telemetry/opentelemetry-collector/issues/6987) (closed) was about client-side K8s SA auth, not server-side.

**Gaps:**
- **The extension sets no `client.Info.Auth` at all.** In `k8ssaauth.go` the `Authenticate` function returns the incoming `ctx` unchanged, so no identity is exposed to the pipeline. Routing on `otelcol.client.auth.attributes["namespace"]`, resource processor `from_context: "auth.namespace"` and headers setter `from_attribute` all have nothing to read. Exposing the identity is new work, not just documentation.
- **The TokenReview-only variant does not exist.** Because `resource_attributes` is required, there is no authentication-only mode; making SAR optional is new work if that variant is wanted.
- No caching of TokenReview or SubjectAccessReview results.

**Path forward:** Build on the Jamstah extension but treat it as a starting point: exposing identity via `client.Info.Auth` and making the SAR step optional are new development work, not improvements to existing behavior. Propose the result for `opentelemetry-collector-contrib`. The `k8sattributesprocessor` provides precedent for K8s-specific components in contrib.

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

The K8s SA auth extension (Authentication Option B) includes a SubjectAccessReview step that rejects unauthorized senders _before_ data enters the pipeline — in the Jamstah implementation this step is mandatory (`resource_attributes` is a required setting; there is no TokenReview-only mode yet):

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

Combining components for a two-tenant setup where each tenant uses a K8s service account with a projected token. This example assumes the TokenReview auth extension (Authentication Option B) exists.

```yaml
extensions:
  k8s_sa_auth:
    audiences: [otel-gateway]   # collector-terminated pattern — see audience note in Key points below
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
          authenticator: k8s_sa_auth
      http:
        auth:
          authenticator: k8s_sa_auth

processors:
  resource/stamp-identity:
    attributes:
      - key: sender.namespace
        action: delete
      - key: sender.service_account
        action: delete
      - key: sender.namespace
        from_context: "auth.namespace"
        action: insert
      - key: sender.service_account
        from_context: "auth.service_account"
        action: insert
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
  extensions: [k8s_sa_auth, headers_setter/team-a, headers_setter/team-b]
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
  - **Collector-terminated:** Use a collector-specific audience (e.g., `otel-gateway`). The token is validated and consumed at the collector; identity is forwarded as derived attributes (e.g., `X-Scope-OrgID`). Suitable when backends trust the collector's identity assertions. This is the pattern shown in this Tempo example.
  - **Token passthrough:** The sender must use the **default-audience** token. Backends like MLflow present the forwarded token to kube-apiserver (SelfSubjectAccessReview), and the API server only accepts tokens carrying its own audience — a collector-specific or shared custom audience breaks the backend's validation. The collector's TokenReview must accept the default audience (which is its default). Required when backends (e.g., MLflow) need the sender's token for their own authorization.
- The collector's service account needs a ClusterRole with `create` on `tokenreviews` in `authentication.k8s.io`.

## RHOAI Use Case Mapping

The RHOAI use case (RHAIRFE-3630, RHAISTRAT-2925) wants identity-based OTel trace routing from MaaS (Model-as-a-Service) endpoints to MLflow experiments. MaaS is an RHOAI feature that provides hosted LLM inference endpoints on OpenShift — agents/applications send prompts and get completions back. The MaaS architecture consists of an Envoy gateway with Authorino/Kuadrant for authentication, a payload processor (`ai-gateway-payload-processing`, an Envoy ext-proc plugin handling request/response mutation), and the model serving backend (KServe). RHAISTRAT-2925 describes **two trace flows**:

**Flow 1 — MaaS-captured traces (RHAISTRAT-2925, not in OBSDA-1512 scope):** The MaaS payload processor (`ai-gateway-payload-processing`) captures LLM call traces (prompt, completion, latency, tokens) at the gateway layer without any agent instrumentation. The payload processor resolves routing via a `TraceRoutingRule` CRD that maps identity → workspace + experiment, stamps a `maas.trace.target_experiment` attribute on the span, and exports to the OTel Collector. RHAISTRAT-2925 proposes a **custom MLflow exporter** — an RHOAI-specific collector component (not an upstream OTel component) that uses the MLflow Go SDK (`opendatahub-io/mlflow-go`) to call the MLflow REST tracking API (e.g., `POST /api/2.0/mlflow/runs/create`, `/log-batch`). The exporter reads the `maas.trace.target_experiment` attribute to determine which experiment to write to, and passes workspace context via HTTP headers on the API calls. This component does not exist yet — it is part of the proposed RHAISTRAT-2925 design (auto-generated strategy, `New` status). An alternative that avoids building a custom exporter: use MLflow's native OTLP/HTTP endpoint (`/v1/traces`, requires v3.7.0+) with a standard `otlphttp` exporter and pass the experiment via the `x-mlflow-experiment-id` header. In this flow, Authorino/Kuadrant authenticates the caller at the MaaS API layer — the collector does not perform authentication. Receiver isolation (preventing direct access that bypasses the MaaS gateway) is an RHOAI deployment concern (network policy), not an OTel collector feature.

**Flow 2 — Agent-emitted traces (OBSDA-1512 scope):** Agents send their own OTel traces directly to the collector with their K8s SA token. The collector authenticates the sender, routes by identity to the correct pipeline, and forwards to MLflow with the original token. This flow is what OBSDA-1512 enables — the collector itself is the authenticator.

Both flows converge at the collector and use the same downstream path to MLflow. OBSDA-1512 provides the collector primitives for Flow 2 and the routing/forwarding infrastructure for both.

| RHOAI Need | Flow 1 (MaaS-captured) | Flow 2 (Agent-emitted, OBSDA-1512) |
|---|---|---|
| Identify caller | Authorino/Kuadrant at MaaS gateway | K8s SA token auth at the collector |
| Route to MLflow experiment | `maas.trace.target_experiment` attribute set by payload processor | Routing connector with identity-based OTTL conditions |
| Prevent cross-tenant writes | MaaS gateway authorization + MLflow SAR | Collector auth + MLflow SAR with forwarded token |
| Correlate agent ↔ MaaS traces | Identity stamped into resource attributes by the payload processor | Identity stamped into resource attributes by the collector from the verified SA token |

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
- **Token passthrough (Flow 2 only):** MLflow needs the sender's original SA token to perform its own `SelfSubjectAccessReview`. The collector forwards the token via the headers setter extension's metadata passthrough (see "Identity Forwarding and Token Passthrough Example" above). MLflow presents the token to kube-apiserver, which only accepts tokens carrying the API server audience — so senders must use **default-audience** tokens and the collector must accept that audience (its default). A collector-specific audience breaks MLflow's validation.

## Components Needed in the Red Hat Distro

| Component | Currently in Distro? | Required For |
|---|---|---|
| K8s SA Auth Extension (TokenReview + SAR) | **No — exists externally ([Jamstah](https://github.com/Jamstah/k8ssaauthextension)), not yet in contrib** | Sender authentication and authorization on OpenShift |
| OIDC Auth Extension | Yes (TP) | Sender authentication for JWT-bearing (non-K8s) senders |
| Routing Connector | Yes (TP) | Identity-based routing and implicit authorization |
| Resource Processor | Yes (GA) | Stamping verified identity into attributes |
| Attributes Processor | Yes (GA) | Stamping verified identity into span/log/metric attributes |
| Headers Setter Extension | Yes (TP since 3.11) | Forwarding identity to backends |
| Transform Processor | Yes (GA) | Complex identity transformations |

**Action required:** Build a K8s SA auth extension for `opentelemetry-collector-contrib`. The Jamstah `k8ssaauthextension` is a starting point, but two pieces are new work, not improvements: (1) its `Authenticate` returns the context unchanged — it sets no `client.Info.Auth`, so exposing identity (namespace, service account as auth attributes) must be developed; (2) its SubjectAccessReview step is mandatory (`resource_attributes` is required), so a TokenReview-only variant must also be developed if wanted. Headers setter documentation is already in progress (TRACING-6505).

## Risks and Open Questions

### Risks

1. **K8s SA auth extension is early-stage.** The Jamstah `k8ssaauthextension` exists but is at development stability (6 commits, not yet proposed upstream). Beyond maturity, two functional gaps require new development: its `Authenticate` sets no `client.Info.Auth` (identity is not exposed to the pipeline at all), and its SubjectAccessReview step is mandatory (`resource_attributes` is required), so no TokenReview-only variant exists. Caching is also missing. The kube-rbac-proxy sidecar pattern can serve as an interim solution.

2. **OIDC extension does not work for K8s SA tokens on OpenShift.** The OIDC discovery endpoint requires authentication (HTTP 401), and the issuer URL varies across cluster types (standard, AWS STS, Azure WIF). The `public_keys_file` workaround exists but is fragile. For non-K8s senders (external services with JWT tokens), the OIDC extension works as-is.

3. **Context loss at batch processor boundary.** If the pipeline order is wrong (batch before identity stamping), auth context is silently lost — and the headers setter's `from_attribute` on a batched exporter doesn't just lose the header, it **panics the collector** (nil `Auth` after a batch merge, no nil check in `AttributeSource.Get`; visible only under load, when requests actually merge). This is a configuration footgun that documentation must address clearly.

4. **No error signaling to senders.** When data is dropped due to routing (implicit authorization), the sender receives a success response. This matches how many multi-tenant telemetry systems work but makes debugging harder.

5. **Routing connector and OIDC extension are both TP.** Building a supported multi-tenant capability on TP components has product implications. Promotion to GA should be evaluated.

6. **Token passthrough forwards API-capable credentials through the shared collector.** With passthrough, every sender's SA token — usable against the K8s API within the SA's RBAC permissions — transits the collector and is forwarded to the backend. A compromised collector, a compromised backend, or an eavesdropped connection can replay the token until it expires. Mitigations: TLS on the collector→backend hop (the examples show plain `http://` for readability only), short-lived bound SA tokens, and backend Roles scoped to the minimum verbs (e.g., `mlflow-operator-mlflow-integration`).

### Open Questions

1. **Upstream path for `k8ssaauthextension`?** The Jamstah implementation exists but is not proposed upstream. Should Red Hat collaborate with the author (James Hewitt, IBM) to improve it (add caching, document auth attributes) and propose it for `opentelemetry-collector-contrib`? The `k8sattributesprocessor` provides precedent for K8s-specific components. Related upstream discussion: [#48895](https://github.com/open-telemetry/opentelemetry-collector-contrib/issues/48895).

2. **Should the operator generate multi-tenant config?** If this becomes a common pattern, operator-level support (generating the routing table, per-tenant pipelines and headers from a CRD) would reduce configuration burden significantly. Is there appetite for this API surface?

3. **What support level should identity-aware ingestion have?** The OIDC extension and routing connector are both TP today. Should this capability be GA, requiring promotion of both components?

4. **How does this interact with the signing spec (TRACING-6499)?** Signing provides non-repudiation — proof that telemetry was produced by a specific entity. Identity-aware ingestion provides sender authentication at the gateway. These are complementary: signing proves origin, auth proves the sender is allowed to submit. Should they share identity primitives?

5. **TokenReview caching strategy.** TokenReview is a synchronous per-request API call — unlike the K8s informer (List+Watch) pattern used by `k8sattributesprocessor` and `k8sclusterreceiver` for resource discovery. None of the existing collector auth extensions (OIDC, bearer token) cache token validation results — they validate every request. A TokenReview auth extension would be the first to need a per-request validation cache.

   The K8s ecosystem pattern is **passive TTL-based expiration with no active revocation** — no project implements push-based cache invalidation for TokenReview results:
   - **kube-rbac-proxy:** 10s default TTL (configurable via `--authentication-token-webhook-cache-ttl`)
   - **kube-apiserver:** 2 min default for webhook token cache (`--authentication-token-webhook-cache-ttl`), 30s for unauthorized SAR results
   - **Asymmetric caching is standard:** cache positive (authenticated) results longer, negative (rejected) results briefly or not at all

   Revocation is handled by **short-lived bound SA tokens** — projected tokens are bound to the pod, so deleting the pod triggers revocation within ~60s plus the cache TTL. This is the ecosystem's preferred revocation mechanism over explicit cache invalidation.

   **Recommendation:** configurable TTL with a short default (10s–2 min range), asymmetric positive/negative caching, cache key as SHA-256 hash of the token (not the raw token). What is the expected QPS and can the K8s API server handle it?
