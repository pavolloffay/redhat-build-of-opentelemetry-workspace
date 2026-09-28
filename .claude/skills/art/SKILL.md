---
name: art
description: >
  Reference skill for the ART (Automated Release Tool) build and productization
  process for Red Hat build of OpenTelemetry. Use when the user asks about ART
  builds, Konflux pipelines, release configuration, image locations, or needs
  help navigating the ART/Konflux ecosystem.
argument-hint: "[question about ART/Konflux builds or configuration]"
---

# ART Build & Productization Reference

Answer questions about the ART build and productization process for Red Hat build of OpenTelemetry using the reference information below. When asked about a topic, provide the relevant links and context. When asked to perform an action (e.g. check a build, find a configuration), use the links below to guide the user or fetch information directly.

## Downstream Repositories

The downstream repositories contain downstream modifications and are built from branches e.g. `rhosdt-3.11`.

| Repository | URL |
|------------|-----|
| opentelemetry-operator | https://github.com/openshift/open-telemetry-opentelemetry-operator |
| redhat-opentelemetry-collector | https://github.com/os-observability/redhat-opentelemetry-collector |

## ART & Konflux Dashboards

| Dashboard | URL |
|-----------|-----|
| Konflux UI | https://konflux-ui.apps.kflux-ocp-p01.7ayg.p1.openshiftapps.com/ns/art-rhosdt-tenant/applications |
| OpenShift UI (pipeline runs) | https://console-openshift-console.apps.kflux-ocp-p01.7ayg.p1.openshiftapps.com/pipelines/ns/art-rhosdt-tenant/pipeline-runs |
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
| ocp-build-data | https://github.com/openshift-eng/ocp-build-data/tree/rhosdt-3.11 | `main` branch has config examples. PRs must be approved by ART team. |
| ART product maps | https://github.com/openshift-eng/art-tools/blob/main/artcommon/artcommonlib/constants.py | |
| openshift-priv whitelist | https://github.com/openshift/release/blob/main/core-services/openshift-priv/_whitelist.yaml | Repositories for embargoed CVEs |
| Product pages / lifecycle | https://redhat.atlassian.net/servicedesk/customer/portal/238 | Service desk to request updates |
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
| @chai-bot (can submit config PRs and answer questions) | https://redhat.enterprise.slack.com/archives/D0BEVMQ11DH |
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
