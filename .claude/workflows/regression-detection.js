export const meta = {
  name: 'regression-detection',
  description: 'Detect upstream regressions in OpenTelemetry repos vs downstream Red Hat build of OpenTelemetry release',
  phases: [
    { title: 'Discover', detail: 'Parse manifest.yaml and glob docs to build component list' },
    { title: 'Setup', detail: 'Validate repos, tags, and fetch latest upstream' },
    { title: 'Analyze', detail: 'Fan out changelog, code diff, feature gate, issue, test, and dependency agents' },
    { title: 'Synthesize', detail: 'Merge, deduplicate, classify, and generate report' },
  ],
}

// Shared by every agent's schema and appended to every agent's prompt (see
// DEVIATIONS_INSTRUCTION below) — the Synthesize phase collects all of it
// into the report's "Skill Improvement Recommendations" section, so drift
// between what this workflow assumes and what's actually true in the repos
// gets surfaced for someone to fix in the workflow/skill itself, run after run.
const DEVIATIONS_PROPERTY = {
  deviations: {
    type: 'array',
    items: { type: 'string' },
    description: 'Short notes on anywhere the actual approach differed from the prompt instructions as written (a command/path/pattern that needed a workaround, a wrong assumption, a skipped/improvised step, etc). Empty array if none.',
  },
}

const DEVIATIONS_INSTRUCTION = `

Also return "deviations": an array of short notes on anywhere your actual approach differed from these instructions as written — a command, path, or pattern that didn't work as described and needed a workaround, an assumption above that turned out wrong, a step you had to skip or improvise around, etc. Empty array if everything worked exactly as written. This feeds into a report section that helps improve this workflow's instructions over time — be specific and factual, not speculative.`

const DISCOVERY_SCHEMA = {
  type: 'object',
  properties: {
    collector_version: { type: 'string' },
    operator_base_commit: { type: 'string' },
    operator_base_version: { type: 'string' },
    release_branch: { type: 'string' },
    components: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['receiver', 'processor', 'exporter', 'connector', 'extension'] },
          gomod: { type: 'string' },
          source_dir: { type: 'string' },
          repo: { type: 'string', enum: ['collector_core', 'collector_contrib'] },
          version: { type: 'string' },
          has_doc: { type: 'boolean' },
          doc_file: { type: 'string' },
        },
        required: ['type', 'gomod', 'source_dir', 'repo', 'version', 'has_doc'],
      },
    },
    documented_but_missing: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          doc_file: { type: 'string' },
        },
        required: ['type', 'doc_file'],
      },
    },
    ...DEVIATIONS_PROPERTY,
  },
  required: ['collector_version', 'operator_base_commit', 'operator_base_version', 'release_branch', 'components', 'documented_but_missing', 'deviations'],
}

const SETUP_SCHEMA = {
  type: 'object',
  properties: {
    operator_ok: { type: 'boolean', description: 'operator repo exists as a git repository' },
    contrib_ok: { type: 'boolean' },
    core_ok: { type: 'boolean' },
    docs_ok: { type: 'boolean', description: 'false if the docs repo path was not provided or does not exist — not an error, doc validation is skipped' },
    qe_ok: { type: 'boolean', description: 'false if the QE repo path was not provided or does not exist — not an error, QE coverage will show none' },
    operator_base_ref_ok: { type: 'boolean', description: 'the discovered operator base commit/tag resolves in the operator repo' },
    contrib_base_ref_ok: { type: 'boolean' },
    core_base_ref_ok: { type: 'boolean' },
    upstream_operator_version: { type: 'string', description: 'the latest release tag reachable from origin/main in the operator repo (e.g. "v0.160.0") — this is the upstream version the report is generated against, distinct from the downstream base version. Empty string if no tag could be resolved.' },
    error: { type: 'string', description: 'human-readable summary of anything missing or broken; empty string if nothing wrong' },
    ...DEVIATIONS_PROPERTY,
  },
  required: ['operator_ok', 'contrib_ok', 'core_ok', 'docs_ok', 'qe_ok', 'operator_base_ref_ok', 'contrib_base_ref_ok', 'core_base_ref_ok', 'upstream_operator_version', 'error', 'deviations'],
}

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] },
          category: { type: 'string', enum: ['BREAKING_CHANGE', 'DEPRECATION', 'BEHAVIOR_CHANGE', 'NEW_FEATURE', 'BUG_FIX', 'FEATURE_GATE', 'DEPENDENCY', 'TEST_COVERAGE', 'REMOVED_API', 'DOC_STALE', 'DOC_MISSING', 'COMPONENT_DRIFT'] },
          component: { type: 'string' },
          component_type: { type: 'string', enum: ['receiver', 'processor', 'exporter', 'connector', 'extension', 'operator', 'core', 'auto_instrumentation'] },
          title: { type: 'string' },
          description: { type: 'string' },
          upstream_pr: { type: 'string' },
          affected_config_fields: { type: 'array', items: { type: 'string' } },
          has_test_coverage: { type: 'boolean' },
          recommended_action: { type: 'string' },
        },
        required: ['severity', 'category', 'component', 'title', 'description', 'recommended_action'],
      },
    },
    summary: { type: 'string' },
    ...DEVIATIONS_PROPERTY,
  },
  required: ['findings', 'summary', 'deviations'],
}

