---
description: "Run eval cases against a Synapse vault. Usage: /eval-run [case-name|category|all]"
allowed-tools: Bash, Read, Write, WebFetch, Agent
---

# Synapse Eval Runner

Execute eval cases against a Synapse vault using native MCP tools and LLM-as-judge grading.

## Arguments

`$ARGUMENTS` determines what to run:

- **Case name** (e.g., `extraction-blog-post`) → run that single case
- **Category** (e.g., `extraction`, `write-tools`, `chat`, `rag`) → all cases matching that prefix
- **`all`** → every `.md` file in `evals/cases/`
- **Empty** → list available cases and prompt

## Step 0: MCP Connection Gate

**Before anything else**, verify that synapse-mcp tools are available as native MCP tools in this Claude Code session.

Search for tools matching `synapse` or `create_node` using ToolSearch. If tools like `mcp__synapse__create_node`, `mcp__synapse__search_nodes`, etc. are found, proceed.

**If synapse-mcp is NOT connected:**
1. Print a clear error:
   ```
   ❌ Synapse MCP server is not connected to this Claude Code session.

   To connect it, add synapse-mcp to your Claude Code MCP settings:
   /mcp → Add Server → "synapse" → streamable-http → http://127.0.0.1:19876/mcp

   Or run the standalone CLI as an MCP server:
   synapse-mcp --vault <path> --allow-write
   ```
2. **Stop. Do not proceed with the eval.**

## Per-Case Execution

For each case:

### 1. Parse the Case
Read `evals/cases/{name}.md`. Parse frontmatter (`requires`, `category`) and body sections (Steps, Evaluation Criteria).

### 2. Baseline Snapshot
Call `get_graph_overview` to record current node/edge counts before the eval mutates the graph.

### 3. Execute Steps
Follow the **Steps** section of the case. Use the synapse-mcp tools directly:
- `create_node`, `create_edge` for writes
- `search_nodes`, `get_node_details`, `get_neighbors` for reads
- `find_similar_entities` for dedup checks
- `WebFetch` for fetching external content

Record every tool call result.

### 4. Snapshot the Results
After executing steps, query the vault to build a complete picture:
- `get_graph_overview` — post-execution counts
- `search_nodes` for key entities — confirm findability
- `get_node_details` on hub nodes — inspect connectivity
- `find_similar_entities` — check for duplicates

### 5. LLM-as-Judge Grading
Spawn a **subagent** with the original case criteria, the source content, and the extraction snapshot.

The subagent grades on a **1–5 star scale** across dimensions relevant to the case type:

**Extraction cases:**
| Dimension | What to assess |
|-----------|----------------|
| Coverage | Key topics captured? Important concepts missing? |
| Specificity | Types precise? Edge labels meaningful? |
| Structure | Well-connected graph? Relationships reflect source? |
| Deduplication | Near-duplicates avoided? Clean entity set? |
| Summarization | Could someone reconstruct the source's argument from the graph? |

**Write-tool cases:** Correctness, idempotency, error handling
**Chat/RAG cases:** Retrieval relevance, answer grounding, hallucination

The subagent returns structured JSON with per-dimension stars + evidence and an overall score.

### 6. Write Results
Write to `evals/results/{timestamp}/{case-name}.json`:

```json
{
  "case": "extraction-blog-post",
  "category": "extraction",
  "timestamp": "...",
  "status": "completed",
  "duration_ms": 12000,
  "baseline": { "nodes": 145, "edges": 230 },
  "created": { "nodes": 14, "edges": 13 },
  "grading": {
    "dimensions": {
      "coverage": { "stars": 4, "evidence": "..." },
      "specificity": { "stars": 5, "evidence": "..." }
    },
    "overall": { "stars": 4, "summary": "..." }
  },
  "notes": ""
}
```

### 7. Cleanup (if specified)
If the case has a **Cleanup** section and the vault is shared (not isolated), execute cleanup. Skip for isolated vaults.

## After All Cases

### Generate Report
```bash
node evals/scripts/generate-report.cjs evals/results
open evals/results/report.html
```

Print a text summary with star ratings:
```
Run: 2026-05-21 | Vault: connected via MCP
──────────────────────────────────────────────
Case                        Stars   Status
extraction-blog-post        ★★★★☆   COMPLETED
write-tools-crud            ★★★★★   COMPLETED
──────────────────────────────────────────────
Overall: ★★★★☆ (4.2/5)
Report: evals/results/report.html
```
