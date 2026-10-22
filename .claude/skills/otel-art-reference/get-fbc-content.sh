#!/bin/bash
set -euo pipefail

FBC_IMAGE="${1:?Usage: $0 <fbc-pullspec>}"

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

REPO="${FBC_IMAGE%%@*}"
REPO="${REPO%%:*}"

# Extract the related-images.json artifact attached to the FBC image
DIGEST=$(oras discover --format json "$FBC_IMAGE" \
  | jq -r '.manifests[] | select(.artifactType == "application/vnd.konflux-ci.attached-artifact" and .annotations.attachedMediaType == "application/vnd.konflux-ci.attached-artifact.related-images+json") | .digest')

if [[ -z "$DIGEST" ]]; then
  echo "ERROR: no related-images.json artifact found on ${FBC_IMAGE}" >&2
  exit 1
fi

oras pull "${REPO}@${DIGEST}" --output "$TMPDIR" >/dev/null 2>&1

if [[ ! -f "$TMPDIR/related-images.json" ]]; then
  echo "ERROR: related-images.json not found in artifact" >&2
  exit 1
fi

# Extract the rendered catalog
CATALOG_DIGEST=$(oras discover --format json "$FBC_IMAGE" \
  | jq -r '.manifests[] | select(.artifactType == "application/vnd.konflux-ci.attached-artifact" and .annotations.attachedMediaType == "application/vnd.konflux-ci.attached-artifact.rendered-catalog+json") | .digest')

CATALOG_FILE=""
if [[ -n "$CATALOG_DIGEST" ]]; then
  oras pull "${REPO}@${CATALOG_DIGEST}" --output "$TMPDIR" >/dev/null 2>&1
  if [[ -f "$TMPDIR/catalog.json" ]]; then
    CATALOG_FILE="$TMPDIR/catalog.json"
  fi
else
  echo "WARNING: no rendered-catalog artifact found on ${FBC_IMAGE}" >&2
fi

# For each related image, inspect to get source repo and commit
python3 -I -c '
import json, sys, subprocess

fbc_image = sys.argv[1]
related_file = sys.argv[2]
related = json.load(open(related_file))

results = []
for img in related:
    entry = {"image": img}

    stage_img = img.replace("registry.redhat.io", "registry.stage.redhat.io")
    inspect_json = None
    for try_img in [img, stage_img]:
        try:
            out = subprocess.run(
                ["skopeo", "inspect", "--no-tags", "--override-os", "linux",
                 "--override-arch", "amd64", f"docker://{try_img}"],
                capture_output=True, text=True, timeout=30
            )
            if out.returncode == 0:
                inspect_json = json.loads(out.stdout)
                break
        except Exception:
            pass

    if inspect_json:
        labels = inspect_json.get("Labels", {})
        env_list = inspect_json.get("Env", [])
        env = {}
        for e in (env_list or []):
            if "=" in e:
                k, v = e.split("=", 1)
                env[k] = v

        source_url = env.get("SOURCE_GIT_URL") or labels.get("io.openshift.build.source-location", "")
        commit = env.get("SOURCE_GIT_COMMIT") or labels.get("io.openshift.build.commit.id", "")

        component = labels.get("com.redhat.component", "")
        version = labels.get("version", "")
        release = labels.get("release", "")
        if component and version and release:
            entry["nvr"] = f"{component}-{version}-{release}"

        build_date = labels.get("build-date", "")
        if build_date:
            entry["build_date"] = build_date

        if source_url and commit:
            entry["commit_url"] = f"{source_url}/commit/{commit}"

    results.append(entry)

print("fbc_image: " + json.dumps(fbc_image))
print("related_images:")
for r in results:
    print("  - image: " + json.dumps(r["image"]))
    if "nvr" in r:
        print("    nvr: " + json.dumps(r["nvr"]))
    if "build_date" in r:
        print("    build_date: " + json.dumps(r["build_date"]))
    if "commit_url" in r:
        print("    commit_url: " + json.dumps(r["commit_url"]))

catalog_file = sys.argv[3] if len(sys.argv) > 3 else ""
if catalog_file:
    import yaml
    decoder = json.JSONDecoder()
    with open(catalog_file) as f:
        content = f.read()
    idx = 0
    while idx < len(content):
        stripped = content[idx:].lstrip()
        if not stripped:
            break
        idx = len(content) - len(stripped)
        obj, end = decoder.raw_decode(content, idx)
        print("---")
        yaml.dump(obj, sys.stdout, default_flow_style=False, allow_unicode=True, sort_keys=False)
        idx += end - idx
' "$FBC_IMAGE" "$TMPDIR/related-images.json" ${CATALOG_FILE:+"$CATALOG_FILE"}
