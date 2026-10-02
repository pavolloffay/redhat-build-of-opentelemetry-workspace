---
name: otel-art-reference
description: >
  Reference skill for ART (Automated Release Tool) build and productization of
  Red Hat build of OpenTelemetry. Use when the user asks about ART builds, ART
  Konflux tenant configuration, image locations in ART pipelines, or release
  promotion. Not for the legacy os-observability Konflux flow — see
  otel-qe-deploy-stage-build, otel-qe-prepare-konflux-tests, and
  otel-qe-ocp-ci-tests for those.
argument-hint: "[question about ART/Konflux builds or configuration]"
---

# ART Build & Productization Reference

Answer questions about the ART build and productization process for Red Hat build of OpenTelemetry using the reference information below. When asked about a topic, provide the relevant links and context. When asked to perform an action (e.g. check a build, find a configuration), use the links below to guide the user or fetch information directly.

## Downstream Repositories

The downstream repositories contain downstream modifications and are built from `rhosdt-<version>` branches (e.g. `rhosdt-3.11`).

| Repository | URL |
|------------|-----|
| opentelemetry-operator | https://github.com/openshift/open-telemetry-opentelemetry-operator |
| redhat-opentelemetry-collector | https://github.com/os-observability/redhat-opentelemetry-collector |

## ART & Konflux Dashboards

| Dashboard | URL |
|-----------|-----|
| Konflux UI | https://konflux-ui.apps.kflux-ocp-p01.7ayg.p1.openshiftapps.com/ns/art-rhosdt-tenant/applications |
| OpenShift UI (Konflux components) | https://console-openshift-console.apps.kflux-ocp-p01.7ayg.p1.openshiftapps.com/pipelines/ns/art-rhosdt-tenant/pipeline-runs |
| OpenShift UI (ART run release pipeline) | https://console-openshift-console.apps.artc2023.pc3z.p1.openshiftapps.com/pipelines/ns/art-rhosdt-tenant/ |
| ART build history | https://art-build-history-art-build-history.apps.artc2023.pc3z.p1.openshiftapps.com/?group=rhosdt-3.11&assembly=stream&outcome=Success&outcome=Failure&outcome=Pending&engine=konflux&hermetic=both&buildtype=image&buildtype=bundle&buildtype=fbc |
| Browse images (Quay) | https://quay.io/repository/redhat-user-workloads/ocp-art-tenant/art-fbc?tab=tags (filter `rhosdt`) |

Following script can be used to list all images:
```bash
page=1; while true; do result=$(curl -s "https://quay.io/api/v1/repository/redhat-user-workloads/ocp-art-tenant/art-fbc/tag/?filter_tag_name=like:rhosdt&limit=100&page=$page"); echo "$result" | python3 -c "import sys,json; [print(t['name']) for t in json.load(sys.stdin).get('tags',[])]"; has_more=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('has_additional',False))"); [ "$has_more" = "False" ] && break; page=$((page+1)); done
```

## Configuration

| Config | URL | Notes |
|--------|-----|-------|
| Application & ReleasePlan | https://gitlab.cee.redhat.com/releng/konflux-release-data/-/tree/main/tenants-config/cluster/kflux-ocp-p01/tenants/art-rhosdt-tenant?ref_type=heads | |
| ReleasePlanAdmission (RPA) | https://gitlab.cee.redhat.com/releng/konflux-release-data/-/tree/main/config/kflux-ocp-p01.7ayg.p1/product/ReleasePlanAdmission/art-rhosdt?ref_type=heads | |
| RPA Constraint | https://gitlab.cee.redhat.com/releng/konflux-release-data/-/blob/main/constraints/product/art-rhosdt.yaml?ref_type=heads | |
| Enterprise Contract | https://gitlab.cee.redhat.com/releng/konflux-release-data/-/tree/main/config/kflux-ocp-p01.7ayg.p1/product/EnterpriseContractPolicy?ref_type=heads | |
| Prodsec / CPE | https://gitlab.cee.redhat.com/releng/konflux-release-data/-/blob/main/prodsec/art-rhosdt.yaml?ref_type=heads | |
| ocp-build-data | https://github.com/openshift-eng/ocp-build-data | `main` has config examples only. Product config is on `rhosdt-<version>` branches — checkout the target version after cloning. PRs must be approved by ART team. |
| ART product maps | https://github.com/openshift-eng/art-tools/blob/main/artcommon/artcommonlib/constants.py | |
| openshift-priv whitelist | https://github.com/openshift/release/blob/main/core-services/openshift-priv/_whitelist.yaml | Repositories for embargoed CVEs |
| Product pages / lifecycle | https://redhat.atlassian.net/servicedesk/customer/portal/238 | Service desk to request updates |
| Configure Github apps/repositories | https://devservices.dpp.openshift.com/support/general_request/?template=general_github_ticket | Enable [Konflux app](https://github.com/apps/konflux-kflux-ocp-p01), ask in [#forum-pge-cloud-ops](https://redhat.enterprise.slack.com/archives/CBUT43E94)  |
| Prodsec product definitions | https://gitlab.cee.redhat.com/prodsec/product-definitions/-/tree/master?ref_type=heads | Sources data from product and lifecycle pages |

