#!/bin/bash
set -euo pipefail

VERSION="${1:?Usage: $0 <rhosdt-version> (e.g. 3.11)}"
REPO="quay.io/redhat-user-workloads/ocp-art-tenant/art-fbc"

echo "rhosdt_version: '${VERSION}'"
echo "fbc_images:"

curl -s "https://quay.io/api/v1/repository/redhat-user-workloads/ocp-art-tenant/art-fbc/tag/?filter_tag_name=like:rhosdt-${VERSION}&limit=100" \
  | jq -r '.tags[]
    | select(.name | test("^rhosdt-[0-9.]+__v[0-9.]+__opentelemetry-rhel9-operator$"))
    | [.name, .manifest_digest, .last_modified] | @tsv' \
  | sort -u -t'	' -k1,1 \
  | sort -t_ -k3 -V \
  | while IFS=$'\t' read -r tag digest last_modified; do
      ocp="${tag#*__}" && ocp="${ocp%%__*}"
      echo "- ocp_version: ${ocp}"
      echo "  tag: ${tag}"
      echo "  digest: ${digest}"
      echo "  created: ${last_modified}"
      echo "  image: ${REPO}:${tag}"
      echo "  image_by_digest: ${REPO}@${digest}"
    done
