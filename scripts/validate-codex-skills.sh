#!/usr/bin/env bash
# Validate that the .agents/skills symlink exposes all .claude/skills to Codex CLI.
#
# Codex discovers skills from .agents/skills (not .claude/skills). This repo
# commits a single symlink .agents/skills -> ../.claude/skills to bridge the two.
# Run from the repo root. Exits non-zero with one ERROR line per problem.
set -euo pipefail

fail=0

# 1. .agents/skills must be a symlink pointing to ../.claude/skills
if [ ! -L .agents/skills ]; then
  echo "ERROR: .agents/skills is not a symlink. Run 'make codex-skills' and commit the result."
  fail=1
elif [ "$(readlink .agents/skills)" != "../.claude/skills" ]; then
  echo "ERROR: .agents/skills points to '$(readlink .agents/skills)', expected '../.claude/skills'."
  echo "       Run 'make codex-skills' and commit the result."
  fail=1
fi

# 2. Every skill must be readable through the symlink and have valid frontmatter.
#    Checked via .claude/skills directly (globbing through a dangling link fails).
shopt -s nullglob
skill_files=(.claude/skills/*/SKILL.md)
shopt -u nullglob

if [ ${#skill_files[@]} -eq 0 ]; then
  echo "ERROR: no skills found in .claude/skills."
  fail=1
fi

for skill_md in "${skill_files[@]}"; do
  name=$(basename "$(dirname "$skill_md")")

  if [ ! -f ".agents/skills/$name/SKILL.md" ]; then
    echo "ERROR: .agents/skills/$name/SKILL.md is not reachable through the symlink."
    fail=1
  fi

  # Extract the frontmatter block (between the first two '---' lines) and check
  # that name and description are present and non-empty. '>', '|' or '|-' values
  # are folded/block scalars whose content is on the following lines.
  frontmatter=$(awk 'NR==1 && $0!="---" {exit} NR>1 {if ($0=="---") exit; print}' "$skill_md")

  for key in name description; do
    value=$(echo "$frontmatter" | awk -F': *' -v k="$key" '$1==k {sub(/^[ \t]+|[ \t]+$/, "", $2); print $2; exit}')
    if [ -z "$value" ]; then
      echo "ERROR: $skill_md is missing a non-empty '$key' in its frontmatter."
      fail=1
    fi
  done
done

if [ "$fail" -eq 0 ]; then
  echo "OK: .agents/skills symlink valid, ${#skill_files[@]} skill(s) reachable with valid frontmatter."
else
  echo "Validation failed."
fi

exit "$fail"
