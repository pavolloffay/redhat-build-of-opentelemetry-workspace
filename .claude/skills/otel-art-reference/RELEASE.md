# Release

This is draft of release process. It will be finished after the first release.

Release to stage is done automatically and can be watched via Konflux: TODO add link.

Release to stage can be monitored via https://gitlab.cee.redhat.com/hybrid-platforms/art/ocp-shipment-data

Release to prod has to be done manually via https://art-docs.engineering.redhat.com/konflux/self-service-fbc-release/
TODO: Add CR which is created in the cluster.
TODO: add link to pipeline.

## Update versions after release
1. Version in `ocp-build-data` `group.yml` on the `rhosdt-<version>` branch
2. Operator CSV version in `bundle/opentelemetry-product.package.yaml` on the `rhosdt-<version>` branch
3. Bundle CSV modifications in `bundle/art.yaml`
4. Related images replacements in `bundle/image-references`

### New major/minor version
1. Create branches - copy ART configuration with `Dockerfile.art` and renovate config.
2. Create OCP CI jobs
