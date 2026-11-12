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
| A K8s TokenReview auth extension is the proper solution | TokenReview works on all OpenShift variants, handles key rotation transparently, returns structured identity (namespace, SA name, groups). An external implementation exists ([Jamstah/k8ssaauthextension](https://github.com/Jamstah/k8ssaauthextension)) but is early-stage. No issue or PR in `opentelemetry-collector-contrib` requests this component yet. |
| Authorization is a static routing table (identity → allowed destinations), not SubjectAccessReview | The tickets describe a mapping model: admin configures which senders may write where. The routing connector provides this via OTTL conditions on auth attributes. SAR-based authorization (via the Jamstah extension) is an alternative that uses K8s RBAC. |
| kube-rbac-proxy sidecar is a viable interim solution | It validates SA tokens via TokenReview, forwards identity as `x-remote-user` / `x-remote-groups` headers (requires `--auth-header-fields-enabled=true`). The collector reads them via `include_metadata: true`. Requires binding the receiver to localhost + NetworkPolicy to prevent header spoofing. Supports both HTTP and gRPC (`--upstream-force-h2c`). |
| Headers setter extension is already in the Red Hat distro | Present in the manifest (`headerssetterextension v0.158.0`) but undocumented. Required for forwarding identity to multi-tenant backends (e.g., `X-Scope-OrgID`). |

## Existing Collector Capabilities

The collector already has the building blocks for identity-aware ingestion:

- **OIDC auth extension** (TP): validates JWT tokens, exposes `subject`, `membership`, and arbitrary claims as auth attributes via `client.Info.Auth`.
- **Resource/attributes processors**: stamp verified identity into resource attributes via `from_context: "auth.<name>"` (confirmed in `internal/coreinternal/attraction/attraction.go`, `authPrefix = "auth."`).
- **Routing connector** (TP): routes on `otelcol.client.auth.attributes["key"]` — identity-based routing without stamping attributes first (documented in `pkg/ottl/contexts/ottlotelcol/README.md`).
- **Headers setter extension** (in distro, undocumented): sets outbound headers like `X-Scope-OrgID` for multi-tenant backends via `from_context`.
- **Context lifecycle**: `client.Info` (including auth data) is per-request context lost at the batch processor boundary. Identity must be stamped into resource attributes _before_ batching.

## Authentication Approaches for K8s SA Tokens

### Option A: OIDC Extension — Does Not Work on OpenShift

The OIDC discovery endpoint requires authentication (HTTP 401). Additional complications: issuer URL varies by cluster type, CA cert pool is exclusive (no system roots), audience must be explicitly projected. The `public_keys_file` workaround bypasses discovery but needs a JWKS distribution mechanism.

### Option B1: K8s SA Auth Extension — TokenReview Only

A dedicated extension performing only TokenReview: validates the bearer token, extracts identity (namespace, SA name, groups), exposes them as auth attributes. Authorization handled by the routing connector (see below).

**Pros:** Simple, one API call, easy to cache, clean separation of authentication and authorization.
**Cons:** Authorization is implicit (route or drop). Adding tenants requires collector config changes.

### Option B2: K8s SA Auth Extension — TokenReview + SubjectAccessReview

The [Jamstah/k8ssaauthextension](https://github.com/Jamstah/k8ssaauthextension) implements two-step auth: TokenReview + SAR. Authorization managed via standard K8s RBAC (Roles/ClusterRoles granting e.g. `verb: export` on `resource: telemetry`). Senders without the binding are rejected before data enters the pipeline.

**Pros:** True rejection with error to sender. K8s RBAC-based authorization. Adding a sender is a RoleBinding, not a config change.
**Cons:** Early-stage (6 commits, development stability, not proposed upstream). No caching. Auth attributes not documented. SAR is coarse-grained (single resource/verb, not per-destination).

### Option C: kube-rbac-proxy Sidecar (Interim)

kube-rbac-proxy validates SA tokens via TokenReview/SAR, forwards identity as `x-remote-user` / `x-remote-groups` headers. Collector reads via `include_metadata: true`, routes on `otelcol.client.metadata["x-remote-user"]`.

**Pros:** Well-established OpenShift pattern. No collector code changes. Works for HTTP and gRPC.
**Cons:** Headers are untrusted metadata — requires localhost-binding + NetworkPolicy. Adds a sidecar.

### Recommendation

**Option B1** (TokenReview-only) is the simplest path. **Option B2** (TokenReview + SAR) adds K8s RBAC authorization — worth evaluating. **Option C** (kube-rbac-proxy) is the interim solution. **Option A** (OIDC) does not work on OpenShift.

## Authorization Approaches

### Option A: Implicit Authorization via Routing Connector

The routing connector's OTTL conditions act as an implicit authorization layer. Each rule maps identity → pipeline. Unmatched senders go to `default_pipelines` (reject pipeline). Static routing table — acceptable for the expected tenant counts.

### Option B: K8s RBAC via SubjectAccessReview

The Jamstah extension's SAR step rejects unauthorized senders at the auth layer. Authorization managed via K8s Roles/ClusterRoles. Both can coexist: SAR gates entry, routing directs traffic.

## RHOAI Use Case

| RHOAI Need | Collector Mechanism |
|---|---|
| Identify calling agent/service | K8s SA token authentication |
| Route traces to per-experiment MLflow | Routing connector with identity-based OTTL conditions |
| Prevent cross-tenant trace writes | Implicit authorization via routing |
| Correlate agent traces with MaaS traces | Verified identity stamped into resource attributes, forwarded via headers |

RHOAI-specific gaps: MLflow experiment targeting needs a custom exporter or OTLP-to-MLflow bridge (out of scope for the collector). The `TraceRoutingRule` CRD in RHAISTRAT-2925 is an RHOAI-specific abstraction over the collector's routing primitives.

## Components Needed

| Component | In Distro? | Required For |
|---|---|---|
| K8s SA Auth Extension | **No** — exists externally ([Jamstah](https://github.com/Jamstah/k8ssaauthextension)), not in contrib | Sender auth on OpenShift |
| OIDC Auth Extension | Yes (TP) | Auth for JWT-bearing (non-K8s) senders |
| Routing Connector | Yes (TP) | Identity-based routing |
| Resource Processor | Yes (GA) | Stamping verified identity |
| Headers Setter Extension | Yes (undocumented) | Forwarding identity to backends |

**Action required:** Evaluate and improve the Jamstah extension (caching, auth attribute exposure), then propose for `opentelemetry-collector-contrib`. Document the headers setter extension.

## Risks

1. **K8s SA auth extension is early-stage.** Needs caching, documented auth attributes. kube-rbac-proxy sidecar is the interim.
2. **OIDC extension does not work for K8s SA tokens on OpenShift.** Discovery endpoint needs auth (401), issuer URL varies.
3. **Context loss at batch processor boundary.** Auth context silently lost if batch is placed before identity stamping.
4. **No error signaling to senders.** Implicit authorization (routing connector) returns success even when data is dropped.
5. **Routing connector and OIDC extension are both TP.** Product implications for support level.

## Open Questions

1. **Upstream path for `k8ssaauthextension`?** Collaborate with the author (James Hewitt, IBM) and propose for contrib? Related upstream discussion: [#48895](https://github.com/open-telemetry/opentelemetry-collector-contrib/issues/48895).
2. **What support level for identity-aware ingestion?** OIDC and routing connector are both TP. GA requires promotion.
3. **Interaction with signing spec (TRACING-6499)?** Signing proves origin, auth proves submission rights. Complementary — should they share identity primitives?
4. **TokenReview caching strategy.** Cache TTL, expected QPS, K8s API server load.

## References

- Full research spec: `.ai/spec/what/identity-aware-ingestion.md`
- Jamstah extension: [github.com/Jamstah/k8ssaauthextension](https://github.com/Jamstah/k8ssaauthextension)
- Upstream multi-tenant discussion: [opentelemetry-collector-contrib#48895](https://github.com/open-telemetry/opentelemetry-collector-contrib/issues/48895)
- Core collector K8s SA auth issue (closed, client-side): [opentelemetry-collector#6987](https://github.com/open-telemetry/opentelemetry-collector/issues/6987)
- OTTL otelcol context auth attributes: `opentelemetry-collector-contrib/pkg/ottl/contexts/ottlotelcol/README.md`