const COVERAGE_SCHEMA = {
  type: 'object',
  properties: {
    coverage_matrix: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          component: { type: 'string' },
          component_type: { type: 'string', enum: ['receiver', 'processor', 'exporter', 'connector', 'extension'] },
          has_doc: { type: 'boolean' },
          upstream_test: { type: 'string', enum: ['dedicated', 'implicit', 'none'] },
          upstream_test_path: { type: 'string' },
          qe_test: { type: 'string', enum: ['dedicated', 'implicit', 'none'] },
          qe_test_path: { type: 'string' },
        },
        required: ['component', 'component_type', 'has_doc', 'upstream_test', 'qe_test'],
      },
    },
    summary: {
      type: 'object',
      properties: {
        total_components: { type: 'number' },
        with_upstream_test: { type: 'number' },
        with_qe_test: { type: 'number' },
        with_any_test: { type: 'number' },
        with_no_test: { type: 'number' },
        documented_with_no_test: { type: 'number' },
      },
      required: ['total_components', 'with_upstream_test', 'with_qe_test', 'with_any_test', 'with_no_test'],
    },
    test_change_findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] },
          category: { type: 'string' },
          component: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          recommended_action: { type: 'string' },
        },
        required: ['severity', 'category', 'component', 'title', 'description', 'recommended_action'],
      },
    },
    operator_feature_matrix: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          feature: { type: 'string' },
          description: { type: 'string' },
          upstream_test: { type: 'string', enum: ['dedicated', 'none'] },
          qe_test: { type: 'string', enum: ['dedicated', 'implicit', 'none'] },
          qe_test_path: { type: 'string' },
        },
        required: ['feature', 'upstream_test', 'qe_test'],
      },
    },
    feature_summary: {
      type: 'object',
      properties: {
        total_features: { type: 'number' },
        with_qe_test: { type: 'number' },
        with_no_test: { type: 'number' },
      },
      required: ['total_features', 'with_qe_test', 'with_no_test'],
    },
    ...DEVIATIONS_PROPERTY,
  },
  required: ['coverage_matrix', 'summary', 'test_change_findings', 'operator_feature_matrix', 'feature_summary', 'deviations'],
}

const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    findings_rendered: {
      type: 'array',
      description: 'Deduplicated, ID-assigned findings — returned as flat data so a separate, non-agent step can render the AI-friendly Markdown report from the identical set/IDs without asking the model to hand-write the full document (a ~100+ finding Markdown document pushes a single completion past a practical output-length ceiling and can hang rather than cleanly error).',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          severity: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] },
          category: { type: 'string' },
          component: { type: 'string' },
          component_type: { type: 'string' },
          detection_methods: { type: 'array', items: { type: 'string' } },
          title: { type: 'string' },
          description: { type: 'string' },
          upstream_pr: { type: 'string' },
          affected_config_fields: { type: 'array', items: { type: 'string' } },
          has_test_coverage: { type: 'boolean' },
          recommended_action: { type: 'string' },
        },
        required: ['id', 'severity', 'category', 'component', 'title', 'description', 'recommended_action'],
      },
    },
    summary_counts: {
      type: 'object',
      properties: {
        critical: { type: 'number' },
        high: { type: 'number' },
        medium: { type: 'number' },
        low: { type: 'number' },
        total: { type: 'number' },
      },
      required: ['critical', 'high', 'medium', 'low', 'total'],
    },
  },
  required: ['findings_rendered', 'summary_counts'],
}

// Defaults match the repo names `make clone-repos` creates at the workspace root — this
// lets the workflow run standalone (e.g. via the auto-registered `/regression-detection`
// command) without requiring the otel-regression-detection skill to resolve paths first.
// docsPath/qePath may be reset to '' below in Setup if those optional repos aren't present.
const a = args || {}
const konfluxPath = a.konflux_path || 'konflux-opentelemetry'
const operatorPath = a.operator_path || 'opentelemetry-operator'
const contribPath = a.contrib_path || 'opentelemetry-collector-contrib'
const corePath = a.core_path || 'opentelemetry-collector'
const rhCollectorPath = a.rh_collector_path || 'redhat-opentelemetry-collector'
let qePath = a.qe_path || 'distributed-tracing-qe'
let docsPath = a.docs_path || 'openshift-docs'
const method = a.method || 'all'
const releaseVersion = a.release_version || ''

// ── Phase 1: Discover ──
// Everything is derived from konflux-opentelemetry:
//   Tags (v3.10, v3.9) pin the exact state of each release
//   git ls-tree <tag> <submodule> → pinned submodule commits
//   git show <commit>:manifest.yaml (in redhat-opentelemetry-collector) → component list
//   git show <tag>:bundle-patch/patch_csv.yaml → downstream version
phase('Discover')

const useTag = releaseVersion ? `v${releaseVersion}` : ''

