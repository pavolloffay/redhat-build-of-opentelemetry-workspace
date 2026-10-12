# Release

ART auto-releases component images to stage registry (not FBC fragments). 
However, the production release process runs the stage release again to ensure all Konflux checks still pass.

The release is documented in https://art-docs.engineering.redhat.com/konflux/self-service-fbc-release/
and requires running Tekton pipelines: `release-from-fbc` and `trigger-prod-release`.

The pipelines can be run from:
* [ARC OpenShift](https://console-openshift-console.apps.artc2023.pc3z.p1.openshiftapps.com/k8s/ns/art-rhosdt-tenant/tekton.dev~v1~Pipeline)
* [ART pipelines](https://art-pipelines-ui-art-pipelines-ui.apps.artc2023.pc3z.p1.openshiftapps.com/#/pipelines). This UI allows customizing parameters for re-rerun.

## Run `release-from-fbc` pipeline
Create the [pipeline CR](./release-from-fbc.yaml), replacing:
* `<GROUP>` — e.g. `rhosdt-0.158` (the ocp-build-data group branch)
* `<ASSEMBLY_VERSION>` — e.g. `0.158.0`
* `<FBC_PULLSPECS>` — comma-separated FBC pullspecs from [get-fbc-images.sh](./get-fbc-images.sh)
* `force` — `false` (default). Use `true` only when you want to override the existing shipment merge request.
* `dry-run` — `false` (default). Set to `false` to actually create the shipment MR.

The pipeline creates a shipment merge request in [hybrid-platforms/art/ocp-shipment-data](https://gitlab.cee.redhat.com/hybrid-platforms/art/ocp-shipment-data/) (e.g. https://gitlab.cee.redhat.com/hybrid-platforms/art/ocp-shipment-data/-/merge_requests/973),
mark it ready, and trigger a GitLab CI pipeline on the MR. That CI pipeline runs one `build-fbc` pipeline for every supported OpenShift version and one `build-layered-products` pipeline.
Both are Tekton pipelines defined in [art-tools](https://github.com/openshift-eng/art-tools) under `art-cluster/pipelines/config/argocd/project/art-rhosdt-tenant/`:
* `build-layered-products` — rebases and builds the RHOSDT operator/component images via Konflux (default: `openshift-opentelemetry-operator`), then triggers a downstream bundle build.
* `build-fbc` — builds the File-Based Catalog (FBC) fragment image for a given OCP version, making the operator installable via OLM on that cluster version.

Review the MR (e.g. the release notes) and approve it.

## Run `trigger-prod-release` pipeline
Run `trigger-prod-release` pipeline to continue the release to production registry.
The pipeline takes argument the merge request from the previous step to [hybrid-platforms/art/ocp-shipment-data](https://gitlab.cee.redhat.com/hybrid-platforms/art/ocp-shipment-data/).

Create the [pipeline CR](./trigger-prod-release.yaml), replacing:
* `<MR_IID>` — the merge request ID from the previous step (e.g. `742`)
* `dry-run` — `true` (default). Set to `false` to actually trigger the prod release.

The pipeline enables release to production registry on Gitlab MR pipeline. If the  Gitlab MR pipeline fails (or partly fails) just re-rerun the `trigger-prod-release`
and the unreleased FBCs will re-run.

## Prepare for next release
1. Operator CSV version in `bundle/opentelemetry-product.package.yaml` on the `rhosdt-<version>` branch
1. Bundle CSV modifications (`version`, `replaces`, `name`) in `bundle/art.yaml`

### New major/minor version
1. Request new branches in `ocp-build-data` from the ART team
1. Update version in `ocp-build-data`  in `group.yml` on the `rhosdt-<version>` branch (only for new minor version)
1. Create downstream branches - copy ART configuration `bundle`/[`art.yaml`, `image-references`, `opentelemetry-product.package.yaml`] with `Dockerfile.art` and `renovate.json`.
1. Update versions in the ART configuration files in `bundle`
1. Create pre-merge OCP CI jobs on the release branch to verify payload pass end-to-end tests
1. Configure mintmaker for new downstream branches in `konflux-release-data`
