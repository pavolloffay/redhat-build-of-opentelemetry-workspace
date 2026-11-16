.PHONY: clone-repos pull-repos remove-repos lint lint-fix codex-skills help

REPOS = \
	open-telemetry/opentelemetry-collector \
	open-telemetry/opentelemetry-collector-contrib \
	open-telemetry/opentelemetry-operator \
	openshift/open-telemetry-opentelemetry-operator \
	openshift/redhat-opentelemetry-collector \
	openshift/openshift-docs \
	openshift/distributed-tracing-console-plugin \
	openshift/logging-view-plugin \
	openshift/distributed-tracing-qe \
	openshift/release \
	stolostron/multicluster-observability-addon \
	openshift-eng/ocp-build-data

GITLAB_REPOS = \
	git@gitlab.cee.redhat.com:releng/konflux-release-data.git \
	git@gitlab.cee.redhat.com:distributed-tracing/art-opentelemetry.git

REPO_DIRS = $(notdir $(REPOS)) $(foreach r,$(GITLAB_REPOS),$(basename $(notdir $(r))))

SKILLSAW_IMAGE := ghcr.io/stbenjam/skillsaw:latest

# Clone all workspace repos into this directory
# openshift-docs: --single-branch --branch to clone the standalone otel docs branch
# GitLab repos: require VPN connection to Red Hat network
clone-repos:
	@for repo in $(REPOS); do \
	  name=$$(basename $$repo); \
	  if [ -d "$$name/.git" ]; then \
	    echo "=== $$name already cloned ==="; \
	  else \
	    flags=""; \
	    if [ "$$name" = "openshift-docs" ]; then flags="--single-branch --branch standalone-otel-docs-main"; fi; \
	    git clone $$flags git@github.com:$$repo.git; \
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
	@./scripts/validate-codex-skills.sh
	@docker run --rm -v "$$(pwd):/workspace:Z" $(SKILLSAW_IMAGE) lint --strict $(SKILLSAW_ARGS)

lint-fix:
	@docker run --rm -v "$$(pwd):/workspace:Z" $(SKILLSAW_IMAGE) fix

# Recreate the .agents/skills symlink that exposes .claude/skills to Codex CLI.
# Codex discovers skills from .agents/skills, not .claude/skills; the symlink is
# committed to the repo, so this is only needed on clones where git could not
# restore it (e.g. Windows without developer mode). Validated by the
# validate-codex-skills GitHub workflow.
codex-skills:
	@mkdir -p .agents
	@ln -sfn ../.claude/skills .agents/skills
	@echo "Created .agents/skills -> ../.claude/skills (Codex can now see .claude/skills)"

help:
	@echo "Available targets:"
	@echo "  clone-repos    - Clone all workspace repos into this directory"
	@echo "  pull-repos     - Pull latest in all cloned repos"
	@echo "  remove-repos   - Delete all cloned repos to start fresh"
	@echo "  lint           - Validate Codex skills symlink, then run skillsaw linter (Docker)"
	@echo "  lint-fix       - Auto-fix fixable issues"
	@echo "  codex-skills   - Recreate the .agents/skills symlink for Codex CLI"
	@echo "  help           - Show this help"