const discovery = await agent(`You are discovering the downstream build definition and component list from the konflux-opentelemetry repo.

TASK: Extract all build metadata from ${konfluxPath} and cross-reference with docs.
${useTag ? `
IMPORTANT: The user requested analysis for release version ${releaseVersion}.
Use the tag "${useTag}" in konflux-opentelemetry to read the pinned state of that release.
First run: git -C ${konfluxPath} fetch origin tag ${useTag}
` : `
Use the current working tree of ${konfluxPath} (latest checkout).
`}
STEP 1: GET BUILD METADATA FROM KONFLUX REPO
Run these commands in ${konfluxPath}:

a) Release branch:
   ${useTag ? `git show ${useTag}:.gitmodules | grep branch` : 'grep "branch" .gitmodules'}
   Extract the branch name (e.g., "rhosdt-3.10").

b) Pinned submodule commits:
   ${useTag
     ? `git ls-tree ${useTag} redhat-opentelemetry-collector — extract the commit hash (3rd field)
   git ls-tree ${useTag} opentelemetry-operator — extract the commit hash (3rd field)`
     : `git submodule status
   Extract the commit hash for each (the hex string at the start, ignoring the leading +).`}
   The opentelemetry-operator commit is the downstream operator base.

c) Downstream version:
   ${useTag ? `git show ${useTag}:bundle-patch/patch_csv.yaml | grep "version:" | head -1` : 'grep "version:" bundle-patch/patch_csv.yaml | head -1'}
   Extract the version (e.g., "0.152.0-3"). The part before the dash is the upstream operator version.

STEP 2: PARSE MANIFEST
${useTag
  ? `Get the redhat-opentelemetry-collector submodule commit from step 1b.
Then read the manifest from that commit in the redhat-opentelemetry-collector repo:
  git -C ${rhCollectorPath || contribPath + '/../redhat-opentelemetry-collector'} show <collector_commit>:manifest.yaml
If the redhat-opentelemetry-collector repo is not available at that path, try: ${konfluxPath}/redhat-opentelemetry-collector
  git -C ${konfluxPath}/redhat-opentelemetry-collector show <collector_commit>:manifest.yaml`
  : `Read the file: ${konfluxPath}/redhat-opentelemetry-collector/manifest.yaml`}
This file has sections: receivers, exporters, processors, connectors, extensions.
Each entry has a "gomod" field like:
  - gomod: github.com/open-telemetry/opentelemetry-collector-contrib/receiver/jaegerreceiver v0.152.0
  - gomod: go.opentelemetry.io/collector/receiver/otlpreceiver v0.152.1

For each entry, extract:
  - type: the section it's under (receiver, exporter, processor, connector, extension)
  - gomod: the full Go module path
  - source_dir: the path after "collector-contrib/" or "collector/" (e.g., "receiver/jaegerreceiver")
  - repo: "collector_contrib" if the module starts with "github.com/open-telemetry/opentelemetry-collector-contrib/", or "collector_core" if it starts with "go.opentelemetry.io/collector/"
  - version: the version string

Also extract dist.version from the top of the file — this is the downstream base collector version.

STEP 3: GLOB DOCS
${docsPath ? `List all doc module files in: ${docsPath}/otel-collector/modules/
Run: ls ${docsPath}/otel-collector/modules/otel-receivers-*.adoc ${docsPath}/otel-collector/modules/otel-processors-*.adoc ${docsPath}/otel-collector/modules/otel-exporters-*.adoc ${docsPath}/otel-collector/modules/otel-connectors-*.adoc ${docsPath}/otel-collector/modules/otel-extensions-*.adoc 2>/dev/null

Exclude files ending in "-overview.adoc" — those are category overviews, not component docs.` : 'Docs repo not available — skip doc globbing.'}

STEP 4: CROSS-REFERENCE
For each component from the manifest, check if a matching doc file exists. The matching is fuzzy:
  - receiver/jaegerreceiver → otel-receivers-jaeger-receiver.adoc
  - processor/batchprocessor → otel-processors-batch-processor.adoc
  - extension/storage/filestorage → otel-extensions-filestorage-extension.adoc
Set has_doc=true if a match exists. Record the doc_file name.

For doc files that don't match any manifest component, add to documented_but_missing.

STEP 5: Return the complete discovery result.${DEVIATIONS_INSTRUCTION}`, {
  label: 'discover-components',
  phase: 'Discover',
  schema: DISCOVERY_SCHEMA,
})

if (
  !discovery ||
  !discovery.collector_version ||
  !discovery.operator_base_commit ||
  !discovery.operator_base_version ||
  !discovery.components ||
  discovery.components.length === 0
) {
  log('ERROR: Discovery phase failed — could not extract build metadata from konflux-opentelemetry. Aborting.')
  return {
    report_markdown: '# Regression Detection — Failed\n\nDiscovery phase failed. Check that konflux-opentelemetry is cloned with --recurse-submodules and contains manifest.yaml.',
    summary_counts: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
  }
}

// Renders the AI-friendly Markdown report deterministically from the agent's
// already-deduplicated, ID-assigned findings_rendered — kept out of the
// report-generation agent call because asking one completion to produce a
// ~100+ finding report pushes it past a practical output-length ceiling and
// can hang rather than cleanly error. This mirrors the coverage-matrix
// blocks above: data that doesn't need creative synthesis is templated in JS.
//
// Severity is the only top-level structure — with 60-100+ findings per
// report, a reader needs to jump straight to "what's Critical" via the
// Contents links without scanning past other groupings first.
const SEVERITIES = [
  { key: 'CRITICAL', title: 'Critical' },
  { key: 'HIGH', title: 'High' },
  { key: 'MEDIUM', title: 'Medium' },
  { key: 'LOW', title: 'Low' },
]

// Mirrors GitHub's Markdown header-to-anchor slug algorithm (lowercase,
// spaces to hyphens, strip anything else) — good enough for the plain-ASCII
// headings this report generates, so '[text](#anchor)' links actually land.
const anchor = (title) => title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-')

