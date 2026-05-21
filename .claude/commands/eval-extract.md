---
description: "Run extraction eval with a custom URL. Usage: /eval-extract <url>"
allowed-tools: Bash, Read, Write, WebFetch, Agent
---

# Extraction Eval with Custom URL

Run an LLM-as-judge extraction evaluation using a user-provided URL.

## Arguments

`$ARGUMENTS` should be a URL to extract from. If empty, use the default URL from `evals/cases/extraction-blog-post.md`.

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

## Step 1: Fetch Content

Use `WebFetch` to retrieve the URL. Extract the main article text — all people, organizations, technologies, concepts. Note the title and approximate word count.

## Step 2: Extract to Vault

Read through the fetched content and use the synapse-mcp tools directly to build the graph:

**Entities** — call `create_node` for each entity:
- Aim for 8–15 entities (scale with article length)
- Use specific types: `concept`, `technology`, `organization`, `person`
- Every entity gets a descriptive label

**Relationships** — call `create_edge` for each meaningful relationship:
- Labels should be specific: `uses`, `built_by`, `introduces`, `extends`
- Every entity should connect to at least one other

Record all created node IDs and edge IDs as you go.

## Step 3: Snapshot the Extraction

Query the vault to build a complete picture of what was extracted:
- `get_graph_overview` — total counts
- `search_nodes` for 3–4 key entity names — confirm they're findable
- `get_node_details` on 2–3 hub entities — inspect edge connectivity
- `find_similar_entities` on 2–3 names — check for duplicates

Collect all results into a structured snapshot.

## Step 4: LLM-as-Judge Grading

Spawn a **subagent** (Agent tool) with this prompt structure:

> You are an extraction quality evaluator. You will receive:
> 1. The original article content
> 2. The extraction snapshot (entities, edges, search results, duplicate checks)
>
> Grade the extraction on these dimensions using a 1–5 star scale:
>
> | Dimension | What to assess |
> |-----------|----------------|
> | **Coverage** | Do the extracted entities capture the article's key topics? Are important concepts missing? |
> | **Specificity** | Are entity types precise (concept/technology/person/org), not generic? Are edge labels meaningful? |
> | **Structure** | Is the graph well-connected? Do relationships reflect the article's actual claims? Any orphan nodes? |
> | **Deduplication** | Were near-duplicates avoided? Is the entity set clean? |
> | **Summarization** | Could someone reconstruct the article's main argument from the graph alone? |
>
> For each dimension:
> - Assign 1–5 stars (1=poor, 3=acceptable, 5=excellent)
> - Write 1–2 sentences of evidence
>
> Then give an **overall score** (1–5 stars) and a one-paragraph summary.
>
> Return your evaluation as JSON:
> ```json
> {
>   "dimensions": {
>     "coverage": { "stars": 4, "evidence": "..." },
>     "specificity": { "stars": 5, "evidence": "..." },
>     "structure": { "stars": 3, "evidence": "..." },
>     "deduplication": { "stars": 5, "evidence": "..." },
>     "summarization": { "stars": 4, "evidence": "..." }
>   },
>   "overall": { "stars": 4, "summary": "..." }
> }
> ```

Pass the full article text and the full extraction snapshot to the subagent. Parse its JSON response.

## Step 5: Write Results

Write to `evals/results/{timestamp}/extraction-custom-url.json`:

```json
{
  "case": "extraction-custom-url",
  "source_url": "<url>",
  "timestamp": "...",
  "status": "completed",
  "duration_ms": 12000,
  "created": { "nodes": 14, "edges": 13 },
  "entities": ["Neo4j", "Agent Memory System", "..."],
  "grading": {
    "dimensions": { "coverage": { "stars": 4, "evidence": "..." }, "..." },
    "overall": { "stars": 4, "summary": "..." }
  },
  "notes": "Source URL, article title, any surprises"
}
```

## Step 6: Generate Report

```bash
node evals/scripts/generate-report.cjs evals/results
open evals/results/report.html
```

Print a brief text summary with star ratings.
