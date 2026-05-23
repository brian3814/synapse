---
name: write-tools-crud
category: write-tools
requires: [synapse-mcp, allow-write]
---

# Write Tools CRUD Operations

Test that the core write tools (create, update, delete, merge) work correctly and that the graph stays consistent.

## Prerequisites

- synapse-mcp connected with `--allow-write`

## Steps

1. **Record baseline.** Call `get_graph_overview` and note current counts.

2. **Create test nodes.** Create these nodes:
   - `create_node` name="Eval Test Person" type="person" label="A fictional person for testing"
   - `create_node` name="Eval Test Company" type="organization" label="A fictional company for testing"
   - `create_node` name="Eval Test Concept" type="concept" label="A fictional concept for testing"

3. **Verify creation.** Call `search_nodes` query="Eval Test" — all 3 should appear.

4. **Create edges.** 
   - `create_edge` from "Eval Test Person" to "Eval Test Company" label="works_at"
   - `create_edge` from "Eval Test Person" to "Eval Test Concept" label="studies"

5. **Verify edges.** Call `get_node_details` on the person node — should show 2 edges.

6. **Update a node.** Call `update_node` on "Eval Test Person" with label="Updated label for testing".

7. **Verify update.** Call `get_node_details` again — label should be updated.

8. **Create a duplicate for merge test.**
   - `create_node` name="Eval Test Person (Duplicate)" type="person" label="Duplicate for merge testing"
   - `create_edge` from "Eval Test Person (Duplicate)" to "Eval Test Company" label="founded"

9. **Merge nodes.** Call `merge_nodes` with primary="Eval Test Person" secondary="Eval Test Person (Duplicate)".

10. **Verify merge.** Call `get_node_details` on the primary — should now have 3 edges (original 2 + transferred "founded" edge). The duplicate node should not appear in `search_nodes`.

11. **Delete an edge.** Delete the "studies" edge from the person node.

12. **Verify edge deletion.** `get_node_details` on person — should show 2 edges now.

13. **Delete nodes.** Delete all test nodes.

14. **Verify deletion.** `search_nodes` query="Eval Test" should return no results.

## Evaluation Criteria

- [ ] All 3 nodes created successfully (search returns 3 results for "Eval Test")
- [ ] Both edges created and visible on the person node
- [ ] Node update changes the label (verified via get_node_details)
- [ ] After merge: duplicate node is gone, primary node has all edges from both nodes
- [ ] After merge: "founded" edge is now connected to the primary node
- [ ] Edge deletion removes only the targeted edge
- [ ] After full cleanup: search for "Eval Test" returns 0 results
- [ ] Graph overview node/edge counts return to baseline after cleanup

## Cleanup

Steps 13-14 above handle cleanup as part of the test flow.
