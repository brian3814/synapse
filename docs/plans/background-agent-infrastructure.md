# Background Agent Infrastructure — Future Feature

**Date**: 2026-06-08
**Status**: Proposal (not yet scheduled)
**Related**: `docs/superpowers/specs/2026-06-08-artifact-system-design.md`, `docs/memory-harness.md`

## Problem

Several features require work that should not block the main chat response: memory extraction, artifact metadata enrichment, naming quality improvement, skill suggestion, session title refinement. Currently there is no shared infrastructure for post-response background processing — each feature would need to build its own async pipeline.

## Proposal

A general-purpose **post-response background agent** that runs asynchronously after the main chat response is delivered. The agent receives conversation context and performs multiple enrichment tasks in a single pass (or fan-out to lightweight sub-tasks).

This follows the pattern used by:
- **ChatGPT**: Secondary inference call post-response for memory extraction
- **Agent Artifact architecture** (Section 4.4): Background `MemoryExtractor` worker that processes conversation turns after each assistant response
- **Claude.ai**: Server-side `<antThinking>` processing scrubbed before delivery

## Architecture

```
User sends message
    |
    v
Main agent processes → response streamed to user (fast path)
    |
    └── async, non-blocking ──→ Background Agent queued
                                    |
                                    v
                                Background Agent (lightweight model)
                                    |
                                    ├── Memory extraction
                                    |     Extract user preferences, project facts,
                                    |     corrections → MemoryStore
                                    |
                                    ├── Artifact enrichment
                                    |     If artifacts were created this turn:
                                    |     - Evaluate naming quality, rename if poor
                                    |     - Generate tags/summary
                                    |     - Suggest related graph entities
                                    |
                                    ├── Session title refinement
                                    |     Current: first message truncated to 100 chars
                                    |     Better: LLM generates a concise descriptive title
                                    |
                                    └── Skill suggestion
                                          If conversation shows a repeating pattern,
                                          suggest creating a reusable skill
```

## Key Design Principles

1. **Non-blocking**: Background agent NEVER adds latency to the main response. It runs after delivery.
2. **Idempotent**: If the background agent fails or is interrupted, no data is lost. Main flow works without it.
3. **Lightweight model**: Use a fast/cheap model (e.g., Haiku, Flash) for background work. Strong model reserved for main response.
4. **Single pass where possible**: One inference call processes multiple enrichment tasks rather than one call per task.
5. **Observable**: Background work is visible in the UI (e.g., a subtle indicator showing "enriching..." that resolves when done).

## Use Cases

### Artifact Naming Enhancement

**Without background agent (V1):**
```
create_artifact({ title: "Top Connected Nodes", ... })
  → slugify("Top Connected Nodes") → "top-connected-nodes"
  → collision? append "-2", "-3"
```

**With background agent (future):**
```
create_artifact (immediate, mechanical slug)
  → "top-connected-nodes.jsx" created instantly
  → background agent evaluates:
      - Is the slug descriptive enough?
      - Does a collision suffix ("-2") obscure meaning?
      - Could it be renamed to something clearer?
  → if better name found:
      - Rename file + meta on disk
      - Update SQLite index
      - UI refreshes via file watcher
```

### Memory Extraction

**Current state**: Synapse has a memory harness (`docs/memory-harness.md`) but no background extraction pipeline.

**With background agent:**
```
After each assistant response:
  → Background agent receives last N turns + existing memories
  → Extracts: user preferences, feedback, project facts, references
  → Deduplicates against existing memories (key matching)
  → Writes new/updated memories to vault memory store
```

### Session Title Refinement

**Current state**: Session title = `firstMessage.slice(0, 100)`. Often truncated mid-sentence.

**With background agent:**
```
After first 2-3 turns of a session:
  → Background agent summarizes conversation intent
  → Generates concise title (e.g., "Graph centrality analysis" vs "Can you show me which nodes...")
  → Updates chat_sessions.title
  → Session picker UI refreshes
  → Artifact session directories use the refined title
```

### Skill Suggestion

**With background agent:**
```
After N sessions with similar patterns:
  → Background agent detects: "User frequently asks for graph visualizations of centrality data"
  → Suggests: "Create a skill 'centrality-dashboard' that automates this workflow?"
  → User approves → skill file created in vault
```

## Implementation Sketch

```typescript
interface BackgroundAgentTask {
  type: 'memory_extraction' | 'artifact_enrichment' | 'session_title' | 'skill_suggestion';
  context: {
    sessionId: string;
    recentTurns: ChatMessage[];
    existingMemories?: MemoryRecord[];
    newArtifacts?: ArtifactRecord[];
  };
}

interface BackgroundAgentResult {
  memories?: { action: 'create' | 'update' | 'delete'; record: MemoryRecord }[];
  artifactRenames?: { id: string; newFileName: string }[];
  sessionTitle?: string;
  skillSuggestions?: { name: string; description: string; triggers: string[] }[];
}

interface BackgroundAgent {
  // Called after each main response is delivered
  process(tasks: BackgroundAgentTask[]): Promise<BackgroundAgentResult>;

  // Configuration
  readonly model: string;           // lightweight model ID
  readonly maxLatency: number;      // timeout in ms
  readonly enabled: boolean;        // vault-level toggle
}
```

## Integration with Artifact System

The artifact system is designed so the background agent is **additive, not required**:

- V1: Mechanical `slugify()` + collision suffix. Works standalone.
- Future: Background agent improves names, adds tags/summaries. If agent fails, mechanical names remain valid.

No artifact system code needs to change when the background agent is added — it operates on already-created artifacts via the same file I/O and SQLite interfaces.

## Open Questions

1. **Trigger frequency**: Run after every response, or batch every N responses?
2. **UI indicator**: How to show background work is happening without being distracting?
3. **Conflict resolution**: If user renames an artifact file manually while background agent is also renaming, who wins? (File watcher should handle this — last write wins, SQLite re-syncs.)
4. **Cost control**: Should background agent have a per-session or per-day token budget?
5. **Opt-in/out**: Vault-level toggle? Per-task toggles?

## Dependencies

- Artifact system (this spec provides the file/SQLite interface the agent operates on)
- Memory harness V2 (provides the memory store the agent writes to)
- Chat session infrastructure (provides conversation context)

## Priority

Medium-term. The artifact system and other features work without this. Build it when:
- Memory extraction becomes a priority
- Artifact naming quality becomes a user complaint
- Multiple background tasks justify shared infrastructure over ad-hoc solutions