function buildRemediationMarkdown(findings, meta) {
  const { operatorBase, operatorVersion, upstreamOperatorVersion, contribBase, releaseBranch, componentsCount, documentedCount, summaryCounts, coverageMatrix, operatorFeatureMatrix, docDrift, deviations } = meta

  const inlineList = (arr) => (arr && arr.length ? arr.join(', ') : '—')

  const findingBlock = (f) => `#### ${f.id} — ${f.title}

| Field | Value |
|---|---|
| Category | ${f.category} |
| Component | ${f.component} |
| Component type | ${f.component_type || '—'} |
| Detection methods | ${inlineList(f.detection_methods)} |
| Upstream PR | ${f.upstream_pr || '—'} |
| Affected config fields | ${inlineList(f.affected_config_fields)} |
| Has test coverage | ${f.has_test_coverage != null ? f.has_test_coverage : '—'} |

Description: ${f.description}

Recommended action: ${f.recommended_action}
`

  // A component/feature counts as covered if EITHER an upstream or a QE test
  // exercises it — the product build runs both suites, so upstream-only
  // coverage is still real coverage. Only flag a gap when neither exists.
  const noCoverageComponents = (coverageMatrix || []).filter(c => c.upstream_test === 'none' && c.qe_test === 'none')
  const noCoverageFeatures = (operatorFeatureMatrix || []).filter(f => f.upstream_test === 'none' && f.qe_test === 'none')
  const hasCoverageGaps = noCoverageComponents.length > 0 || noCoverageFeatures.length > 0
  const coverageGapsSection = hasCoverageGaps
    ? `## Confirmed Coverage Gaps

Components and operator features with no test at all — neither upstream nor QE. Anything with at least one of the two is considered covered, since the product build runs both suites.

${noCoverageComponents.map(c => `- ${c.component} (${c.component_type}) — ${c.has_doc ? 'documented' : 'undocumented'}, no upstream or QE test`).join('\n')}
${noCoverageFeatures.map(f => `- ${f.feature}${f.description ? ` — ${f.description}` : ''} — no upstream or QE test`).join('\n')}
`
    : ''

  const hasDocDrift = docDrift && docDrift.length > 0
  const driftSection = hasDocDrift
    ? `## Documentation Drift

Docs that exist but no longer match any component in the manifest.

${docDrift.map(d => `- ${d.doc_file} (${d.type}) — doc exists but no matching component found in the manifest`).join('\n')}
`
    : ''

  const severitySections = SEVERITIES.map(sev => {
    const atSeverity = findings.filter(f => f.severity === sev.key)
    return { ...sev, count: atSeverity.length, body: atSeverity.map(findingBlock).join('\n') }
  })

  const toc = [
    ...severitySections.map(s => `- [${s.title} (${s.count})](#${anchor(s.title)})`),
    hasCoverageGaps ? `- [Confirmed Coverage Gaps](#confirmed-coverage-gaps)` : null,
    hasDocDrift ? `- [Documentation Drift](#documentation-drift)` : null,
    `- [Skill Improvement Recommendations](#skill-improvement-recommendations)`,
  ].filter(Boolean).join('\n')

  const severityBody = severitySections
    .map(s => `## ${s.title}\n\n${s.body || '(no findings at this severity)\n'}`)
    .join('\n')

  const deviationsSection = `## Skill Improvement Recommendations

*(Deviations from skill steps as written — \`None.\` if everything worked as described.)*

${deviations && deviations.length ? deviations.map(d => `- ${d}`).join('\n') : 'None.'}
`

  return `# Regression Detection Report

## Metadata

| Field | Value |
|---|---|
| Downstream base | operator \`${operatorBase}\` (v${operatorVersion}), collector \`${contribBase}\` |
| Upstream target | origin/main (latest release: ${upstreamOperatorVersion}) |
| Release branch | ${releaseBranch} |
| Components in build | ${componentsCount} |
| Documented components | ${documentedCount} |
| Critical | ${summaryCounts.critical} |
| High | ${summaryCounts.high} |
| Medium | ${summaryCounts.medium} |
| Low | ${summaryCounts.low} |
| Total | ${summaryCounts.total} |

## Contents

${toc}

${severityBody}

${[coverageGapsSection, driftSection, deviationsSection].filter(Boolean).join('\n')}`
}

const collectorBaseVersion = discovery.collector_version
const contribBase = 'v' + collectorBaseVersion
const coreBase = 'v' + collectorBaseVersion
const operatorBase = discovery.operator_base_commit
const operatorVersion = discovery.operator_base_version
const releaseBranch = discovery.release_branch
const components = discovery.components
const docDrift = discovery.documented_but_missing || []

log(`Discovered ${components.length} components. Collector: v${collectorBaseVersion}, Operator: ${operatorBase} (v${operatorVersion}), Branch: ${releaseBranch}. ${docDrift.length} doc-only.`)

// ── Phase 2: Setup ──
phase('Setup')
const setup = await agent(`You are setting up regression detection. Do the following:

1. Check whether these repos exist and are git repositories (e.g. "git -C <path> rev-parse --is-inside-work-tree"):
   - Operator (required): ${operatorPath}
   - Collector-contrib (required): ${contribPath}
   - Collector-core (required): ${corePath}
   - Docs (optional): ${docsPath}
   - QE tests (optional): ${qePath}

2. For each repo that exists, run "git fetch origin main" to get latest state. Skip repos that don't exist — that is not an error for the optional docs/QE repos.

3. For the required repos that exist, verify these base refs resolve, using "git rev-parse --verify <ref>" (for tags also try "git tag -l <tag>"):
   - In operator repo: ${operatorBase} (this may be a commit hash, not a tag)
   - In collector-contrib repo: ${contribBase}
   - In collector-core repo: ${coreBase}

4. Get the current HEAD commit hash for origin/main in each repo that exists, using "git rev-parse origin/main".

5. Resolve the upstream operator version — the latest release tag reachable from origin/main in the operator repo (NOT the downstream base version, and NOT necessarily the single latest tag in the repo if origin/main is behind some other branch's tag):
   git -C ${operatorPath} fetch --tags origin
   git -C ${operatorPath} tag --sort=-v:refname --merged origin/main | head -1
   If this returns nothing (no tags reachable), fall back to the short commit hash of origin/main. Return this as upstream_operator_version.

6. Return operator_ok/contrib_ok/core_ok/docs_ok/qe_ok (whether each repo exists as a git repo — docs_ok/qe_ok are false, not an error, if the path wasn't usable), operator_base_ref_ok/contrib_base_ref_ok/core_base_ref_ok (whether each base ref resolved), upstream_operator_version (from step 5), and error (a short human-readable summary of anything missing or broken, empty string if nothing is wrong).

Do NOT modify working trees or checkout branches.${DEVIATIONS_INSTRUCTION}`, {
  label: 'setup',
  phase: 'Setup',
  schema: SETUP_SCHEMA,
})

