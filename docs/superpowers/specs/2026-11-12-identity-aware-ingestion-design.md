# Identity-Aware Authentication and Authorization for Telemetry Ingestion

**Date:** 2026-11-12
**Ticket:** [OBSDA-1512](https://redhat.atlassian.net/browse/OBSDA-1512); related: [RHAIRFE-3630](https://redhat.atlassian.net/browse/RHAIRFE-3630) (RHOAI trace routing RFE), [RHAISTRAT-2925](https://redhat.atlassian.net/browse/RHAISTRAT-2925) (RHOAI strategy draft)
**Status:** Research — documenting how the OTEL collector could support identity-aware auth and multi-tenant routing. No implementation yet.

## Summary

Organizations deploying the collector as a shared telemetry gateway need sender authentication (verify _who_), per-destination authorization (enforce _what_ they may write to), identity binding (replace self-declared identity with verified identity), and identity forwarding (carry verified identity to backends). The RHOAI AI agent platform is one motivating use case: agents send traces to a shared collector, which must route them to the correct MLflow experiment based on verified caller identity.

## Decisions

| Decision | Rationale |
|---|---|
| OIDC auth extension does not work for K8s SA tokens on OpenShift | The OIDC discovery endpoint (`/.well-known/openid-configuration`) on the K8s API server requires authentication; the extension's plain HTTP client gets 401. The issuer URL also varies by cluster type (standard, AWS STS, Azure WIF ARO). The `public_keys_file` workaround exists but is fragile. |
| A K8s TokenReview auth extension is the proper solution | TokenReview works on all OpenShift variants, handles key rotation transparently, returns structured identity (namespace, SA name, groups). An external implementation exists ([Jamstah/k8ssaauthextension](https://github.com/Jamstah/k8ssaauthextension)) but is early-stage, sets no `client.Info.Auth` (its `Authenticate` returns the context unchanged — identity exposure is new work), and its SubjectAccessReview step is mandatory (`resource_attributes` is required — a TokenReview-only variant is also new work). No issue or PR in `opentelemetry-collector-contrib` requests this component yet; contrib v0.163.0 and main have no Kubernetes token auth extension. |
| Authorization: explicit SubjectAccessReview preferred, routing connector as fallback | The K8s SA auth extension's SAR step rejects unauthorized senders with an error before data enters the pipeline, managed via standard K8s RBAC. The routing connector provides implicit authorization (route or drop) and works today without new components; both can coexist — SAR gates entry, routing directs traffic. |
| kube-rbac-proxy sidecar is a viable interim solution | It validates SA tokens via TokenReview, forwards identity as `x-remote-user` / `x-remote-groups` headers (requires `--auth-header-fields-enabled=true`). The collector reads them via `include_metadata: true`. Requires binding the receiver to localhost + NetworkPolicy to prevent header spoofing. Supports both HTTP and gRPC (`--upstream-force-h2c`). |
| Headers setter extension is already in the Red Hat distro | Technology Preview since 3.11 (docs module in review, TRACING-6505); the 3.12 build ships v0.163.0. Required for forwarding identity to multi-tenant backends (e.g., `X-Scope-OrgID`) and token passthrough. |

## Existing Collector Capabilities

The collector already has the building blocks for identity-aware ingestion:

- **OIDC auth extension** (TP): validates JWT tokens, exposes `subject`, `membership`, and arbitrary claims as auth attributes via `client.Info.Auth`.
- **Resource/attributes processors**: stamp verified identity into resource attributes via `from_context: "auth.<name>"` (confirmed in `internal/coreinternal/attraction/attraction.go`, `authPrefix = "auth."`).
- **Routing connector** (TP): routes on `otelcol.client.auth.attributes["key"]` — identity-based routing without stamping attributes first (documented in `pkg/ottl/contexts/ottlotelcol/README.md`).
- **Headers setter extension** (TP since 3.11): sets outbound headers like `X-Scope-OrgID` for multi-tenant backends via static per-pipeline values (never `from_context` for tenant identifiers — sender-controlled), and passes through the raw `Authorization` header via `from_context` for token passthrough.
- **Context lifecycle**: `client.Info` (including auth data) is per-request context lost at the batch processor boundary. Identity must be stamped into resource attributes _before_ batching, and the headers setter's `from_attribute` must not be used with a batched exporter — it panics (nil `Auth` after a batch merge, no nil check in `AttributeSource.Get`).

## Authentication Approaches for K8s SA Tokens

### Option A: OIDC Extension — Does Not Work on OpenShift

The OIDC discovery endpoint requires authentication (HTTP 401). Additional complications: issuer URL varies by cluster type, CA cert pool is exclusive (no system roots), audience must be explicitly projected. The `public_keys_file` workaround bypasses discovery but needs a JWKS distribution mechanism.

### Option B: K8s SA Auth Extension (TokenReview)

A dedicated extension that validates the bearer token via TokenReview, extracts identity (namespace, SA name, groups), and exposes them as auth attributes. The [Jamstah/k8ssaauthextension](https://github.com/Jamstah/k8ssaauthextension) is the existing external implementation. Two caveats define the real scope:

- **It sets no `client.Info.Auth`** — `Authenticate` returns the context unchanged, so no identity reaches the pipeline. Exposing identity is new work.
- **Its SubjectAccessReview step is mandatory** — `resource_attributes` is a required setting, so the extension always performs TokenReview + SAR (authorization via K8s RBAC, Roles/ClusterRoles granting e.g. `verb: export` on `resource: telemetry`). A TokenReview-only variant does not exist and would also be new work.

**Pros:** True rejection with error to sender (via the SAR step). K8s RBAC-based authorization. Adding a sender is a RoleBinding, not a config change.
**Cons:** Early-stage (6 commits, development stability, not proposed upstream; contrib v0.163.0 and main have no Kubernetes token auth extension). No caching. Identity exposure and an optional-SAR mode are undeveloped. SAR is coarse-grained (single resource/verb, not per-destination).

### Option C: kube-rbac-proxy Sidecar (Interim)

kube-rbac-proxy validates SA tokens via TokenReview/SAR, forwards identity as `x-remote-user` / `x-remote-groups` headers. Collector reads via `include_metadata: true`, routes on `otelcol.client.metadata["x-remote-user"]`.

**Pros:** Well-established OpenShift pattern. No collector code changes. Works for HTTP and gRPC.
**Cons:** Headers are untrusted metadata — requires localhost-binding + NetworkPolicy. Adds a sidecar.

### Recommendation

**Option B** (TokenReview extension) is the target — but it is development work, not adoption of existing code: identity exposure via `client.Info.Auth` and an optional-SAR mode must be built. **Option C** (kube-rbac-proxy) is the interim solution. **Option A** (OIDC) does not work on OpenShift.

## Authorization Approaches

### Option A: Implicit Authorization via Routing Connector

The routing connector's OTTL conditions act as an implicit authorization layer. Each rule maps identity → pipeline. Unmatched senders go to `default_pipelines` (reject pipeline). Static routing table — acceptable for the expected tenant counts.

### Option B: K8s RBAC via SubjectAccessReview

The K8s SA auth extension's SAR step (mandatory in the Jamstah implementation) rejects unauthorized senders at the auth layer. Authorization managed via K8s Roles/ClusterRoles. Both can coexist: SAR gates entry, routing directs traffic.

## RHOAI Use Case

| RHOAI Need | Collector Mechanism |
|---|---|
| Identify calling agent/service | K8s SA token authentication |
| Route traces to per-namespace MLflow | Routing connector with identity-based OTTL conditions |
| Prevent cross-tenant trace writes | MLflow performs its own SelfSubjectAccessReview with the forwarded SA token |
| Correlate agent traces with MaaS traces | Verified identity stamped into resource attributes, forwarded via headers |

**RHOAI-specific notes:** Authorization is **per service account** — MLflow performs a `SelfSubjectAccessReview` checking the forwarded token against the `mlflow.kubeflow.org` pseudo-resources in the target workspace namespace ("namespace-level" isolation is the operational convention via RoleBindings, not a technical constraint). Each MLflow namespace contains multiple experiments, and the experiment is a passthrough header. MLflow exposes an OTLP/HTTP endpoint at `/v1/traces` (requires v3.7.0+; v3.6.0 has gzip and content-type bugs) — a standard `otlphttp` exporter works directly; the experiment is targeted via the `x-mlflow-experiment-id` header. The `TraceRoutingRule` CRD in RHAISTRAT-2925 is an RHOAI-specific abstraction over the collector's routing primitives. **Token passthrough is required** — MLflow needs the sender's SA token to perform its own SubjectAccessReview. The collector forwards the token via the headers setter extension's metadata passthrough (`from_context: authorization` with `include_metadata: true` on the receiver). Because MLflow presents the token to kube-apiserver, which only accepts tokens carrying its own audience, senders must use **default-audience** tokens and the collector must accept that audience — a collector-specific audience breaks MLflow's validation.

## Components Needed

| Component | In Distro? | Required For |
|---|---|---|
| K8s SA Auth Extension | **No** — exists externally ([Jamstah](https://github.com/Jamstah/k8ssaauthextension)), not in contrib | Sender auth on OpenShift |
| OIDC Auth Extension | Yes (TP) | Auth for JWT-bearing (non-K8s) senders |
| Routing Connector | Yes (TP) | Identity-based routing |
| Resource Processor | Yes (GA) | Stamping verified identity |
| Headers Setter Extension | Yes (TP since 3.11) | Forwarding identity to backends |

**Action required:** Build a K8s SA auth extension for `opentelemetry-collector-contrib` — the Jamstah extension is a starting point, but exposing identity via `client.Info.Auth` and making the SAR step optional are new development work, not improvements to existing behavior. Headers setter documentation is already in progress (TRACING-6505).

## Risks

1. **K8s SA auth extension is early-stage.** Beyond maturity (6 commits, not proposed upstream), it sets no `client.Info.Auth` and its SAR step is mandatory — both are new development work. No caching. kube-rbac-proxy sidecar is the interim.
2. **OIDC extension does not work for K8s SA tokens on OpenShift.** Discovery endpoint needs auth (401), issuer URL varies.
3. **Context loss at batch processor boundary.** Auth context silently lost if batch is placed before identity stamping — and the headers setter's `from_attribute` on a batched exporter panics the collector (nil `Auth` after a batch merge).
4. **No error signaling to senders.** Implicit authorization (routing connector) returns success even when data is dropped.
5. **Routing connector and OIDC extension are both TP.** Product implications for support level.
6. **Token passthrough forwards API-capable credentials through the shared collector.** Every sender's SA token transits the collector and is forwarded to the backend; a compromised collector/backend or eavesdropped connection can replay it. Mitigations: TLS on the collector→backend hop, short-lived bound SA tokens, minimally-scoped backend Roles.

## Open Questions

1. **Upstream path for `k8ssaauthextension`?** Collaborate with the author (James Hewitt, IBM) and propose for contrib? Related upstream discussion: [#48895](https://github.com/open-telemetry/opentelemetry-collector-contrib/issues/48895).
2. **What support level for identity-aware ingestion?** OIDC and routing connector are both TP. GA requires promotion.
3. **Interaction with signing spec (TRACING-6499)?** Signing proves origin, auth proves submission rights. Complementary — should they share identity primitives?
4. **TokenReview caching strategy.** The cache TTL should be configurable. The K8s ecosystem uses passive TTL-based expiration with no active revocation: kube-rbac-proxy defaults to 10s, kube-apiserver to 2 min (webhook token cache), with asymmetric caching (positive results longer, negative briefly). Recommendation: configurable TTL with a short default in the 10s–2 min range, asymmetric positive/negative caching, cache key as SHA-256 hash of the token.

## References

- Full research spec: `.ai/spec/what/identity-aware-ingestion.md`
- Jamstah extension: [github.com/Jamstah/k8ssaauthextension](https://github.com/Jamstah/k8ssaauthextension)
- Upstream multi-tenant discussion: [opentelemetry-collector-contrib#48895](https://github.com/open-telemetry/opentelemetry-collector-contrib/issues/48895)
- Core collector K8s SA auth issue (closed, client-side): [opentelemetry-collector#6987](https://github.com/open-telemetry/opentelemetry-collector/issues/6987)
- OTTL otelcol context auth attributes: `opentelemetry-collector-contrib/pkg/ottl/contexts/ottlotelcol/README.md`
