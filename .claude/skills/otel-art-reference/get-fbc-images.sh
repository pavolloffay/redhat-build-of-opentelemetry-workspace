#!/bin/bash
set -euo pipefail

VERSION="${1:?Usage: $0 <rhosdt-version> (e.g. 0.158)}"
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

images_yaml=$(list_tags \
  | jq -r --arg v "$VERSION" '
      select((.name | startswith("rhosdt-" + $v + "__v"))
             and (.name | test("^rhosdt-[0-9.]+__v[0-9.]+__opentelemetry-rhel9-operator$")))
      | [.name, .manifest_digest, .last_modified] | @tsv' \
  | sort -u -t'	' -k1,1 \
  | sort -t_ -k3 -V \
  | while IFS=$'\t' read -r tag digest last_modified; do
      ocp="${tag#*__}" && ocp="${ocp%%__*}"

      bundle_pullspec=""
      commit_url=""
      nvr=""
      if labels=$(skopeo inspect --no-tags --override-os linux --override-arch amd64 "docker://${REPO}@${digest}" 2>/dev/null); then
        bundle_pullspec=$(jq -r '.Labels["com.redhat.art.bundle.pullspec"] // empty' <<<"$labels")
        source_repo=$(jq -r '.Labels["io.openshift.build.source-location"] // empty' <<<"$labels")
        vcs_ref=$(jq -r '.Labels["io.openshift.build.commit.id"] // empty' <<<"$labels")
        if [[ -n "$source_repo" && -n "$vcs_ref" ]]; then
          commit_url="${source_repo}/commit/${vcs_ref}"
        fi
        nvr=$(jq -r '.Labels["com.redhat.art.nvr"] // empty' <<<"$labels")
      fi

      echo "- ocp_version: ${ocp}"
      echo "  tag: ${tag}"
      echo "  digest: ${digest}"
      echo "  created: ${last_modified}"
      echo "  image: ${REPO}:${tag}"
      echo "  image_by_digest: ${REPO}@${digest}"
      if [[ -n "$bundle_pullspec" ]]; then
        echo "  bundle_pullspec: ${bundle_pullspec}"
      fi
      if [[ -n "$commit_url" ]]; then
        echo "  commit_url: ${commit_url}"
      fi
      if [[ -n "$nvr" ]]; then
        echo "  nvr: ${nvr}"
      fi
    done)

bundle_pullspecs=$(echo "$images_yaml" | { grep 'bundle_pullspec:' || true; } | awk '{print $2}' | sort -u)
num_bundles=$(echo "$bundle_pullspecs" | grep -c . || true)
if [[ "$num_bundles" -eq 0 ]]; then
  echo "ERROR: no bundle_pullspec label found in any image (requires art-tools with com.redhat.art.bundle.pullspec support)" >&2
  exit 1
elif [[ "$num_bundles" -gt 1 ]]; then
  echo "ERROR: not all FBC images contain the same bundle build:" >&2
  echo "$images_yaml" | grep -E '(ocp_version|image_by_digest|bundle_pullspec|commit_url|nvr):' \
    | sed 's/^  //' \
    | awk '/^ocp_version:/ { if (NR>1) print ""; print "- " $0; next } { print "  " $0 }' >&2
  exit 1
fi

pullspecs=$(echo "$images_yaml" | grep 'image_by_digest:' | awk '{print $2}' | paste -sd, -)

echo "rhosdt_version: '${VERSION}'"
echo "pullspecs: '${pullspecs}'"
echo "fbc_images:"
echo "$images_yaml"