if (
  !setup ||
  !setup.operator_ok || !setup.contrib_ok || !setup.core_ok ||
  !setup.operator_base_ref_ok || !setup.contrib_base_ref_ok || !setup.core_base_ref_ok
) {
  const msg = `Setup phase failed — a required repo or base ref is missing.${setup && setup.error ? ' ' + setup.error : ''} Required repos: operator (${operatorPath}), collector-contrib (${contribPath}), collector-core (${corePath}) — run "make clone-repos" if any are missing. Required base refs: operator ${operatorBase}, collector-contrib ${contribBase}, collector-core ${coreBase}.`
  log(`ERROR: ${msg}`)
  return {
    report_markdown: `# Regression Detection — Failed\n\n${msg}`,
    summary_counts: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
  }
}

// Optional repos degrade gracefully rather than aborting — null out the path so the
// downstream ternaries that gate doc-validation/QE-coverage instructions see them as absent.
if (!setup.docs_ok) docsPath = ''
if (!setup.qe_ok) qePath = ''

// The report is named after the upstream version it was generated against, not the
// downstream base — fall back to the downstream version only if resolution failed,
// so the workflow never returns an unusable empty filename segment.
const upstreamOperatorVersion = setup.upstream_operator_version || operatorVersion

log(`Setup complete. Analyzing ${operatorBase} / ${contribBase} → upstream HEAD (${upstreamOperatorVersion}).${!setup.docs_ok ? ' Docs repo unavailable — skipping doc validation.' : ''}${!setup.qe_ok ? ' QE repo unavailable — QE coverage will show none.' : ''}`)

// Build the list of source dirs for code-diff and doc-validation agents
const contribComponents = components.filter(c => c.repo === 'collector_contrib')
const documentedComponents = components.filter(c => c.has_doc)
const componentSourceDirs = contribComponents.map(c => c.source_dir).join(', ')
const componentIds = components.map(c => {
  const parts = c.source_dir.split('/')
  return parts[parts.length - 1]
}).join(', ')

// ── Phase 3: Analyze ──
phase('Analyze')

const analysisMethods = []

if (method === 'all' || method === 'changelog') {
  analysisMethods.push({
    key: 'changelog',
    label: 'changelog-analysis',
    prompt: `You are analyzing changelogs for regressions in upstream OpenTelemetry repos.

TASK: Parse CHANGELOG.md files between the downstream base tags and upstream HEAD (origin/main). Identify breaking changes, deprecations, behavior changes, and significant bug fixes.

REPOS AND TAGS:
- Operator: ${operatorPath} — compare ${operatorBase}..origin/main
- Collector-contrib: ${contribPath} — compare ${contribBase}..origin/main
- Collector-core: ${corePath} — compare ${coreBase}..origin/main

INSTRUCTIONS:
1. For each repo, read CHANGELOG.md and identify entries between the base version and the current unreleased/latest.
2. Focus on: "Breaking changes" (CRITICAL), "Deprecation" (HIGH), "Enhancements" changing defaults (HIGH), "Bug fixes" with side effects (MEDIUM).
3. Check pending entries in .chloggen/*.yaml for early warnings.
4. Filter to only components in the downstream build. Component source directories:
   ${componentIds}

For each finding: severity, category, component, title, description, upstream PR link, recommended action.`,
  })
}

if (method === 'all' || method === 'code-diff') {
  analysisMethods.push({
    key: 'code-diff',
    label: 'code-diff-analysis',
    prompt: `You are analyzing code diffs for regressions in upstream OpenTelemetry repos.

TASK: Analyze git diffs between downstream base tags and upstream HEAD for breaking changes.

REPOS AND TAGS:
- Operator: ${operatorPath} — diff ${operatorBase}..origin/main
- Collector-contrib: ${contribPath} — diff ${contribBase}..origin/main
- Collector-core: ${corePath} — diff ${coreBase}..origin/main

INSTRUCTIONS:

1. OPERATOR API CHANGES: Run "git diff ${operatorBase}..origin/main -- apis/" in the operator repo.
   Look for removed/renamed CRD fields, changed validation markers, changed defaults.

2. COMPONENT CONFIG CHANGES: For each of these downstream component directories, diff config.go and factory.go in collector-contrib:
   ${componentSourceDirs}
   Run: git diff ${contribBase}..origin/main -- <dir>/config.go <dir>/factory.go
   Detect: added required fields, removed fields, renamed fields, changed defaults.

3. WEBHOOK CHANGES: Run "git diff ${operatorBase}..origin/main -- internal/webhook/" in the operator repo.

Classify: CRITICAL (removal/breaking), HIGH (behavior change), MEDIUM (renamed with alias), LOW (additive).`,
  })
}

if (method === 'all' || method === 'feature-gates') {
  analysisMethods.push({
    key: 'feature-gates',
    label: 'feature-gate-tracking',
    prompt: `You are tracking feature gate changes in upstream OpenTelemetry repos.

TASK: Detect feature gate promotions between downstream base and upstream HEAD.

REPOS AND TAGS:
- Operator: ${operatorPath} — compare ${operatorBase}..origin/main
- Collector-contrib: ${contribPath} — compare ${contribBase}..origin/main
- Collector-core: ${corePath} — compare ${coreBase}..origin/main

INSTRUCTIONS:
1. Search for feature gate registration changes in the diffs:
   git diff <base>..origin/main -- "*.go" | grep -A5 -B5 "featuregate\\|MustRegister"

2. For each gate change: identify gate ID, old/new stability (Alpha→Beta→Stable→Removed), affected component.
   Alpha→Beta: HIGH (default changes). Beta→Stable: CRITICAL. Removed: CRITICAL.

3. Filter to components in the downstream build:
   ${componentIds}

Return: gate ID, old level, new level, component, severity, recommended action.`,
  })
}

