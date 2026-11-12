# Identity-Aware Authentication and Authorization for Telemetry Ingestion

[PLANNED: OBSDA-1512] Research spec — documents how the OTEL collector and operator could support identity-aware authentication and authorization at the ingestion layer, with multi-tenant routing as the primary use case.

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
| **Basic Auth** (`basicauth`) | Not in Red Hat distro | Username/password validation. | Not in the Red Hat distro manifest. |
| **OAuth2 Client** (`oauth2clientauth`) | **TP** | Client-side only (for exporters authenticating to backends). | Not a server authenticator — irrelevant for receiver auth. |

**Bottom line:** OIDC auth is the only extension that both authenticates _and_ extracts identity attributes. Bearer token auth is identity-blind.

### Identity Propagation Through the Pipeline

Two mechanisms carry authenticated identity into the pipeline:

**1. `from_context` in resource/attributes processors** — reads `client.Info.Auth.GetAttribute(name)` via the `auth.` prefix:

```yaml
processors:
  resource:
    attributes:
      - key: tenant.id
        from_context: "auth.claims.tenant_id"
        action: upsert
      - key: sender.subject
        from_context: "auth.subject"
        action: upsert
```

This stamps verified identity into resource attributes, where it survives batching, is exported with the data, and is available for downstream routing. Confirmed in `internal/coreinternal/attraction/attraction.go` (line 371: `authPrefix = "auth."`).

**2. OTTL otelcol context in the routing connector** — accesses auth attributes directly:

```yaml
connectors:
  routing:
    table:
      - condition: otelcol.client.auth.attributes["claims.tenant_id"] == "team-a"
        pipelines: [traces/team-a]
      - condition: otelcol.client.auth.attributes["claims.tenant_id"] == "team-b"
        pipelines: [traces/team-b]
    default_pipelines: [traces/default]
```

Documented in `pkg/ottl/contexts/ottlotelcol/README.md`: `otelcol.client.auth.attributes["key"]` reads a specific auth attribute; the full map is also available.

### Identity Forwarding to Backends

The **headers setter extension** (`headerssetter`) can set outbound headers on exporter requests. This is how verified identity reaches multi-tenant backends:

```yaml
extensions:
  headers_setter:
    headers:
      - action: upsert
        key: X-Scope-OrgID
        from_context: "auth.claims.tenant_id"
```

Multi-tenant backends like Tempo, Mimir, and Loki use `X-Scope-OrgID` for tenant isolation.

The headers setter extension is in the Red Hat distro manifest (`headerssetterextension v0.158.0`). Not supported — present in source but not documented (see `what/collector.md`).

### Routing Connector

The routing connector (TP in the Red Hat distro) routes telemetry to different pipelines based on OTTL conditions. It supports resource, span, log, metric, datapoint, and otelcol contexts. Key capabilities:

- Routes on `otelcol.client.auth.attributes["key"]` — identity-based routing without stamping attributes first.
- Routes on `otelcol.client.metadata["key"]` or `otelcol.grpc.metadata["key"]` — header-based routing.
- Routes on `resource.attributes["key"]` — attribute-based routing (after identity has been stamped).
- Static routing table — adding/removing tenants requires config changes and collector reload.

### Context Lifecycle Warning

`client.Info` (including auth data) is per-request context. The **batch processor aggregates across requests and discards per-request context**. Auth data must be stamped into resource attributes via the resource processor _before_ the batch processor for it to survive. The routing connector should also be placed before batching, or use `from_context` to stamp first.

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
| **End-to-end identity standard** | No standard format for passing verified identity between collector and backends. Each backend has its own header convention. | **Low** — can be handled per-backend with headers setter |

## Approaches

### Approach 1: Kubernetes Service Account Token Authentication

Kubernetes service account tokens are JWTs signed by the cluster's service account issuer. Three options for validating them at the collector:

#### Option A: OIDC Auth Extension Pointed at K8s Issuer — Does Not Work on OpenShift

