---
name: graph-structure-integrity
category: write-tools
requires: [synapse-mcp, allow-write]
---

# Graph Structure Integrity After Complex Operations

Test that the graph remains consistent after a complex sequence of create, merge, update, and delete operations. Validates that merges transfer edges correctly, deletes cascade to edges, and final cleanup restores exact baseline counts.

## Prerequisites

- synapse-mcp connected with `--allow-write`

## Steps

1. **Record baseline.** Call `get_graph_overview` and note exact node count and edge count.

2. **Create a hub-and-spoke structure.** Create 4 nodes and 4 edges:
   - `create_node` name="EvalHub Central" type="concept" label="Hub node for structure integrity test"
   - `create_node` name="EvalHub Spoke A" type="person" label="Spoke A person node"
   - `create_node` name="EvalHub Spoke B" type="organization" label="Spoke B organization node"
   - `create_node` name="EvalHub Spoke C" type="technology" label="Spoke C technology node"
   - `create_edge` from "EvalHub Central" to "EvalHub Spoke A" label="employs"
   - `create_edge` from "EvalHub Central" to "EvalHub Spoke B" label="partners_with"
   - `create_edge` from "EvalHub Central" to "EvalHub Spoke C" label="uses"
   - `create_edge` from "EvalHub Spoke A" to "EvalHub Spoke B" label="works_at"

3. **Verify hub-and-spoke.** Call `get_graph_overview` — should show baseline+4 nodes and baseline+4 edges. Call `get_neighbors` on "EvalHub Central" — should return Spokes A, B, and C.

4. **Create a duplicate for merge test.** 
   - `create_node` name="EvalHub Spoke A Copy" type="person" label="Duplicate of Spoke A for merge test"
   - `create_edge` from "EvalHub Spoke A Copy" to "EvalHub Central" label="employed_by"

5. **Verify pre-merge state.** Call `get_graph_overview` — should show baseline+5 nodes and baseline+5 edges.

6. **Merge duplicate into original.** Call `merge_nodes` with primary="EvalHub Spoke A" and secondary="EvalHub Spoke A Copy".

7. **Verify merge results.**
   - `search_nodes` query="EvalHub Spoke A Copy" — should return no results (duplicate is gone)
   - `get_node_details` on "EvalHub Spoke A" — should have the "employed_by" edge transferred from the duplicate
   - `get_graph_overview` — should show baseline+4 nodes (not +5) and baseline+5 edges

8. **Update hub node.** Call `update_node` on "EvalHub Central" with label="Updated Hub Label".

9. **Verify update.** Call `get_node_details` on "EvalHub Central" — label should be "Updated Hub Label".

10. **Delete Spoke C.** Call `delete_node` on "EvalHub Spoke C".

11. **Verify deletion and edge cascade.** Call `get_graph_overview` — node count should be baseline+3. Edge count should have decreased (the "uses" edge from hub to Spoke C should be gone). Call `search_nodes` query="EvalHub Spoke C" — should return no results.

12. **Verify subgraph after deletion.** Call `get_subgraph` starting from "EvalHub Central" with depth=1. Only "EvalHub Spoke A" and "EvalHub Spoke B" should appear — not the deleted Spoke C.

13. **Cleanup remaining nodes.** Delete "EvalHub Spoke A", "EvalHub Spoke B", and "EvalHub Central" using `delete_node`.

14. **Verify full cleanup.** Call `get_graph_overview` — node count and edge count should match the original baseline exactly. Call `search_nodes` query="EvalHub" — should return no results.

## Evaluation Criteria

- [ ] Hub-and-spoke structure created correctly (4 nodes, 4 edges verified via `get_graph_overview`)
- [ ] `get_neighbors` on hub returns all 3 spoke nodes before any modifications
- [ ] Merge removes the secondary node ("EvalHub Spoke A Copy" no longer found in search)
- [ ] Merge transfers edges from secondary to primary ("employed_by" edge now on Spoke A)
- [ ] After merge, node count is baseline+4 (not baseline+5)
- [ ] `update_node` persists label change (verified via `get_node_details`)
- [ ] Deleting Spoke C also removes its edges (edge count decreases)
- [ ] `get_subgraph` from hub after deletion returns only Spoke A and Spoke B (not deleted Spoke C)
- [ ] After full cleanup, node count matches original baseline exactly
- [ ] After full cleanup, edge count matches original baseline exactly

## Cleanup

Steps 13-14 above handle cleanup as part of the test flow. If the eval fails partway through, manually search for "EvalHub" and delete any remaining nodes.
