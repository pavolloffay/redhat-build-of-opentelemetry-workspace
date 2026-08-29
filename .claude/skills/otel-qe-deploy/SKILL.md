---
name: otel-qe-deploy
description: Installs the operators and example setups of Tempo and OTEL. Use when the user asks to deploy or set up Tempo and OpenTelemetry on a cluster for QE testing.
---

# Prepare Cluster

## Step 0: Get a cluster
If not already connected to an OpenShift cluster, use the `/otel-qe-prepare-cluster` skill to provision one.

## Step 1: Apply ImageDigestMirrorSet manifests
Apply the `ImageDigestMirrorSet` manifests so the cluster can pull Konflux-built images:

```
kubectl apply -f https://raw.githubusercontent.com/os-observability/konflux-tempo/refs/heads/main/.tekton/images-mirror-set.yaml
kubectl apply -f https://raw.githubusercontent.com/os-observability/konflux-opentelemetry/refs/heads/main/.tekton/images-mirror-set.yaml
```

## Step 2: Install operators

### Variant A: FBC fragment install (amd64 only)

This method uses FBC (File-Based Catalog) fragments and only works on `amd64` clusters.

Search `konflux-opentelemetry` repository to find the release payload (FBC fragments or OLM bundle).

**Before applying**, replace the `spec.image` field in all `CatalogSource` resources with the FBC fragment image from the Konflux repo:
- In [`install-operators/tempo.yaml`](install-operators/tempo.yaml): replace the CatalogSource `spec.image` with the Tempo FBC fragment image
- In [`install-operators/otel.yaml`](install-operators/otel.yaml): replace the CatalogSource `spec.image` with the OTEL FBC fragment image

Use `sed` or similar to modify the manifests in a temporary copy before applying. Do not modify the original files.

Apply all manifests from the `install-operators/` folder (relative to this skill) in alphabetical order using `oc apply -f`.

### Variant B: OLM bundle install (IBM P and Z)

This method uses OLM bundles directly and must be used on IBM P and Z clusters. Get the bundle images from the stage release payload files in `konflux/release-payloads/`: look for the `containerImage` of the `tempo-bundle-main` component in `tempo-stage-<version>.yaml` and the `opentelemetry-bundle` component in `otel-stage-<version>.yaml`.

```bash
kubectl create namespace openshift-tempo-operator
operator-sdk run bundle <TEMPO_BUNDLE_IMAGE> --namespace openshift-tempo-operator

kubectl create namespace opentelemetry-operator-system
operator-sdk run bundle <OTEL_BUNDLE_IMAGE> --namespace opentelemetry-operator-system
```

Apply [`install-operators/coo.yaml`](install-operators/coo.yaml) using `oc apply -f`.

## Step 3: Install extra operators

Ask the user if they want to deploy the following extra operators:
- **AMQ Streams** (Kafka) — used as a backend/transport for OpenTelemetry pipelines
- **Loki** — log aggregation backend, used with OpenTelemetry log collection

Apply the respective manifest from the `install-operators-extra/` folder (relative to this skill) using `oc apply -f`. Wait for the operator(s) to be ready before proceeding.

## Step 4: Deploy example instance

Ask the user if they want to deploy the example instance. If yes, apply all manifests from the `example-instance/` folder (relative to this skill) in alphabetical order using `oc apply -f`.
