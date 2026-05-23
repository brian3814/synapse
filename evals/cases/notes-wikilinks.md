---
name: notes-wikilinks
category: write-tools
requires: [synapse-mcp, allow-write]
---

# Notes with Wikilinks and Cross-References

Test note creation with wikilink syntax, verifying that `[[Entity Name]]` references are preserved through the full note lifecycle: creation, listing, read-back, search, and cross-note referencing.

## Prerequisites

- synapse-mcp connected with `--allow-write`

## Steps

1. **Record baseline.** Call `list_notes` and note the count.

2. **Create supporting entity nodes.** Create these nodes to serve as wikilink targets:
   - `create_node` name="EvalNote Person" type="person" label="Fictional researcher for wikilink testing"
   - `create_node` name="EvalNote Concept" type="concept" label="Fictional concept for wikilink testing"

3. **Create a note with wikilinks.** Call `create_note`:
   - title: "EvalNote - Research Summary"
   - content:
     ```markdown
     # Research Summary

     This note summarizes recent findings on knowledge representation.

     ## Key Findings

     The primary researcher [[EvalNote Person]] has made significant contributions to the field of structured knowledge. Their work on [[EvalNote Concept]] demonstrates how entities and relationships can be captured in a graph-based model.

     - Knowledge graphs encode real-world entities as nodes
     - Relationships between entities are represented as labeled edges
     - Wikilinks like [[EvalNote Person]] create navigable references
     - Semantic search enables discovery across the graph

     ## Implications

     By combining structured graph data with unstructured notes, researchers can build richer knowledge bases that support both precise queries and exploratory browsing.
     ```

4. **Verify note appears in listing.** Call `list_notes` — the new note should appear and the count should be baseline + 1.

5. **Read back the note.** Call `read_note` on the created note's ID. Verify:
   - The markdown heading `# Research Summary` is present
   - Both wikilinks `[[EvalNote Person]]` and `[[EvalNote Concept]]` are preserved verbatim
   - The bullet list is intact
   - The content is substantively complete (not truncated)

6. **Search notes by title.** Call `search_notes` query="Research Summary" — the note should appear in results.

7. **Search notes by body content.** Call `search_notes` query="knowledge representation" — the note should appear (FTS indexes body text, not just titles).

8. **Verify note exists as a graph node.** Call `search_nodes` query="EvalNote - Research Summary" — the note should appear as a node with type "note".

9. **Create a second note referencing the first.** Call `create_note`:
   - title: "EvalNote - Follow-up Analysis"
   - content:
     ```markdown
     # Follow-up Analysis

     This note builds on [[EvalNote - Research Summary]] with additional observations.

     [[EvalNote Person]] continued their work on [[EvalNote Concept]], expanding the theoretical framework to include temporal relationships and provenance tracking.
     ```

10. **Verify second note.** Call `read_note` on the second note's ID. Verify:
    - The wikilink `[[EvalNote - Research Summary]]` referencing the first note is preserved
    - Both entity wikilinks are present

11. **Verify both notes in listing.** Call `list_notes` — count should be baseline + 2.

12. **Clean up.** Delete both note nodes and both entity nodes using `delete_node`:
    - Delete "EvalNote - Follow-up Analysis"
    - Delete "EvalNote - Research Summary"
    - Delete "EvalNote Person"
    - Delete "EvalNote Concept"

13. **Verify baseline restored.** Call `list_notes` — count should match the original baseline. Call `search_nodes` query="EvalNote" — should return 0 results.

## Evaluation Criteria

- [ ] Note created successfully with a valid node ID returned
- [ ] Note appears in `list_notes` output after creation
- [ ] `read_note` returns full markdown content with wikilinks `[[EvalNote Person]]` and `[[EvalNote Concept]]` preserved verbatim
- [ ] Markdown formatting (heading, bullet list, sections) is intact on read-back
- [ ] `search_notes` by title ("Research Summary") finds the note
- [ ] `search_notes` by body content ("knowledge representation") finds the note (FTS indexes body)
- [ ] Note appears as a node with type "note" in `search_nodes`
- [ ] Second note successfully references the first note via `[[EvalNote - Research Summary]]` wikilink
- [ ] Both notes appear in `list_notes` (baseline + 2)
- [ ] After cleanup: `list_notes` count returns to baseline and `search_nodes` for "EvalNote" returns 0

## Cleanup

Steps 12-13 above handle cleanup as part of the test flow. If the eval is interrupted, manually delete any nodes whose name starts with "EvalNote".