The OIDC auth extension fetches `{issuer_url}/.well-known/openid-configuration` at startup using a plain HTTP client with no bearer token. On Kubernetes/OpenShift, the API server serves this endpoint but **requires authentication** — it is bound to `system:serviceaccounts` via the `system:service-account-issuer-discovery` ClusterRole. The extension's unauthenticated request fails with HTTP 401.

**Additional complications:**
- **Issuer URL varies by cluster type.** Standard OpenShift uses `iss: https://kubernetes.default.svc`. AWS STS OpenShift uses an S3 bucket URL. Azure WIF ARO uses `https://{region}.oic.aro.azure.net/{tenant}/{uuid}`. The extension config must match the cluster's actual issuer, making a generic config impossible.
- **CA cert pool is exclusive.** The OIDC extension creates a new empty cert pool with only the issuer CA — system roots are not included. This works for `kubernetes.default.svc` (the mounted CA covers it) but may break if the JWKS URI points elsewhere.
- **Audience must be projected.** Default SA tokens use `aud: ["https://kubernetes.default.svc"]`. Senders must project tokens with a custom audience via a `serviceAccountToken` volume, and the extension must be configured with that audience.

**Workaround — `public_keys_file`:** The extension supports loading a JWKS file directly via the `public_keys_file` option, bypassing OIDC discovery. The file is watched and reloaded on changes. The cluster JWKS could be exported to a ConfigMap/Secret and mounted. Key rotation is rare on OpenShift, so this is operationally viable but adds a distribution mechanism (e.g., CronJob to refresh the JWKS).

**Verdict:** The OIDC extension does not work out of the box for K8s SA tokens on OpenShift. The `public_keys_file` workaround is fragile and operationally complex.

#### Option B1: K8s SA Auth Extension — TokenReview Only (Authentication Only)

A K8s SA auth extension that performs only TokenReview: it validates the bearer token, extracts identity (namespace, service account name, groups), and exposes them as auth attributes. Authorization is handled downstream by the routing connector — see Approach 2 Option A.

```yaml
extensions:
  k8s_token_auth:
    audiences: [opentelemetry-collector]
```

**Pros:** Clean separation of concerns — authentication in the extension, authorization in the pipeline. The extension is simpler (one API call, easier to cache). Authorization rules are visible in the collector config alongside the routing topology. No K8s RBAC resources to manage for telemetry-specific permissions. Works with the existing routing connector (no new components beyond the extension).
**Cons:** Authorization is implicit (route or drop, no error to sender). Adding/removing tenants requires collector config changes. The routing table and auth are in different places (extension config vs connector config), which can drift.

#### Option B2: K8s SA Auth Extension — TokenReview + SubjectAccessReview (Authentication + Authorization)

