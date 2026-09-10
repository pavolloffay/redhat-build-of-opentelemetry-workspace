## Final Status Collection

**Inputs:** `{PR_NUMBER}` and `{JIRA_KEY}`, from the skill arguments (see Modes). Ask for whichever is missing — do not guess a PR number from the branch or a Jira key from recent work.

**Run this only when the user says testing on the PR is finished.** Invoking the skill with a PR number and Jira key is itself that signal; the other triggers are "testing is done", "all jobs have passed", "wrap up the PR", "post the results to Jira". If any rehearsed job is still running or is queued for a rerun, testing is not finished — say so and wait.

**Failing jobs do not block posting.** A red job at this point has normally already been debugged by the task assignee, with bugs filed or fixes landed elsewhere. Report the failures in the table, name them in the summary line, and post. Never withhold the comment or ask whether to post because some jobs failed — only a job still *running* is a reason to wait.

### Step 8: Collect Final Job Status

For each job rehearsed on the PR — including every job from *all* `/pj-rehearse` rounds, not just the last one — record its final result and its history link.

**Recover the full job list** from the PR's own commands:
```bash
gh api repos/openshift/release/issues/{PR_NUMBER}/comments --paginate --jq '.[].body' \
  | grep -o '/pj-rehearse [^`]*' | tr ' ' '\n' | grep '^periodic-ci-' | sort -u
```

**History link — the only two variables are the PR number and the job name:**
```
https://qe-private-deck-ci.apps.ci.l2s4.p1.openshiftapps.com/job-history/gs/qe-private-deck/pr-logs/directory/rehearse-{PR_NUMBER}-{JOB_NAME}
```

That page is the authoritative record: every run of that job on that PR — build ID, revision, duration, and result — across all commits and reruns, including `ABORTED` ones. It reads GCS directly, so it needs no build IDs and no commit SHAs.

**Parse the embedded JSON, do not scrape the HTML.** The page carries a `var allBuilds = [...]` array with exactly the fields needed:
```python
import re, json, subprocess, urllib.request
TOK = subprocess.run(["oc","whoami","-t"], capture_output=True, text=True).stdout.strip()
url = ("https://qe-private-deck-ci.apps.ci.l2s4.p1.openshiftapps.com/job-history/gs/"
       f"qe-private-deck/pr-logs/directory/rehearse-{PR_NUMBER}-{JOB_NAME}")
h = urllib.request.urlopen(
        urllib.request.Request(url, headers={"Authorization": "Bearer " + TOK}), timeout=60
    ).read().decode()
builds = json.loads(re.search(r'allBuilds\s*=\s*(\[.*?\]);', h, re.S).group(1))
builds.sort(key=lambda b: b["Started"], reverse=True)   # newest first
```
Each entry has `ID`, `Started`, `Duration`, `Result` (`SUCCESS` / `FAILURE` / `ABORTED` / `ERROR` / `PENDING`), `SpyglassLink`, and `Refs.pulls[0].sha`. The visible `run-success` / `run-failure` CSS classes are a legend rendered once each — counting them tells you nothing.

Any entry still `PENDING` means testing is not finished; stop and say so.

**Check the login before collecting anything:**
```bash
oc whoami --show-server   # must be https://api.ci.l2s4.p1.openshiftapps.com:6443
```

If that is not app.ci, stop and ask the user to log in — do not silently fall back. Give them these instructions verbatim:

> Open https://console-openshift-console.apps.ci.l2s4.p1.openshiftapps.com/ → click your username (top right) → **Copy login command** → **Display Token** → copy the `oc login --token=... --server=...` line.
> Paste it into this session prefixed with `!` so it runs here, e.g. `! oc login --token=sha256~… --server=https://api.ci.l2s4.p1.openshiftapps.com:6443`

Never ask the user to paste the token as chat text, and never echo the token in a command you construct — the `!` prefix keeps it out of the transcript you generate.

