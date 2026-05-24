---
name: edge-crud-neighbors
category: write-tools
requires: [synapse-mcp, allow-write]
---

# Edge CRUD with Neighbor Traversal

Test edge creation, deletion, and duplicate behavior, verifying correctness through `get_neighbors` and `get_node_details` at each step. Ensures edge labels are preserved, multiple edges between the same pair of nodes are supported, and targeted deletion does not affect other edges.

## Prerequisites

- synapse-mcp connected with `--allow-write`

## Steps

1. **Record baseline.** Call `get_graph_overview` and note current node and edge counts.

2. **Create test nodes.** Create 3 nodes:
   - `create_node` name="Edge Test - Albert Einstein" type="person" label="Theoretical physicist"
   - `create_node` name="Edge Test - University of Zurich" type="organization" label="Swiss public research university"
   - `create_node` name="Edge Test - General Relativity" type="concept" label="Theory of gravitation"

3. **Create 3 edges.** Create edges with distinct labels:
   - `create_edge` from "Edge Test - Albert Einstein" to "Edge Test - University of Zurich" label="studied_at"
   - `create_edge` from "Edge Test - Albert Einstein" to "Edge Test - General Relativity" label="researched"
   - `create_edge` from "Edge Test - University of Zurich" to "Edge Test - General Relativity" label="affiliated_with"

4. **Verify neighbors on person node.** Call `get_neighbors` on the Einstein node. Should return exactly 2 neighbors: University of Zurich and General Relativity.

5. **Verify neighbors on concept node.** Call `get_neighbors` on the General Relativity node. Should return exactly 2 neighbors: Albert Einstein and University of Zurich.

6. **Verify edge details.** Call `get_node_details` on the Einstein node. The edges section should list both "studied_at" and "researched" with correct target nodes and labels preserved.

7. **Create a duplicate-pair edge.** Create a second edge between the same source and target:
   - `create_edge` from "Edge Test - Albert Einstein" to "Edge Test - University of Zurich" label="taught_at"
   
   This tests that a second edge between the same pair is created (not upserted over the first).

8. **Verify duplicate edge behavior.** Call `get_node_details` on the Einstein node. Should now show 3 edges total: "studied_at", "researched", and "taught_at". Both edges to University of Zurich should be present with their distinct labels.

9. **Delete one specific edge.** Delete only the "taught_at" edge using `delete_edge` (by its edge ID from the details response).

10. **Verify targeted deletion.** Call `get_neighbors` on the Einstein node — should still return 2 neighbors (University of Zurich and General Relativity). Call `get_node_details` — should show 2 edges, with "studied_at" still intact and "taught_at" gone.

11. **Clean up test nodes.** Delete all 3 test nodes using `delete_node` (edge deletion should cascade).

12. **Verify baseline restored.** Call `get_graph_overview` — both node count and edge count should match the original baseline from step 1.

## Evaluation Criteria

- [ ] All 3 edges created successfully with correct labels
- [ ] `get_neighbors` on Einstein returns exactly 2 neighbors after initial edge creation
- [ ] `get_neighbors` on General Relativity returns exactly 2 neighbors (edges are traversed in both directions)
- [ ] `get_node_details` shows edge labels matching what was provided at creation ("studied_at", "researched")
- [ ] Creating a second edge between Einstein and University of Zurich succeeds (not treated as upsert)
- [ ] After duplicate-pair edge creation, Einstein has 3 total edges with all labels preserved
- [ ] `delete_edge` removes only the targeted "taught_at" edge
- [ ] After targeted deletion, "studied_at" edge between Einstein and University of Zurich remains intact
- [ ] After deleting all test nodes, graph overview counts return to original baseline

## Cleanup

Steps 11-12 handle cleanup as part of the test flow. If the eval fails mid-run, search for "Edge Test -" and delete any remaining test nodes (cascading edge deletion will handle orphaned edges).