if (method === 'all' || method === 'issues') {
  analysisMethods.push({
    key: 'issues',
    label: 'github-issue-scanning',
    prompt: `You are scanning GitHub issues and PRs for regressions in upstream OpenTelemetry repos.

TASK: Search for bugs, regressions, and reverted PRs since the downstream base version.

INSTRUCTIONS:
1. Bug issues (use gh CLI):
   gh issue list --repo open-telemetry/opentelemetry-operator --label bug --state all --limit 30 --json number,title,state,createdAt,labels,url
   gh issue list --repo open-telemetry/opentelemetry-collector-contrib --label bug --state all --limit 30 --json number,title,state,createdAt,labels,url

2. Revert PRs:
   gh pr list --repo open-telemetry/opentelemetry-operator --state merged --search "revert in:title" --limit 20 --json number,title,mergedAt,url
   gh pr list --repo open-telemetry/opentelemetry-collector-contrib --state merged --search "revert in:title" --limit 20 --json number,title,mergedAt,url

3. Breaking change PRs:
   gh pr list --repo open-telemetry/opentelemetry-operator --state merged --label "breaking" --limit 20 --json number,title,mergedAt,url

Filter to components in the downstream build. If gh CLI unavailable, return empty findings with a note.`,
  })
}

if ((method === 'all' || method === 'doc-validation') && docsPath) {
  const docComponents = documentedComponents
    .filter(c => c.doc_file)
    .map(c => `- ${docsPath}/otel-collector/modules/${c.doc_file} → ${c.repo === 'collector_contrib' ? contribPath : corePath}/${c.source_dir}/config.go`)
    .join('\n')

  analysisMethods.push({
    key: 'doc-validation',
    label: 'doc-config-validation',
    prompt: `You are validating Red Hat build of OpenTelemetry documentation against current upstream code.

TASK: Check documented config options still exist upstream, and find new options not yet documented.

DOC-TO-SOURCE MAPPINGS (auto-discovered from manifest.yaml and doc globs):
${docComponents}

INSTRUCTIONS:
1. For the 6 most critical documented components (pick GA components with the most config surface):
   a. Read the .adoc file — extract config parameter names from YAML examples and parameter tables
   b. Read the corresponding config.go — extract struct fields via mapstructure tags
   c. Flag: documented fields removed upstream (DOC_STALE, HIGH), new required fields not in docs (DOC_MISSING, HIGH), new optional fields (DOC_MISSING, LOW)

2. Check component name drift: grep the docs for deprecated names (filelog vs file_log, kubeletstats vs kubelet_stats, loadbalancing vs load_balancing).

${docDrift.length > 0 ? `3. These doc files exist but NO matching component was found in the manifest (possible removed component):
${docDrift.map(d => `   - ${d.doc_file} (${d.type})`).join('\n')}
   Flag each as COMPONENT_DRIFT, MEDIUM severity.` : ''}

Return findings with category, component, field name, recommended action.`,
  })
}

// Test coverage runs as a separate agent with its own schema (not part of analysisMethods)
// so we can pass the full matrix to the report generator.

if (method === 'all' || method === 'dependencies') {
  analysisMethods.push({
    key: 'dependencies',
    label: 'dependency-tracking',
    prompt: `You are tracking dependency changes in upstream OpenTelemetry repos.

TASK: Find significant dependency version bumps between downstream base and upstream HEAD.

REPOS AND TAGS:
- Operator: ${operatorPath} — diff ${operatorBase}..origin/main
- Collector-core: ${corePath} — diff ${coreBase}..origin/main

INSTRUCTIONS:
1. Operator go.mod diff: git diff ${operatorBase}..origin/main -- go.mod
   Focus on: k8s.io/*, controller-runtime, collector/*, cert-manager, Go version.

2. Operator versions.txt diff: git diff ${operatorBase}..origin/main -- versions.txt

3. Collector-core go.mod diff: git diff ${coreBase}..origin/main -- go.mod

Severity: HIGH (major bumps, Go version), MEDIUM (minor in critical deps), LOW (patch).`,
  })
}

// Build the component list for the coverage agent
const componentList = components.map(c =>
  `${c.type}/${c.source_dir} (doc: ${c.has_doc})`
).join('\n')