An external implementation exists: [`github.com/Jamstah/k8ssaauthextension`](https://github.com/Jamstah/k8ssaauthextension) by James Hewitt (IBM). It performs two-step server-side auth:

1. **TokenReview API** — validates the bearer token is a legitimate K8s SA token and extracts identity.
2. **SubjectAccessReview API** — checks if the authenticated SA has RBAC permission to perform a configured action (e.g., `verb: export` on `resource: telemetry` in `group: telemetry.opentelemetry.io`).

```yaml
extensions:
  k8s_sa_auth:
    audiences: [opentelemetry-collector]
    resource_attributes:
      group: telemetry.opentelemetry.io
      resource: telemetry
      verb: export
```

Authorization is managed via standard Kubernetes RBAC: an admin creates a Role granting `export` on `telemetry` resources and binds it to the sender's service account. Senders without the binding are rejected at the auth layer before data enters the pipeline.

**Pros:** True authorization with rejection at the auth layer (sender gets an error, not a silent drop). Authorization managed via standard K8s RBAC — familiar to cluster admins, auditable via K8s audit logs. Adding a sender is a RoleBinding, not a collector config change.
**Cons:** SubjectAccessReview is a second synchronous API call per request (must be cached). Authorization is coarse-grained — SAR checks a single resource/verb, not per-destination policies. The routing table still needs to map identity → pipeline, so authorization (SAR) and routing (connector) are in different systems. More complex to reason about: two authorization models (SAR gates entry, routing directs traffic).

#### Shared Context for B1 and B2

**Current status of Jamstah extension:** Development stability, 6 commits, not yet proposed for inclusion in `opentelemetry-collector-contrib`. No existing issue or PR in contrib requests this component. The related core collector issue [#6987](https://github.com/open-telemetry/opentelemetry-collector/issues/6987) (closed) was about client-side K8s SA auth, not server-side.

**Gaps in the existing implementation:**
- Auth attributes exposed via `client.Info.Auth` are not documented — unclear whether `namespace`, `service_account`, `subject` etc. are available for downstream routing/processing.
- No caching of TokenReview or SubjectAccessReview results — scalability concern under high request volume.

**Path forward:** Evaluate the Jamstah extension, contribute improvements (caching, auth attribute exposure), and propose it for inclusion in `opentelemetry-collector-contrib`. A TokenReview-only variant (B1) could be a simpler first contribution. The `k8sattributesprocessor` provides precedent for K8s-specific components in contrib.

**Upstream discussion:** Issue [#48895](https://github.com/open-telemetry/opentelemetry-collector-contrib/issues/48895) ("Support Multitenant Kubernetes Self-Service") discusses dynamic multi-tenant routing at scale — the closest upstream conversation to this use case.

#### Option C: Auth Proxy Sidecar (kube-rbac-proxy)

Deploy `kube-rbac-proxy` as a sidecar in front of the collector. The proxy validates SA tokens via TokenReview, optionally checks SubjectAccessReview, and forwards authenticated identity as HTTP headers to the collector.

**Identity propagation:** kube-rbac-proxy must be started with `--auth-header-fields-enabled=true`. It then sets `x-remote-user` (e.g. `system:serviceaccount:ns:name`) and `x-remote-groups` on proxied requests. The collector reads these via `include_metadata: true` on the OTLP receiver:

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

The routing connector can then route on `otelcol.client.metadata["x-remote-user"]`, and the resource processor can stamp identity via `from_context: "metadata.x-remote-user"`. gRPC is supported via `--upstream-force-h2c`.

**Security requirement:** The identity headers are untrusted client-supplied metadata from the collector's perspective. The collector's receiver must bind to `localhost` so only the sidecar can reach it, and a NetworkPolicy must prevent any other pod from bypassing the proxy. Without this, any sender can set `x-remote-user` and impersonate any identity.

**Pros:** Well-established pattern on OpenShift. No collector code changes. kube-rbac-proxy already supports TokenReview + SubjectAccessReview. Works for both HTTP and gRPC. Can serve as an interim solution while the `k8ssaauthextension` matures.
**Cons:** Identity is carried as metadata headers, not `client.Info.Auth` — requires the localhost-binding + NetworkPolicy security model. Adds a sidecar container and network hop. The operator would need to inject the sidecar via `additionalContainers`.

#### Recommendation

**Option B1** (TokenReview-only + routing connector authorization) is the simplest path — it requires only a single-purpose auth extension and leverages the existing routing connector for authorization. It's the easiest to contribute upstream and covers the primary use case.

**Option B2** (TokenReview + SubjectAccessReview) adds K8s RBAC-based authorization. It's more powerful but also more complex — the Jamstah extension already implements this. Worth evaluating if K8s-native authorization management is important to the stakeholders.

**Option C** (kube-rbac-proxy sidecar) is a viable interim solution while the auth extension matures. **Option A** (OIDC extension) does not work on OpenShift without fragile workarounds.

### Approach 2: Authorization

Two authorization models are possible:

#### Option A: Implicit Authorization via Routing Connector

The routing connector's OTTL conditions act as an implicit authorization layer: authenticated senders are routed to their allowed pipelines, and unmatched senders go to `default_pipelines` which routes to a reject pipeline.

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

**How it works:** Each routing rule is an allow rule (identity X → pipeline Y). Per-tenant pipeline isolation means a sender cannot write to another tenant's backend. Unmatched senders go to `traces/reject`. Static routing table in the collector config — adding a tenant requires a config change and collector reload, acceptable for the expected tenant counts.

**Limitations:** The sender receives a success response even when data is dropped. No fine-grained policies per signal type (though separate routing connectors per signal are possible). Static table requires config changes for tenant additions.

#### Option B: Authorization via Kubernetes RBAC (SubjectAccessReview)

The Jamstah `k8ssaauthextension` (Approach 1 Option B) includes a SubjectAccessReview step that checks whether the authenticated SA has K8s RBAC permission to perform a configured action. This means authorization can be managed via standard Kubernetes Roles/ClusterRoles:

```yaml
# In the auth extension config:
extensions:
  k8s_sa_auth:
    resource_attributes:
      group: telemetry.opentelemetry.io
      resource: telemetry
      verb: export

# Then a K8s Role grants access:
# kind: ClusterRole
# rules:
#   - apiGroups: [telemetry.opentelemetry.io]
#     resources: [telemetry]
#     verbs: [export]
```

**How it works:** The extension rejects senders that lack the RBAC permission _before_ data enters the pipeline. Authorization is managed via standard K8s RBAC (familiar to cluster admins, auditable, no collector config changes needed to add/remove senders). Routing then maps the authenticated identity to the correct pipeline.

**Pros over Option A:** True authorization with rejection at the auth layer (not silent drop). Managed via K8s RBAC — adding a sender is a RoleBinding, not a collector config change. Auditable via K8s audit logs.

**Cons:** Coarse-grained — SAR checks a single resource/verb, not per-destination policies. The routing table still needs to map identity → pipeline. Adds a synchronous API call per request (cacheable).

#### Recommendation

**Option B** (SAR-based authorization) is preferable if the `k8ssaauthextension` is adopted, since it provides true rejection and uses standard K8s RBAC. **Option A** (routing connector) is the fallback and works today without new components. Both can coexist: SAR gates entry, routing directs traffic.

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
- Senders must project their SA token with the `otel-gateway` audience via a `serviceAccountToken` volume.
- The collector's service account needs a ClusterRole with `create` on `tokenreviews` in `authentication.k8s.io`.

## RHOAI Use Case Mapping

The RHOAI use case (RHAIRFE-3630, RHAISTRAT-2925) wants identity-based OTel trace routing from MaaS endpoints to MLflow experiments. How OBSDA-1512 capabilities map:

| RHOAI Need | OBSDA-1512 Mechanism |
|---|---|
| Identify calling agent/service | K8s SA token authentication (Approach 1) |
| Route traces to per-experiment MLflow | Routing connector with identity-based OTTL conditions |
| Prevent cross-tenant trace writes | Implicit authorization via routing (Approach 2A) |
| Correlate agent traces with MaaS traces | Verified identity stamped into resource attributes, forwarded via headers |

**RHOAI-specific gaps beyond OBSDA-1512:**
- MLflow experiment targeting requires a custom exporter or OTLP-to-MLflow bridge — this is out of scope for the collector and is an RHOAI/odh-observability concern.
- The RHAISTRAT-2925 strategy's `TraceRoutingRule` CRD is an RHOAI-specific abstraction, not a collector/operator feature. OBSDA-1512 provides the underlying collector primitives that such a CRD would configure.

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

5. **TokenReview caching strategy.** TokenReview is a synchronous API call. What cache TTL is appropriate? Should it match the token's remaining validity? What is the expected QPS and can the K8s API server handle it?

## Constraints

1. All approaches must work with the upstream OpenTelemetry Collector — no proprietary forks.
2. New components should be contributed upstream to opentelemetry-collector-contrib, not maintained only in the Red Hat distro.
3. The solution must work for OTLP over both gRPC and HTTP protocols.
4. SA token projection requires sender-side pod spec changes (`serviceAccountToken` volume with audience) — this is a deployment requirement, not a collector change.
