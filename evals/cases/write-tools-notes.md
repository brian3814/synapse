---
name: write-tools-notes
category: write-tools
requires: [synapse-mcp, allow-write]
---

# Note Creation and Retrieval

Test the note lifecycle: create a note, verify it appears in listings and search, read it back, then clean up.

## Prerequisites

- synapse-mcp connected with `--allow-write`

## Steps

1. **Record baseline.** Call `list_notes` and note the count.

2. **Create a test note.** Call `create_note`:
   - title: "Eval Test Note - Knowledge Graphs"
   - content: A 3-4 paragraph markdown note about knowledge graphs. Include:
     - A heading
     - A bullet list
     - A `[[wikilink]]` to a concept like "Entity Resolution"
     - At least 100 words of substantive content

3. **Verify in listing.** Call `list_notes` — the new note should appear.

4. **Read back.** Call `read_note` on the created note's node ID. Verify the content matches what was written.

5. **Search for it.** Call `search_notes` query="Knowledge Graphs" — the note should appear in results.

6. **Search by content.** Call `search_notes` with a distinctive phrase from the note body — should still find it (FTS indexes note content).

7. **Verify node exists.** Call `search_nodes` query="Eval Test Note" — the note should appear as a node of type "note".

## Evaluation Criteria

- [ ] Note created successfully (create_note returns a node ID)
- [ ] Note appears in `list_notes` output
- [ ] `read_note` returns the full markdown content that was written
- [ ] Content includes the markdown formatting (heading, bullet list, wikilink)
- [ ] `search_notes` by title finds the note
- [ ] `search_notes` by body content finds the note (FTS works)
- [ ] The note also appears as a node in `search_nodes` with type "note"

## Cleanup

- Delete the test note node using `delete_node`
- Verify `search_nodes` query="Eval Test Note" returns empty