Advisories:
* [Konflux stage advisories](https://gitlab.cee.redhat.com/rhtap-release/advisories/-/tree/main/data/advisories/art-rhosdt-tenant)
* [Konflux prod advisories](https://gitlab.cee.redhat.com/releng/advisories/-/blob/main/data/advisories/art-rhosdt-tenant)

## Documentation

| Resource | URL |
|----------|-----|
| ART docs | https://art-docs.engineering.redhat.com/ |
| Konflux upstream docs | https://konflux-ci.dev/docs/ |
| Konflux downstream docs | https://konflux.pages.redhat.com/docs/users/index.html |
| Konflux architecture / API | https://github.com/konflux-ci/architecture |

## Contacts & Help Channels

| Channel | Contact |
|---------|---------|
| chai-bot — DM this Slack bot to submit config PRs and ask questions | `@chai-bot` in Slack |
| ART questions (#forum-ocp-art) | https://redhat.enterprise.slack.com/archives/CB95J6R4N |
| Konflux general (#konflux-users) | https://redhat.enterprise.slack.com/archives/C04PZ7H0VA8 |
| Release (#forum-konflux-release) | https://redhat.enterprise.slack.com/archives/C031USXS2FJ |
| Enterprise contract (#forum-konflux-contract) | https://redhat.enterprise.slack.com/archives/C031J4KBFME |
| File based catalog (#forum-fbc-support) | https://redhat.enterprise.slack.com/archives/C074JM28DTP |

## Tooling & Repositories

| Tool | URL | Notes |
|------|-----|-------|
| ART tooling (Doozer, ocp-build-data JSON schemas) | https://github.com/openshift-eng/art-tools | JSON schemas at `ocp-build-data-validator/validator/json_schemas` |
| Enterprise contract definition | https://github.com/release-engineering/rhtap-ec-policy | |
| Konflux build definitions (pipelines, tasks) | https://github.com/konflux-ci/build-definitions | |
| Konflux release pipeline | https://github.com/konflux-ci/release-service-catalog | |
| Prefetch dependencies (cachi2) | https://github.com/containerbuildsystem/cachi2 | |
| Renovate / MintMaker config | https://github.com/konflux-ci/mintmaker/blob/main/config/renovate/renovate.json | Docs: https://docs.renovatebot.com/ |

## Release Process

See [RELEASE.md](RELEASE.md) for the release process (draft — will be completed after the first ART release), including stage/prod promotion and version update steps.

## Test builds

Once the FBC builds are ready (e.g. `quay.io/redhat-user-workloads/ocp-art-tenant/art-fbc`) the operator can be deployed and tested.

Use [catalog-source.yaml](catalog-source.yaml) as a template for creating a CatalogSource — replace the `image` field with the actual FBC image tag from the Quay repository above (e.g. `quay.io/redhat-user-workloads/ocp-art-tenant/art-fbc:<tag>`). The `otel-qe-deploy-stage-build` skill's `install-operators/otel.yaml` has a more complete example that also includes the Project, OperatorGroup, and Subscription.

Use [idms.yaml](idms.yaml) to mirror images from the production registry to the stage registry. Note:
- This IDMS maps the entire `registry.redhat.io/rhosdt` prefix to `registry.stage.redhat.io/rhosdt`. If the cluster also has the more specific per-image IDMS from `otel-qe-deploy-stage-build` (which maps to `quay.io/redhat-user-workloads/...`), the more specific entries take precedence — remove one or the other to avoid confusion about which build is under test.
- `registry.stage.redhat.io` requires authentication. Add stage credentials to the cluster's global pull secret before applying this IDMS.
