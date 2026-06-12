---
name: semantic-note-crossref
category: semantic-search
requires: [synapse-mcp, allow-write, embeddings]
---

# Semantic Note Cross-Reference

Test whether notes that `[[wikilink]]` to entities become discoverable when querying about those entities' topics. With graph-aware embeddings, note embedding text includes `[mentions] entity1, entity2`, improving recall for relationship-based queries.

## Prerequisites

- synapse-mcp connected with `--allow-write`
- Embeddings enabled in Synapse settings

## Steps

1. **Record baseline.** Call `get_graph_overview`.

2. **Create entity nodes:**
   - `create_node` name="SemEval-B-Photosynthesis" type="entity" label="Biological process converting light energy to chemical energy"
   - `create_node` name="SemEval-B-Chloroplast" type="entity" label="Organelle in plant cells"
   - `create_node` name="SemEval-B-Calvin Cycle" type="entity" label="Metabolic pathway for carbon fixation"

3. **Create a note referencing these entities via wikilinks:**
   - `create_note` title="SemEval-B-Lab Meeting Notes" content (include these wikilinks in the body):
     ```
     # Lab Meeting - May 2026

     Today we discussed experimental protocols for measuring electron transport rates.

     Key discussion points:
     - New fluorescence imaging technique for [[SemEval-B-Chloroplast]] membrane analysis
     - Revised timeline for the [[SemEval-B-Calvin Cycle]] inhibitor study
     - Literature review on artificial [[SemEval-B-Photosynthesis]] systems

     Action items assigned to the team.
     ```

4. **Wait for embeddings.** Call `get_graph_overview` as a brief pause.

5. **Query 1 — indirect match:** `semantic_search` query="chloroplast research experiments" limit=5. The note body never says "chloroplast research experiments" as a phrase, but with graph-aware embeddings the note's text includes `[mentions] SemEval-B-Chloroplast`.

6. **Query 2 — cross-entity:** `semantic_search` query="carbon fixation pathway studies" limit=5. The Calvin Cycle entity has "carbon fixation" in its label. With graph-aware, the note mentions Calvin Cycle, bridging the query to the note.

7. **Query 3 — baseline keyword:** `semantic_search` query="photosynthesis" limit=5. Direct keyword match in note body. Should work with both strategies.

## Evaluation Criteria

- [ ] All 3 entity nodes and 1 note created without errors
- [ ] Query 1: `semantic_search` for "chloroplast research experiments" returns either the note or the chloroplast entity in top 3
- [ ] Query 2: `semantic_search` for "carbon fixation pathway studies" returns either the note or the Calvin Cycle entity in top 3
- [ ] Query 3: `semantic_search` for "photosynthesis" returns the note or the photosynthesis entity in top 3 (baseline sanity check)

## Cleanup

- Delete the note "SemEval-B-Lab Meeting Notes"
- Delete all 3 entity nodes by searching for prefix "SemEval-B-"
- Verify `search_nodes` query="SemEval-B-" returns empty
