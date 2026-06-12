---
name: vault-lifecycle
category: infra
requires: [synapse-mcp, allow-write]
---

# Vault Lifecycle and Graph Overview Accuracy

Test vault management operations and verify that `get_graph_overview` counts stay accurate through a sequence of mutations and cleanup. Exercises vault listing, graph overview, node/edge creation, type filtering, and subgraph extraction on a live vault.

## Prerequisites

- synapse-mcp connected with `--allow-write`
- At least one vault available to open

## Steps

1. **List available vaults.** Call `list_vaults` and confirm the response includes at least one vault with a name and path.

2. **Record baseline overview.** Call `get_graph_overview` and note the current node count and edge count.

3. **Create test nodes.** Create these nodes:
   - `create_node` name="Vault Test - Ada Lovelace" type="person" label="Mathematician and writer"
   - `create_node` name="Vault Test - University of London" type="organization" label="Public research university"
   - `create_node` name="Vault Test - Analytical Engine" type="concept" label="Proposed mechanical general-purpose computer"

4. **Verify overview counts increased.** Call `get_graph_overview` — node count should be exactly baseline + 3, edge count unchanged from baseline.

5. **Create test edges.** Create edges between the test nodes:
   - `create_edge` from "Vault Test - Ada Lovelace" to "Vault Test - University of London" label="affiliated_with"
   - `create_edge` from "Vault Test - Ada Lovelace" to "Vault Test - Analytical Engine" label="contributed_to"

6. **Verify overview with edges.** Call `get_graph_overview` — node count should be baseline + 3, edge count should be baseline + 2.

7. **Filter by type.** Call `get_nodes_by_type` type="person" — result should include "Vault Test - Ada Lovelace". Call `get_nodes_by_type` type="concept" — result should include "Vault Test - Analytical Engine" but NOT "Vault Test - Ada Lovelace".

8. **Extract subgraph.** Call `get_subgraph` on the Ada Lovelace node with depth=1. The subgraph should include all 3 test nodes and both test edges.

9. **Delete test edges.** Delete both edges created in step 5 using `delete_edge`.

10. **Delete test nodes.** Delete all 3 test nodes using `delete_node`.

11. **Verify baseline restored.** Call `get_graph_overview` — both node count and edge count should match the original baseline from step 2.

## Evaluation Criteria

- [ ] `list_vaults` returns a non-empty list with vault names and paths
- [ ] Baseline `get_graph_overview` returns valid node and edge counts
- [ ] After creating 3 nodes, overview node count equals baseline + 3
- [ ] After creating 2 edges, overview edge count equals baseline + 2
- [ ] `get_nodes_by_type` type="person" includes the test person node
- [ ] `get_nodes_by_type` type="concept" includes the test concept node but not the test person node
- [ ] `get_subgraph` with depth=1 on Ada Lovelace returns all 3 test nodes and both test edges
- [ ] After deleting all test data, node count returns to original baseline
- [ ] After deleting all test data, edge count returns to original baseline

## Cleanup

Steps 9-11 above handle cleanup as part of the test flow. If the eval fails mid-run, manually search for "Vault Test -" and delete any remaining test nodes.
