# Checking fixed CVEs

During the release process we would like to identify what CVEs will be fixed by shipping a new image (compared to the previously released image).

We would like to find the best approach for this. Ideally this could be run in the CI and create a report of the fixed CVEs.

A similar solution was created in: https://gitlab.cee.redhat.com/agentic-hbi/autonomous-cve-agent


The primary reason is that we would like to update our CVE trackers:
* Single CVE: https://redhat.atlassian.net/browse/TRACING-6884
* Govcloud, table with multiple CVEs https://redhat.atlassian.net/browse/TRACING-6864

## Getting vulnerabilities from Red Hat catalog 

```
# Image  https://catalog.redhat.com/en/software/containers/rhosdt/opentelemetry-collector-rhel9/698c80be01a0275730dc7aab?image=6adf250c6b91ac7a306458f7&architecture=arm64 
# By catalog image ID (from the URL: image=6adf250c6b91ac7a306458f7) 
curl -s "https://catalog.redhat.com/api/containers/v1/images/id/6adf250c6b91ac7a306458f7/vulnerabilities" 
```

## Images from prod registry internal Quay.io

Images in the internal Quay.io have attacher SARIF reports from Konflux scanners. 

```bash
registry.redhat.io/rhosdt/opentelemetry-collector-rhel9@sha256:a5c31bb683f13a55993e683c9d63c49d99d50980fb8ebcbb479f5aab27a07ec3 
quay.io/redhat-user-workloads/ocp-art-tenant/art-images@sha256:a5c31bb683f13a55993e683c9d63c49d99d50980fb8ebcbb479f5aab27a07ec3
```

The reports are from:
* roxctl-scan (Red Hat ACS / StackRox) — the primary CVE scanner 
* sast-snyk-check — static analysis of source code
* clamav-scan — malware scan (one per arch) 
* rpms-signature-scan — verifies all RPMs are signed (301 signed, 0 unsigned)
* deprecated-base-image-check — warns on deprecated base images