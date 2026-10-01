.PHONY: clone-repos pull-repos remove-repos lint lint-fix help

REPOS = \
	open-telemetry/opentelemetry-collector \
	open-telemetry/opentelemetry-collector-contrib \
	open-telemetry/opentelemetry-operator \
	openshift/open-telemetry-opentelemetry-operator \
	os-observability/opentelemetry-operator \
	os-observability/redhat-opentelemetry-collector \
	os-observability/konflux-opentelemetry \
	openshift/openshift-docs \
	openshift/distributed-tracing-console-plugin \
	openshift/logging-view-plugin \
	openshift/distributed-tracing-qe \
	openshift/release \
	stolostron/multicluster-observability-addon \
	openshift-eng/ocp-build-data

GITLAB_REPOS = \
	git@gitlab.cee.redhat.com:distributed-tracing/konflux.git \
	git@gitlab.cee.redhat.com:releng/konflux-release-data.git

# os-observability/opentelemetry-operator shares its basename with the upstream
# open-telemetry/opentelemetry-operator, so it's cloned into os-observability-opentelemetry-operator.
REPO_DIRS = $(foreach r,$(filter-out os-observability/opentelemetry-operator,$(REPOS)),$(notdir $(r))) os-observability-opentelemetry-operator $(foreach r,$(GITLAB_REPOS),$(basename $(notdir $(r))))

SKILLSAW_IMAGE := ghcr.io/stbenjam/skillsaw:latest

# Clone all workspace repos into this directory
# konflux-opentelemetry: --recurse-submodules to populate operator and collector submodules
# openshift-docs: --single-branch --branch to clone the standalone otel docs branch
# os-observability/opentelemetry-operator: cloned as os-observability-opentelemetry-operator to
#   avoid colliding with the upstream open-telemetry/opentelemetry-operator directory
# GitLab repos: require VPN connection to Red Hat network
clone-repos:
	@for repo in $(REPOS); do \
	  name=$$(basename $$repo); \
	  dir=$$name; \
	  if [ "$$repo" = "os-observability/opentelemetry-operator" ]; then dir="os-observability-opentelemetry-operator"; fi; \
	  if [ -d "$$dir/.git" ]; then \
	    echo "=== $$dir already cloned ==="; \
	  else \
	    flags=""; \
	    if [ "$$name" = "konflux-opentelemetry" ]; then flags="--recurse-submodules"; fi; \
	    if [ "$$name" = "openshift-docs" ]; then flags="--single-branch --branch standalone-otel-docs-main"; fi; \
	    git clone $$flags git@github.com:$$repo.git $$dir; \
	  fi; \
	done
	@for repo in $(GITLAB_REPOS); do \
	  name=$$(basename $$repo .git); \
	  if [ -d "$$name/.git" ]; then \
	    echo "=== $$name already cloned ==="; \
	  else \
	    echo "=== Cloning $$name (requires VPN) ==="; \
	    git clone $$repo || echo "WARNING: Failed to clone $$name - VPN required"; \
	  fi; \
	done

# Pull latest changes in all cloned repos
pull-repos:
	@for d in $(REPO_DIRS); do \
	  if [ -d "$$d/.git" ]; then \
	    echo "=== $$d ==="; \
	    git -C "$$d" pull --ff-only; \
	    if [ -f "$$d/.gitmodules" ]; then git -C "$$d" submodule update --init --recursive; fi; \
	  fi; \
	done

# Remove all cloned repos to start fresh (re-clone with make clone-repos)
remove-repos:
	@echo "This will delete all cloned repos. Press Ctrl+C to cancel, Enter to continue."
	@read _confirm
	@for d in $(REPO_DIRS); do \
	  if [ -d "$$d/.git" ]; then echo "Removing $$d..."; rm -rf "$$d"; fi; \
	done
	@echo "Done. Run 'make clone-repos' to re-clone."

lint:
	@docker run --rm -v "$$(pwd):/workspace:Z" $(SKILLSAW_IMAGE) lint --strict $(SKILLSAW_ARGS)

lint-fix:
	@docker run --rm -v "$$(pwd):/workspace:Z" $(SKILLSAW_IMAGE) fix

help:
	@echo "Available targets:"
	@echo "  clone-repos    - Clone all workspace repos into this directory"
	@echo "  pull-repos     - Pull latest in all cloned repos"
	@echo "  remove-repos   - Delete all cloned repos to start fresh"
	@echo "  lint           - Run skillsaw linter (Docker)"
	@echo "  lint-fix       - Auto-fix fixable issues"
	@echo "  help           - Show this help"
