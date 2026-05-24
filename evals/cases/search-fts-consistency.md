---
name: search-fts-consistency
category: rag
requires: [synapse-mcp, allow-write]
---

# Search FTS Consistency

Test that FTS5 full-text search stays consistent through bulk creation, updates, and deletions. Seeds 5 nodes sharing a common prefix, then verifies exact match, suffix match, type filtering, rename propagation, prefix matching, and deletion cleanup all behave correctly.

## Prerequisites

- synapse-mcp connected with `--allow-write`

## Steps

1. **Record baseline.** Call `get_graph_overview` and note current node count. Call `search_nodes` query="EvalSearch" to confirm zero pre-existing matches.

2. **Bulk-create 5 nodes with shared prefix.** Create these nodes:
   - `create_node` name="EvalSearch Alpha" type="person" label="First search-consistency test entity"
   - `create_node` name="EvalSearch Beta" type="concept" label="Second search-consistency test entity"
   - `create_node` name="EvalSearch Gamma" type="technology" label="Third search-consistency test entity"
   - `create_node` name="EvalSearch Delta" type="organization" label="Fourth search-consistency test entity"
   - `create_node` name="EvalSearch Epsilon" type="concept" label="Fifth search-consistency test entity"

3. **Verify full-prefix search.** Call `search_nodes` query="EvalSearch" — all 5 nodes should be returned.

4. **Verify suffix search returns exactly 1.** Call `search_nodes` query="Alpha" — only "EvalSearch Alpha" should appear. Repeat for "Gamma" — only "EvalSearch Gamma" should appear.

5. **Verify type filtering.** Call `get_nodes_by_type` for each type used:
   - type="person" — should include "EvalSearch Alpha"
   - type="concept" — should include "EvalSearch Beta" and "EvalSearch Epsilon"
   - type="technology" — should include "EvalSearch Gamma"
   - type="organization" — should include "EvalSearch Delta"

6. **Rename a node and verify FTS update.** Call `update_node` on "EvalSearch Alpha" with name="EvalSearch Omega". Then:
   - `search_nodes` query="Alpha" — should return 0 results
   - `search_nodes` query="Omega" — should return exactly 1 result ("EvalSearch Omega")
   - `search_nodes` query="EvalSearch" — should still return 5 results total

7. **Verify partial prefix matching.** Call `search_nodes` query="Eval" — all 5 nodes should still appear (FTS prefix matching).

8. **Delete one node and verify index update.** Delete "EvalSearch Delta" using `delete_node`. Then call `search_nodes` query="EvalSearch" — should return exactly 4 results, and "EvalSearch Delta" should not be among them.

9. **Clean up remaining nodes.** Delete all 4 remaining test nodes ("EvalSearch Omega", "EvalSearch Beta", "EvalSearch Gamma", "EvalSearch Epsilon") using `delete_node`.

10. **Verify search is empty.** Call `search_nodes` query="EvalSearch" — should return 0 results. Call `get_graph_overview` and confirm node count matches the baseline from step 1.

## Evaluation Criteria

- [ ] All 5 nodes created successfully (search for "EvalSearch" returns exactly 5)
- [ ] Suffix search for "Alpha" returns exactly 1 result
- [ ] `get_nodes_by_type` returns correct nodes for each type (person=1, concept=2, technology=1, organization=1)
- [ ] After rename: search for "Alpha" returns 0, search for "Omega" returns 1
- [ ] After rename: search for "EvalSearch" still returns 5 (rename preserved the prefix)
- [ ] Partial prefix search for "Eval" returns all 5 nodes
- [ ] After deleting one node: search for "EvalSearch" returns exactly 4
- [ ] After full cleanup: search for "EvalSearch" returns 0 results
- [ ] Graph overview node count returns to baseline after cleanup

## Cleanup

Steps 8-10 above handle cleanup as part of the test flow. If the eval is interrupted, manually delete any nodes whose name starts with "EvalSearch".
