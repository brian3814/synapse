---
name: chat-graph-query
category: chat
requires: [synapse-mcp]
---

# Graph Query via Chat Tools

Test the read-only query tools by exploring an existing knowledge graph. This case works on whatever data is already in the vault — no writes needed.

## Prerequisites

- synapse-mcp connected (read-only is fine)
- Vault has at least 10 nodes and 5 edges (skip if empty)

## Steps

1. **Get overview.** Call `get_graph_overview` to understand the graph. Note total nodes, edges, and the type distribution.

2. **Explore by type.** Pick the most common node type from the overview. Call `get_nodes_by_type` for that type with limit=10.

3. **Deep dive.** Pick one node from the type results. Call `get_node_details` to see its full properties and edges.

4. **Traverse neighbors.** Call `get_neighbors` on the same node with depth=2. Note how many nodes are reachable.

5. **Search test.** Pick a word from one of the node names. Call `search_nodes` with that word. Verify the expected node appears.

6. **Subgraph extraction.** Call `get_subgraph` on the detailed node with depth=1. Verify the response includes both nodes and edges.

7. **Cross-check.** Pick an edge from step 3. Call `get_node_details` on the node at the other end of that edge. Verify the edge appears from both sides.

## Evaluation Criteria

- [ ] `get_graph_overview` returns valid counts (node_count > 0, edge_count > 0)
- [ ] `get_nodes_by_type` returns nodes matching the requested type
- [ ] `get_node_details` returns the node with name, type, label, and edges array
- [ ] `get_neighbors` at depth=2 returns more nodes than depth=1 would (or the same if the graph is small)
- [ ] `search_nodes` finds the expected node by partial name match
- [ ] `get_subgraph` response includes both `nodes` and `edges` arrays
- [ ] Edge appears on both connected nodes when checking from either side (bidirectional consistency)
- [ ] No tool calls return errors for valid inputs
