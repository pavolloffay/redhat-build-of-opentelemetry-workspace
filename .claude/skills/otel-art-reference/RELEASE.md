# Release

ART auto-releases component images to stage registry (not FBC fragments).
However, the production release process runs the stage release again to ensure all Konflux checks still pass.

The release is documented in https://art-docs.engineering.redhat.com/konflux/self-service-fbc-release/
and requires running Tekton pipelines: `release-from-fbc` and `trigger-prod-release`.

The pipelines can be run from:
* [ARC OpenShift](https://console-openshift-console.apps.artc2023.pc3z.p1.openshiftapps.com/k8s/ns/art-rhosdt-tenant/tekton.dev~v1~Pipeline)
* [ART pipelines](https://art-pipelines-ui-art-pipelines-ui.apps.artc2023.pc3z.p1.openshiftapps.com/#/pipelines). This UI allows customizing parameters for rerun.

## Run `release-from-fbc` pipeline
Create the [pipeline CR](./release-from-fbc.yaml), replacing:
* `<GROUP>` — e.g. `rhosdt-0.158` (the ocp-build-data group branch)
* `<ASSEMBLY_VERSION>` — e.g. `0.158.0`
* `<FBC_PULLSPECS>` — comma-separated FBC pullspecs from [get-fbc-images.sh](./get-fbc-images.sh)
* `jira-bugs` — comma-separated list of JIRA issue IDs to include in the advisory. CVE trackers need correct component label e.g. `pscomponent:rhosdt/opentelemetry-rhel9-operator`
* `force` — the template sets `false`. Set to `true` to override the existing shipment merge request.
* `dry-run` — the template sets `true`. Set to `false` to actually create the shipment MR.

The pipeline creates a shipment merge request in [hybrid-platforms/art/ocp-shipment-data](https://gitlab.cee.redhat.com/hybrid-platforms/art/ocp-shipment-data/) (e.g. https://gitlab.cee.redhat.com/hybrid-platforms/art/ocp-shipment-data/-/merge_requests/973), and triggers a GitLab CI pipeline on the MR. The pipeline releases the images to stage again to make sure Conforma checks pass.

Review the MR (e.g. the release notes) and approve it.

## Run `trigger-prod-release` pipeline
Run `trigger-prod-release` pipeline to continue the release to production registry.
The pipeline takes argument the merge request from the previous step to [hybrid-platforms/art/ocp-shipment-data](https://gitlab.cee.redhat.com/hybrid-platforms/art/ocp-shipment-data/).

Create the [pipeline CR](./trigger-prod-release.yaml), replacing:
* `<MR_IID>` — the merge request ID from the previous step (e.g. `742`)
* `dry-run` — `true` (default). Set to `false` to actually trigger the prod release.

The pipeline enables release to production registry on Gitlab MR pipeline. If the Gitlab MR pipeline fails (or partly fails) just rerun the `trigger-prod-release`
and the unreleased FBCs will rerun.

## Prepare for next release
1. Operator CSV version in `bundle/opentelemetry-product.package.yaml` on the `rhosdt-<version>` branch
1. Bundle CSV modifications (`version`, `replaces`, `name`) in `bundle/art.yaml`

### New major/minor version
1. Request new branches in `ocp-build-data` from the ART team
1. Update version in `ocp-build-data`  in `group.yml` on the `rhosdt-<version>` branch (only for new minor version)
1. Create downstream branches - copy ART configuration `bundle`/[`art.yaml`, `image-references`, `opentelemetry-product.package.yaml`] with `Dockerfile.art` and `renovate.json`.
1. Update versions in the ART configuration files in `bundle`
1. Create pre-merge OCP CI jobs on the release branch to verify payload pass end-to-end tests (see `otel-qe-prepare-ci` skill — only needed for new major/minor versions; patch releases use existing CI config)
1. Configure mintmaker for new downstream branches in `konflux-release-data`