// Build coverage agent prompt (runs separately from analysis agents to avoid positional splitting)
const coveragePrompt = (method === 'all' || method === 'test-coverage') ? {
  label: 'test-coverage-matrix',
  prompt: `You are building a complete test coverage matrix for all Red Hat build of OpenTelemetry components.

TASK: For EVERY component in the downstream build, determine its test coverage status across both upstream and QE test repos. Produce a full matrix — not just gaps.

REPOS:
- Upstream operator tests: ${operatorPath}/tests/
${qePath ? `- QE tests: ${qePath}/tests/` : '(QE test repo not available — set qe_test to "none" for all components)'}

ALL COMPONENTS IN BUILD (${components.length} total, auto-discovered from manifest.yaml):
${componentList}

INSTRUCTIONS:

1. FOR EACH COMPONENT, first resolve its actual OTel type key(s) — pipeline YAML references a component by the \`type:\` value from its metadata.yaml (e.g. "jaeger", "otlp", "batch", "k8s_attributes"), which is very often SHORTER than and different from the Go package/directory name ("jaeger" not "jaegerreceiver", "batch" not "batchprocessor", "k8s_attributes" not "k8sattributesprocessor"). Searching for the directory name instead of the real type key is the single most common cause of false "no test" results in this matrix — every component in a prior run of this check that used the directory name came back with zero matches even for components with 50-300+ real test references under their correct type key. Do not skip this step:

      grep -E "^(type|deprecated_type):" <repo>/<source_dir>/metadata.yaml

      (repo is collector-contrib or collector-core per the component's \`repo\` field). Collect both \`type\` (canonical) and \`deprecated_type\` (old alias, if present — some existing tests may still use it) as search candidates, alongside the directory name itself (test directories are inconsistently named — some use the short type, e.g. "filelog", others the full package name, e.g. "hostmetricsreceiver" — so try all candidates, don't assume one convention).

   a. Check for a DEDICATED test directory, trying every name candidate:
      ls -d ${operatorPath}/tests/e2e*/<candidate>/ 2>/dev/null
      If any candidate matches: upstream_test = "dedicated", upstream_test_path = the path found.

   b. If no dedicated test, check for IMPLICIT coverage — the component referenced as a pipeline entry (a bare YAML key like \`<type_key>:\`, a named instance like \`<type_key>/name:\`, or inside a receivers/processors/exporters/connectors list like \`[<type_key>]\`) — for every name candidate:
      grep -rlE "<type_key>(/[A-Za-z0-9_.-]+)?:|\\[.*\\b<type_key>\\b.*\\]" ${operatorPath}/tests/ 2>/dev/null | head -3
      If found: upstream_test = "implicit", upstream_test_path = first match.

   c. If nothing matches for any candidate: upstream_test = "none".

   d. Repeat a-c for QE tests:
      ${qePath ? `ls -d ${qePath}/tests/e2e-otel/<candidate>/ 2>/dev/null
      grep -rlE "<type_key>(/[A-Za-z0-9_.-]+)?:|\\[.*\\b<type_key>\\b.*\\]" ${qePath}/tests/ 2>/dev/null | head -3` : 'Skip — QE repo not available.'}

2. DETECT UPSTREAM TEST CHANGES since the downstream base:
   Run: git diff ${operatorBase}..origin/main --stat -- tests/
   in the operator repo.
   - Deleted test files: MEDIUM severity finding
   - New test files for documented components: informational
   - This diff also naturally surfaces new/deleted operator feature test suites (tests/e2e-*/) — note those too.

3. OPERATOR FEATURES (not collector components — operator-level capabilities like target allocator, OpAMP bridge, sidecar injection, autoscaling, etc.):

   a. Discover the feature list dynamically:
      ls -d ${operatorPath}/tests/e2e-*/
      Exclude the generic harness dirs: "e2e" (bare), "test-e2e-apps", "step-templates".
      Each remaining "e2e-<name>" directory IS a dedicated upstream test suite for that feature — so upstream_test is always "dedicated" for every discovered feature (that's expected, not a bug).

   b. For each discovered feature, derive a short human-readable name and one-line description from the directory name (e.g. "e2e-targetallocator" -> feature "target-allocator", "e2e-opampbridge" -> feature "opamp-bridge", "e2e-autoscale" -> feature "autoscaling").

   c. For each feature, check downstream QE coverage. Derive 2-4 plausible search terms from the feature name AND its description, not a single literal keyword — feature names are paraphrased and rarely appear verbatim in test file names or content (e.g. for "automatic-rbac": try "rbac", "ClusterRole", "leader.elect", "privilege"; for "autoscaling": try "autoscal", "HorizontalPodAutoscaler", "hpa"; for "target-allocator-mtls": try "targetallocator.*mtls", "ta.*mtls", "target-allocator-collector-mtls"):
      ${qePath ? `grep -rliE "<term1>|<term2>|<term3>" ${qePath}/tests/ 2>/dev/null | head -5
      Search across ${qePath}/tests/ (not just tests/e2e-otel/, which is component-focused — operator-feature tests may live in other suites under tests/), but stay within that tests/ tree. A match only counts as coverage if it's an actual test file or test fixture (a Go test file, a Ginkgo/Chainsaw test spec, a test-case YAML) — a mention in a README, doc, comment, or CI pipeline config does NOT count as coverage.
      If a clear match exists: qe_test = "dedicated" (a directory/file clearly dedicated to this feature) or "implicit" (feature mentioned within a broader test). Only conclude qe_test = "none" after trying multiple search terms — a single miss doesn't mean the feature is untested.` : 'QE repo not available — set qe_test to "none" for all features.'}

      IMPORTANT — do not treat "no QE test" alone as a coverage gap: the product build runs BOTH the upstream operator's own e2e-* suites AND the downstream QE suite, so a feature with dedicated upstream coverage (true for every feature discovered in step a) is already exercised by the product's own test run even when QE has no test of its own. Do NOT add a test_change_finding (or any other finding) recommending "add a QE test for <feature>" just because qe_test is "none" while upstream_test is "dedicated" or "implicit" — that is expected, not a gap. Only raise a finding for a feature when BOTH upstream_test and qe_test are "none".

   d. Return operator_feature_matrix (one entry per discovered feature) and feature_summary (total_features, with_qe_test, with_no_test).

4. Return:
   - coverage_matrix: one entry per component with all fields
   - summary: counts of total, with_upstream_test, with_qe_test, with_any_test, with_no_test, documented_with_no_test
   - test_change_findings: any test deletion/modification findings
   - operator_feature_matrix and feature_summary as described above`,
} : null

// Run analysis agents and coverage agent separately to avoid positional result splitting
const analysisResults = analysisMethods.length > 0
  ? await parallel(analysisMethods.map(m => () =>
      agent(m.prompt + DEVIATIONS_INSTRUCTION, { label: m.label, phase: 'Analyze', schema: FINDINGS_SCHEMA })
    ))
  : []

const coverageResult = coveragePrompt
  ? await agent(coveragePrompt.prompt + DEVIATIONS_INSTRUCTION, { label: coveragePrompt.label, phase: 'Analyze', schema: COVERAGE_SCHEMA })
  : null

log(`Analysis complete. ${analysisMethods.length} regression methods + ${coverageResult ? '1 coverage matrix' : 'no coverage'} returned.`)

// ── Phase 4: Synthesize ──
phase('Synthesize')

// Merge regression findings from analysis methods
const allFindings = analysisResults
  .map((r, i) => ({ result: r, method: analysisMethods[i] }))
  .filter(entry => entry.result)
  .flatMap(entry => (entry.result.findings || []).map(f => ({
    ...f,
    detection_method: entry.method.key,
  })))

// Merge test change findings from coverage agent
if (coverageResult && coverageResult.test_change_findings) {
  coverageResult.test_change_findings.forEach(f => {
    allFindings.push({ ...f, detection_method: 'test-coverage' })
  })
}

// Findings carry free text sourced from upstream changelogs, GitHub issues, and PR
// titles. It's assembled here (not escaped) since it only ever flows into the
// report-generation prompt (plain text, read by the model) and the Markdown report —
// no HTML rendering happens anywhere in this workflow.
const findingsSummary = allFindings.map(f =>
  `[${f.severity}] [${f.category}] ${f.component}: ${f.title} (via: ${f.detection_method})`
).join('\n')

// Coverage data needed by buildRemediationMarkdown — kept as raw structured data (not
// pre-rendered strings) since the Markdown renderer builds its own sections from it.
const coverageMatrix = coverageResult ? coverageResult.coverage_matrix : []
const coverageSummary = coverageResult ? coverageResult.summary : null
const operatorFeatureMatrix = coverageResult ? (coverageResult.operator_feature_matrix || []) : []
const featureSummary = coverageResult ? coverageResult.feature_summary : null

// Collected from every agent's self-reported `deviations` (see DEVIATIONS_INSTRUCTION)
// into the report's "Skill Improvement Recommendations" section — a running record of
// where this workflow's own instructions didn't match reality, for whoever maintains it.
const allDeviations = [
  ...(discovery.deviations || []).map(d => `[discover] ${d}`),
  ...(setup.deviations || []).map(d => `[setup] ${d}`),
  ...analysisResults.flatMap((r, i) => (r && r.deviations || []).map(d => `[${analysisMethods[i].key}] ${d}`)),
  ...((coverageResult && coverageResult.deviations) || []).map(d => `[test-coverage] ${d}`),
]

const report = await agent(`You are synthesizing regression detection findings into structured data. Do NOT write Markdown yourself — a separate, non-agent step renders the report mechanically from the structured data you return here. Your job is dedup, classification, and grouping only.

DOWNSTREAM BASE: operator ${operatorBase} (v${operatorVersion}), collector ${contribBase}
UPSTREAM TARGET: origin/main
RELEASE BRANCH: ${releaseBranch}
COMPONENTS IN BUILD: ${components.length} (discovered from manifest.yaml)
DOCUMENTED COMPONENTS: ${documentedComponents.length}
${docDrift.length > 0 ? `DOCS WITHOUT MATCHING BUILD COMPONENT: ${docDrift.length}` : ''}

ALL FINDINGS (${allFindings.length} total):
${findingsSummary || '(no findings)'}

DETAILED FINDINGS:
${JSON.stringify(allFindings, null, 2)}

${coverageSummary ? `COMPONENT TEST COVERAGE SUMMARY:
- Total components: ${coverageSummary.total_components}
- With upstream test: ${coverageSummary.with_upstream_test}
- With QE test: ${coverageSummary.with_qe_test}
- With any test: ${coverageSummary.with_any_test}
- With NO test: ${coverageSummary.with_no_test}
- Documented but no test: ${coverageSummary.documented_with_no_test || 'N/A'}` : '(no component coverage data)'}

${featureSummary ? `OPERATOR FEATURE COVERAGE SUMMARY:
- Total features: ${featureSummary.total_features}
- With QE test: ${featureSummary.with_qe_test}
- With NO test: ${featureSummary.with_no_test}` : '(no operator feature coverage data)'}

INSTRUCTIONS:

1. Deduplicate findings (same issue from multiple methods → keep highest severity, merge detection_methods).
2. Sort by severity: CRITICAL → HIGH → MEDIUM → LOW.
3. Assign each finding a stable short ID per severity (CRIT-1, CRIT-2, HIGH-1, HIGH-2, MED-1, LOW-1, ...).
4. Return findings_rendered (the flat deduplicated array with IDs from step 3) and summary_counts (counts per severity + total).`, {
  label: 'report-generator',
  phase: 'Synthesize',
  schema: REPORT_SCHEMA,
})

if (!report || !report.findings_rendered || !report.summary_counts) {
  log('ERROR: Synthesize phase failed — report-generator agent returned no usable result. Aborting.')
  return {
    report_markdown: '# Regression Detection — Failed\n\nSynthesize phase failed. The report-generator agent did not return usable structured output.',
    summary_counts: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
  }
}

const reportMarkdown = buildRemediationMarkdown(report.findings_rendered, {
  operatorBase,
  operatorVersion,
  upstreamOperatorVersion,
  contribBase,
  releaseBranch,
  componentsCount: components.length,
  documentedCount: documentedComponents.length,
  summaryCounts: report.summary_counts,
  coverageMatrix,
  operatorFeatureMatrix,
  docDrift,
  deviations: allDeviations,
})

return { report_markdown: reportMarkdown, summary_counts: report.summary_counts, operator_version: upstreamOperatorVersion }