**If the user declines or cannot log in, say so and use the GitHub fallback**, which needs only `gh`:
```bash
gh api repos/openshift/release/commits/{SHA}/statuses --paginate \
  --jq '.[] | select(.context|startswith("ci/rehearse/")) | "\(.state)\t\(.context)"'
```
Get `{SHA}` for every commit the PR has had, not just the current head — statuses persist per-SHA even after a force-push, and older rehearsals hang off SHAs that `gh pr view` no longer lists. Recover them from the public build metadata:
```bash
curl -s "https://storage.googleapis.com/test-platform-results/pr-logs/pull/openshift_release/{PR_NUMBER}/pull-ci-openshift-release-main-owners/{BUILD_ID}/started.json" \
  | jq -r '.repos["openshift/release"]'   # -> "main:{base},{PR_NUMBER}:{head}"
```
listing `{BUILD_ID}`s from the bucket prefix `pr-logs/pull/openshift_release/{PR_NUMBER}/pull-ci-openshift-release-main-owners/`.

Fallback limitations — state both in the Step 9 comment when you use it:
- It never records `ABORTED` runs, so run counts can read low.
- It reflects GitHub status contexts, not GCS, so a run whose status was never posted is invisible.

Treat any disagreement with the history page as the history page being right.

**Take the result of the most recent run of each job.** An earlier failure that was later fixed and reran green is a PASS; note the rerun in passing rather than reporting the stale failure.

### Step 9: Post Final Status to the Jira Tracker

Post to `{JIRA_KEY}`. If it was not passed as an argument, ask for it now.

**Check the target matches the jobs before posting.** The release-testing Epic (`otel-qe-release-testing-epic`) holds one Task *per OCP version or platform*, not one Task for all stage jobs — e.g. for 3.11, Epic `TRACING-6566` with Tasks `[QE] RHOSDT Tests on OCP 4.20 [gangway]`, `... on OCP FIPS`, `... on OCP ARM`, `... on IBM Z [manual]`, `... on IBM P [manual]`. A combined table of all rehearsed jobs belongs on the **Epic**; a single job's result belongs on its **version Task**. Tasks like IBM P/IBM Z are manual testing and have no OCP CI stage job at all.

If `{JIRA_KEY}` does not line up with the jobs you collected — wrong platform, or a Task when you have a combined table — say so, show the mismatch, and let the user choose. Then post where they say, including to the key they originally gave.

**Required comment format — Markdown.** The Jira MCP comment tool takes markdown, not Jira wiki markup; `||header||` tables post as literal text through it.
```markdown
PR: https://github.com/openshift/release/pull/84239 — *OTEL RHOSDT 3.11: Stage tests*

Final rehearsal results for the OCP CI stage jobs (collected from Prow job history, authoritative):

| Job | Result | Runs | Run history |
| --- | --- | --- | --- |
| `product-ocp-4.19-stage-opentelemetry-stage-tests` | ✅ PASS | 1 | [history](https://qe-private-deck-ci.apps.ci.l2s4.p1.openshiftapps.com/job-history/gs/qe-private-deck/pr-logs/directory/rehearse-84239-periodic-ci-openshift-open-telemetry-opentelemetry-operator-main-opentelemetry-product-ocp-4.19-stage-opentelemetry-stage-tests) |
| `product-ocp-5.0-stage-opentelemetry-stage-tests` | ❌ FAIL | 3 (FAILURE, ABORTED earlier) | [history](...) |

**5 passed, 3 failed.** Still failing: `4.14-arm`, `4.20`, `5.0`.
```
Shorten the job name in the first column by stripping the `periodic-ci-openshift-open-telemetry-opentelemetry-operator-main-opentelemetry-` prefix. Keep the full job name in the URL. The `Runs` column carries the earlier results in parentheses so a rerun history is visible without opening the link.

**Rules:**
- Include every rehearsed job, including the disconnected one — same `rehearse-{PR_NUMBER}-` prefix even though its config lives in another project directory.
- Use `pr-logs/directory/{job}`. The `pr-logs/pull/openshift_release/{PR}/{job}` form renders an empty table.
- Bucket and host must match: private jobs use `qe-private-deck` on the private deck host above. A public rehearsal would use `test-platform-results` on `prow.ci.openshift.org`.
- Result is a point-in-time snapshot; the history link is what stays current. Always include both columns.
- A rehearsed job with no matching Task, or a Task with no rehearsed job (the disconnected job is often never rehearsed), is worth one line to the user — it means coverage does not match the tracker.

Show the user the rendered comment and get an explicit go-ahead before posting — the comment notifies the issue's assignee and watchers. If a later rerun changes a result, edit the existing comment (`commentId` from `listJiraIssueComments`) rather than adding a new one.
