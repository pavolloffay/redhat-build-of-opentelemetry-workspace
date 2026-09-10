---
name: otel-qe-prepare-cluster
description: Provisions or connects to an OpenShift cluster for QE testing. Use when the user asks to get, provision, or connect to a cluster for QE testing.
---

# Prepare QE Cluster

## Provision a cluster
If you're not already connected to an OpenShift cluster, you can either use:

* **local CRC (CodeReady Containers)**
* request an IBM P/Z cluster by emailing the IBM team from `/rhosdt-team:rhosdt-team` skill.
* request a cluster via Slack ClusterBot:

1. Open Slack, go to **Direct messages → Agents & apps → Cluster Bot** (searching/opening "ClusterBot" may instead land on a `cluster_info` notifications DM — that's a different, unrelated bot; the launchable one is named **Cluster Bot** under Agents & apps).
2. On its **Home** tab, under "CI Clusters", click **Launch** next to "Launch an OpenShift cluster using a known image, version, or PR".
3. This opens a **"Launch a Cluster"** multi-step dialog — fill in each step and click **Next**:
   1. Platform: **aws** (ROSA does not work because it doesn't support `ImageDigestMirrorSet`) / Architecture: **amd64** (default)
   2. "Do you want to launch from a PR?" → **Launch from a PR: No** — this dropdown is required; it errors if left on "Select an option..."
   3. "Specify the Stream": **4-stable**
   4. If prompted "There are too many results... select a Major.Minor as well": **4.20**
   5. "Select a version": pick the **top entry** (highest/latest patch version, e.g. `4.20.37`)
   6. "Select one or more parameters for your cluster" (optional): leave blank
4. Click **Submit**. A "Processing the next step, do not close this window..." message appears briefly, then a confirmation dialog shows a Spot-instances notice (worker nodes may be replaced automatically; add `no-spot` as a parameter in step 3.6 if the workload can't tolerate that) and the line **"a cluster is being created - I'll send you the credentials when the cluster is ready."** Click **Close**.
5. Wait approximately **1 hour** for the cluster to be provisioned.
6. ClusterBot will send you the kubeconfig/login credentials once the cluster is ready.

## Get FBC fragment images or OLM bundle from the Konflux repo
The user must provide the release version (e.g. 3.10.0). Read `konflux/release-payloads/otel-stage-<version>.yaml` (and `tempo-stage-<version>.yaml` for Tempo) from the locally-cloned `konflux` repo — look for the `containerImage`/`index_image` field under the relevant component.

The FBC fragments work only on amd64 clusters, on arm64 clusters or IBM P/Z clusters the OLM bundle must be used.

If the files don't exist for the given version, ask the user for the correct version or the FBC fragment images directly.
