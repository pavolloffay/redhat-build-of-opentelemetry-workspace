#!/bin/bash
set -euo pipefail

VERSION="${1:?Usage: $0 <rhosdt-version> (e.g. 3.11)}"
REPO="quay.io/redhat-user-workloads/ocp-art-tenant/art-fbc"
API="https://quay.io/api/v1/repository/redhat-user-workloads/ocp-art-tenant/art-fbc/tag/"

# Quay pages the tag list. Request active tags only: expired entries from earlier builds keep the
# same name as the live tag, so reading them could pick a stale digest for a floating tag.
list_tags() {
  local page=1 resp
  while :; do
    resp=$(curl -sf "${API}?onlyActiveTags=true&filter_tag_name=like:rhosdt-${VERSION}&limit=100&page=${page}")
    jq -c '.tags[]' <<<"$resp"
    [[ "$(jq -r '.has_additional' <<<"$resp")" == "true" ]] || break
    page=$((page + 1))
  done
}

all_digests=()

images_yaml=$(list_tags \
  | jq -r --arg v "$VERSION" '
      select((.name | startswith("rhosdt-" + $v + "__v"))
             and (.name | test("^rhosdt-[0-9.]+__v[0-9.]+__opentelemetry-rhel9-operator$")))
      | [.name, .manifest_digest, .last_modified] | @tsv' \
  | sort -u -t'	' -k1,1 \
  | sort -t_ -k3 -V \
  | while IFS=$'\t' read -r tag digest last_modified; do
      ocp="${tag#*__}" && ocp="${ocp%%__*}"

      commit_url=""
      if labels=$(skopeo inspect --no-tags "docker://${REPO}@${digest}" 2>/dev/null); then
        source_repo=$(jq -r '.Labels["io.openshift.build.source-location"] // empty' <<<"$labels")
        vcs_ref=$(jq -r '.Labels["io.openshift.build.commit.id"] // empty' <<<"$labels")
        if [[ -n "$source_repo" && -n "$vcs_ref" ]]; then
          commit_url="${source_repo}/commit/${vcs_ref}"
        fi
      fi

      echo "- ocp_version: ${ocp}"
      echo "  tag: ${tag}"
      echo "  digest: ${digest}"
      echo "  created: ${last_modified}"
      echo "  image: ${REPO}:${tag}"
      echo "  image_by_digest: ${REPO}@${digest}"
      if [[ -n "$commit_url" ]]; then
        echo "  commit_url: ${commit_url}"
      fi
    done)

commit_urls=$(echo "$images_yaml" | grep 'commit_url:' | awk '{print $2}' | sort -u)
num_unique=$(echo "$commit_urls" | wc -l)
if [[ -z "$commit_urls" ]]; then
  echo "ERROR: no commit_url found in any image" >&2
  exit 1
elif [[ "$num_unique" -gt 1 ]]; then
  echo "ERROR: not all images were built from the same commit:" >&2
  echo "$images_yaml" | grep -E '(ocp_version|commit_url):' | paste - - | awk '{print "  " $0}' >&2
  exit 1
fi

pullspecs=$(echo "$images_yaml" | grep 'image_by_digest:' | awk '{print $2}' | paste -sd,)

echo "rhosdt_version: '${VERSION}'"
echo "pullspecs: '${pullspecs}'"
echo "fbc_images:"
echo "$images_yaml"
