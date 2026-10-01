# Red Hat build of OpenTelemetry Workspace

Cross-repo workspace for Red Hat build of OpenTelemetry — shared specs, routing, and AI conventions.

## Repositories

| Repo                                                                                                 | Purpose                                                               |
|------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------|
| [opentelemetry-collector](https://github.com/open-telemetry/opentelemetry-collector)                 | Core collector                                                        |
| [opentelemetry-collector-contrib](https://github.com/open-telemetry/opentelemetry-collector-contrib) | Collector contrib with all components                                 |
| [redhat-opentelemetry-collector](https://github.com/os-observability/redhat-opentelemetry-collector) | Red Hat distribution of the collector                                 |
| [opentelemetry-operator](https://github.com/open-telemetry/opentelemetry-operator)                   | Kubernetes operator                                                   |
| [open-telemetry-opentelemetry-operator](https://github.com/openshift/open-telemetry-opentelemetry-operator) | Product/downstream fork of the operator, holds `rhosdt-x.y` branches used for QE product testing |
| [os-observability-opentelemetry-operator](https://github.com/os-observability/opentelemetry-operator) | Legacy Konflux fork of the operator (`rhosdt-3.7`–`3.11`), still used by `konflux-opentelemetry` submodules |
| [ocp-build-data](https://github.com/openshift-eng/ocp-build-data)                                   | ART configuration for product builds, uses `rhosdt-x.y` branches |
| [konflux-release-data](https://gitlab.cee.redhat.com/releng/konflux-release-data)                    | Konflux configuration repository in `tenants-config/cluster/kflux-ocp-p01/tenants/art-rhosdt-tenant` |
| [konflux-opentelemetry](https://github.com/os-observability/konflux-opentelemetry)                   | Downstream productization repository, contains all product components |
| [konflux](https://gitlab.cee.redhat.com/distributed-tracing/konflux)                                  | Konflux release documentation and release payloads                    |
| [openshift-docs](https://github.com/openshift/openshift-docs/tree/standalone-otel-docs-main)         | Documentation for the Red Hat build of OpenTelemetry                  |
| [distributed-tracing-console-plugin](https://github.com/openshift/distributed-tracing-console-plugin) | OpenShift console plugin for distributed tracing                      |
| [logging-view-plugin](https://github.com/openshift/logging-view-plugin)                              | OpenShift console plugin for logging view                             |
| [multicluster-observability-addon](https://github.com/stolostron/multicluster-observability-addon)   | Multi-cluster observability addon for ACM, includes OpenTelemetry     |
| [distributed-tracing-qe](https://github.com/openshift/distributed-tracing-qe)                        | Additional product test in tests/e2e-otel                             |
| [release](https://github.com/openshift/release) | OpenShift CI jobs for stage and downstream in ci-operator/config/openshift/open-telemetry-opentelemetry-operator           |

## Setup

Clone all repos into this directory:

```bash
make clone-repos
```

Pull latest changes in all repos:

```bash
make pull-repos
```

## Specs

All specifications live in `.ai/spec/`. Start with [`.ai/spec/README.md`](.ai/spec/README.md) for the product overview and reading guide. Use [`.ai/spec/how/repo-map.md`](.ai/spec/how/repo-map.md) to find which repo and spec file to update for a given concern.

1. Create spec: a new spec files should be created with `/superpowers:brainstorming` [skill](https://github.com/obra/superpowers/tree/main).
   ```
   > /superpowers:brainstorming create or update specs for https://redhat.atlassian.net/browse/TRACING-6499. Also consider https://redhat.atlassian.net/browse/OBSDA-1454 which is the parent
   ticket. Do not commit and do not proceed with implementation.
   ```
   As an input use product requirements or design ideas. The output should be a set of spec files in `.ai/spec/`.
1. Create Jira tickets: in the same session run `/make-jira-from-spec` skill to create Jira tickets from the spec files.
1. Implementation: use `/superpowers:brainstorming` skill with the Jira ticket as an input. After the implementation is done ask agent to update the spec files based on the implementation. 

### Create initial spec files

The `/spec-first:init` [skill](https://github.com/joshuawilson/spec-first) was used to create initial set of spec files. To install the `spec-first` plugin, run:
```bash
/plugin marketplace add joshuawilson/spec-first
/plugin install spec-first@spec-first-marketplace
```

Example prompt: 
> /spec-first:init create the specs. Document which features are supported and which not. The supported features are the ones that are documented in the docs. These features are either generally available (GA) or tech-preview (TP). If a feature is in the source code, but missing in docs, it is
not supported.

## Conventions

- **Jira**: Project key `TRACING` on `redhat.atlassian.net`
- **Git workflow**: Fork-based — push to your fork, PR against `origin/main`, squash before pushing
- **Per-repo guides**: Each repo has an `AGENTS.md` with repo-specific conventions

## Release Testing

To start QE release testing for a new RHOSDT OTEL version:

1. Run the `/otel-qe-release-testing-epic` skill with the release version (e.g. `3.11`) and the assignee for the work. It creates (or reuses) the Jira Epic that tracks release testing and populates it with the standard set of Tasks.
2. Follow the Epic and work through its Tasks — each Task's description points at the QE skill to use for that piece of testing.
