# Synapse Evals

Lightweight evaluation framework using Claude Code as the test runner. Each eval case is a markdown file describing what to do and what a good result looks like. Results go into timestamped directories with an HTML dashboard report.

## Skills

| Skill | Usage | Description |
|---|---|---|
| `/eval-run` | `/eval-run [case\|category\|all]` | Run eval cases and grade results |
| `/eval-extract` | `/eval-extract <url>` | Extraction eval with a custom URL |
| `/eval-report` | `/eval-report [timestamp\|latest]` | Generate HTML dashboard from results |

### Examples

```bash
/eval-run extraction-blog-post    # run a single case
/eval-run extraction              # run all extraction cases
/eval-run all                     # run everything
/eval-extract https://example.com/article   # extract from custom URL
/eval-report                      # generate HTML report for latest run
/eval-report 2026-05-20_103045    # report for a specific run
```

## Prerequisites

- Synapse desktop app running with a vault open, OR synapse-mcp configured as an MCP server
- For write cases: `--allow-write` flag on synapse-mcp

## Directory Structure

```
evals/
├── README.md
├── cases/                          ← eval case definitions (you author these)
│   ├── extraction-blog-post.md
│   ├── write-tools-crud.md
│   ├── write-tools-notes.md
│   ├── chat-graph-query.md
│   └── rag-search-quality.md
├── scripts/
│   └── generate-report.js          ← HTML report generator
└── results/                         ← auto-generated, gitignored
    └── 2026-05-20_103045/           ← timestamped run directory
        ├── extraction-blog-post.json
        ├── write-tools-crud.json
        └── report.html              ← visual dashboard
```

## Writing Eval Cases

Each case is a markdown file in `evals/cases/` with frontmatter + structured sections.

### Frontmatter

```yaml
---
name: case-name              # kebab-case identifier
category: extraction         # extraction | chat | rag | memory | write-tools
requires: [synapse-mcp]      # prerequisites: synapse-mcp, allow-write, embeddings
---
```

### Required Sections

**Steps** — Concrete actions for the agent to execute. Reference MCP tools by name. Be specific about inputs.

**Evaluation Criteria** — Checkable assertions as `- [ ]` checkboxes. Good criteria:
- "At least 5 entities extracted" (countable)
- "No two nodes have the same name" (verifiable)
- "Edge labels are descriptive, not generic" (inspectable)

**Cleanup** (optional) — Steps to remove test data after the eval.

### Tips

- **Start with 3-5 cases.** Cover the main workflows.
- **Use real content.** Link to actual blog posts, not synthetic text.
- **Tighten criteria over time.** If a criterion always passes, it's too easy.

## HTML Report

The report (`report.html`) is a self-contained dashboard with:
- **Summary cards**: Overall pass rate, criteria counts, cases run/skipped
- **Category breakdown**: Pass rates per category (extraction, write-tools, etc.)
- **Case details**: Expandable cards with per-criterion pass/fail, evidence, step logs
- **Color coding**: Green (>90%), yellow (70-90%), red (<70%)

Generated via `node evals/scripts/generate-report.js <run-dir>` or the `/eval-report` skill.

## Result JSON Schema

Each case produces a JSON file:

```json
{
  "case": "extraction-blog-post",
  "category": "extraction",
  "timestamp": "2026-05-20T10:30:00Z",
  "status": "completed",
  "duration_ms": 12000,
  "baseline": { "nodes": 42, "edges": 67 },
  "steps": [
    { "index": 1, "description": "Fetch blog post", "tool": "WebFetch", "success": true, "summary": "Retrieved 2400 words" }
  ],
  "criteria": [
    { "text": "At least 8 entities extracted", "passed": true, "evidence": "Found 11 entities" }
  ],
  "summary": { "passed": 7, "failed": 1, "total": 8, "pass_rate": 0.875 },
  "notes": ""
}
```
