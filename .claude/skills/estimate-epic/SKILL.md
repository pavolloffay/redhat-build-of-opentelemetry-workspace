---
name: estimate-epic
description: >
  Size TRACING Jira Epics in sprint units based on the total story points
  (days) of their child issues. 1 epic SP = 1 sprint = 3 weeks (15 working
  days). Can size specific Epics, or bulk-size all unsized Epics.
  Also invoked automatically after creating a new Epic.
argument-hint: "[TRACING-1234 ...] (omit to size all unsized Epics)"
---

# Size Epics by Sprint Count

## Overview

Set story points on TRACING Epics based on the sum of child issue story
points. Child SP represent **days of work**. Epic SP represent **sprints of
work** (1 sprint = 3 weeks = 15 working days).

## Usage

```
/estimate-epic TRACING-1234              # size one Epic
/estimate-epic TRACING-1234 TRACING-1235 # size multiple Epics
/estimate-epic                           # size ALL unsized open Epics
```

Also invoked automatically after creating a new Epic.

## Conversion

| Child SP (days) | Epic SP (sprints) |
|-----------------|-------------------|
| 1–15            | 1                 |
| 16–30           | 2                 |
| 31–45           | 3                 |
| 46–60           | 4                 |
| 61–75           | 5                 |

**Formula:** `epic_sp = ceil(total_child_sp / 15)`

If the result exceeds 5, warn the user that the Epic should probably be split.

## Jira Field Reference

- **Story Points field:** `customfield_10028` (number, float — used on both Epics and child issues)
- **Project:** `TRACING`
- **Epic Link field for JQL:** `"Epic Link"` or `parent`
- **Sprint duration:** 3 weeks (15 working days)
- **Cloud ID**: `redhat.atlassian.net`

## Workflow

### Step 1: Determine target Epics

**If arguments provided:** Extract all `TRACING-XXXX` keys from the arguments.

**If no arguments:** Query Jira for all unsized open Epics:
```
project = TRACING AND issuetype = Epic AND resolution = Unresolved AND "Story Points" is EMPTY
```

### Step 2: For each Epic

#### 2a. Fetch child issues and their story points

Use `mcp__atlassian__searchJiraIssuesUsingJql` with:
- `jql`: `"Epic Link" = TRACING-XXXX OR parent = TRACING-XXXX`
- `fields`: `["summary", "customfield_10028", "issuetype"]`
- `maxResults`: 100

If more than 100 children, paginate.

#### 2b. Sum story points and convert to sprints

- Sum `customfield_10028` across all children (this total is in **days**)
- Count children with null/missing SP separately (for warning)
- Convert: `epic_sp = ceil(total_child_sp / 15)`

#### 2c. Set story points on the Epic

Use `mcp__atlassian__editJiraIssue` with:
- `cloudId`: `redhat.atlassian.net`
- `issueIdOrKey`: the Epic key
- `fields`: `{"customfield_10028": <epic_sp>}`

### Step 3: Report to user

For each Epic, report one line:
- Epic key and summary
- Child count, total child SP (days), and epic SP (sprints)
- If any children lack SP: warn with count (e.g., "3 of 12 children unpointed")
- If epic SP > 5: warn that the Epic should be split

For bulk operations, also report a summary line at the end
(e.g., "Sized 8 Epics: total 24 sprints of work").
