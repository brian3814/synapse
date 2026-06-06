# Agent Harness Architecture Research

Research across Claude Code, OpenAI Agents SDK, LangGraph, Google ADK, Codex, and VS Code Copilot on five harness dimensions: tool guardrails, agent hooks, skill management, sandboxing/data isolation, and execution control.

## 1. Tool Guardrails

### Key Patterns

**Tiered Permission Modes (Claude Code):** Three rule types (allow, deny, ask) evaluated deny-first. Read-only tools auto-approve, writes need session approval, destructive ops need permanent approval. Rules use `ToolName(specifier)` syntax with glob patterns.

**Input/Output Guardrails (OpenAI Agents SDK):** Per-tool input validation before execution (reject bad arguments) and output sanitization after execution (redact sensitive data). Tripwire pattern halts execution on policy violation.

**Human-in-the-Loop with State Resume (OpenAI, LangGraph):** Tools with `needsApproval` pause the agent loop, return an interruptions array to the host app, and resume with approve/reject decisions. LangGraph's `interrupt()` persists full graph state for checkpoint-resume.

**Before/After Callbacks (Google ADK):** `before_tool_callback` returns `None` to proceed or a result to skip execution. `after_tool_callback` can replace the tool's output. Cleanest blocking API.

### Synapse Design

```typescript
interface GuardrailRule {
  match: string;                    // tool name or glob
  action: 'allow' | 'deny' | 'confirm';
  reason?: string;
}

interface AgentGuardrails {
  rules?: GuardrailRule[];          // deny-first evaluation
  maxBatchSize?: number;            // cap batch operations
  confirmWrites?: boolean;          // require confirmation for write tools
  confirmDestructive?: boolean;     // require confirmation for destructive tools
}
```

**Enforcement:** Three points in Synapse's pipeline:

1. `tools:list` IPC — ToolFilter removes tools the agent can't see (existing)
2. `tools:execute` IPC — guardrail rule evaluation before dispatch (new)
3. `McpServerBridge` — AccessProfile-derived rules for external callers (extend)

The `confirm` action sends an IPC event to the renderer showing a dialog with the tool name, arguments, and reason. The agent loop pauses until the user approves or rejects.

---

## 2. Agent Hooks

### Key Patterns

**PreToolUse/PostToolUse (Claude Code, VS Code):** Shell commands receiving JSON on stdin with tool_name, tool_input, session_id. Can block (exit 2), allow, modify input, or inject additional context. Multiple scopes execute in parallel; most restrictive wins.

**Callback Pairs (Google ADK):** `before_tool_callback(tool, args, tool_context) → Optional[result]` / `after_tool_callback(tool, args, tool_context, tool_response) → Optional[result]`. Return None to proceed, return a value to override. Cleanest in-process API.

**CallbackManager (LangChain):** 18 event methods with parent_run_id for hierarchical tracing. Separate sync/async interfaces. Handler inheritance via inheritable_handlers propagated to child runs.

**RunHooks vs AgentHooks (OpenAI Agents SDK):** RunHooks observe entire runs (including handoffs). AgentHooks are agent-instance-scoped. Clear separation: hooks observe, guardrails block.

### Synapse Design

Six hook events, in-process TypeScript functions (not shell subprocesses):

| Event | Blocking? | Purpose |
|---|---|---|
| `onAgentStart` | No | Load vault context, initialize state |
| `onAgentEnd` | No | Persist session summary, emit usage record |
| `onBeforeToolCall` | Yes | Argument validation, confirmation gates, input transformation |
| `onAfterToolCall` | Yes | Result sanitization, side effects (embedding gen, sync) |
| `onBeforeLLMCall` | Yes | Context injection (memories, RAG) |
| `onAfterLLMCall` | No | Token tracking, response logging |

```typescript
interface BeforeToolCallHookResult {
  decision: 'proceed' | 'deny' | 'modify';
  reason?: string;
  updatedInput?: Record<string, unknown>;
}

interface AfterToolCallHookResult {
  updatedResult?: ToolResult;
}

type HookFn<TData, TResult> = (ctx: HookContext, data: TData) => Promise<TResult | void>;
```

Hooks reference registered modules by name in frontmatter:

```yaml
hooks:
  onBeforeToolCall: validate-node-schema
  onAfterToolCall: audit-log
```

Hook modules register with a `HookRegistry` in the main process, analogous to `ToolRegistry`.

---

## 3. Skill Management

### Key Patterns

**SKILL.md Standard (agentskills.io):** Cross-framework portable format. YAML frontmatter (name, description, max 1024 chars) + markdown body as instructions. Adopted by Claude Code, Codex, and Google ADK. Directory structure: `SKILL.md` + `scripts/` + `references/` + `assets/`.

**Progressive Disclosure (Codex, ADK):** Three levels:
- L1: Name + description (~100 tokens/skill, always in context)
- L2: Full instructions (~500-2000 tokens, loaded on activation)
- L3: Reference files (unbounded, loaded on demand)

Codex caps L1 budget at 8,000 chars or 2% of context. ADK's SkillToolset achieves ~90% context reduction vs monolithic prompts.

**Auto-Generated Tools (ADK):** SkillToolset generates `load_skill(name)` and `load_skill_resource(skill_name, path)` as callable tools. XML index injected into system prompt for L1 discovery.

**Static Tool Sets (VS Code):** `.jsonc` files define named tool groups. No progressive disclosure. 128-tool hard limit with virtual tools overflow.

### Synapse Design

```typescript
interface SkillMetadata {
  name: string;           // kebab-case, max 64 chars
  description: string;    // max 1024 chars — when to use, not how
  tools?: string[];       // tools this skill provides/requires
  nodeTypes?: string[];   // node types this skill operates on
  mcpServers?: string[];  // MCP server dependencies
}

interface SkillRegistry {
  listSkills(): SkillMetadata[];
  loadSkill(name: string): Skill | null;
  loadReference(skillName: string, path: string): string | null;
}
```

Skills stored in `.kg/skills/` (vault-scoped). Agent frontmatter references skills:

```yaml
skills:
  - graph-query    # Always active (L2 loaded at start)
  - notes          # Always active
```

Unassigned skills appear in the skills index for on-demand loading.

---

## 4. Data Scope Isolation

### Key Patterns

**Git Worktree Isolation (Claude Code):** Each subagent gets a separate worktree. File edits never cross boundaries. `isolation: worktree` in frontmatter.

**Per-Agent File Scoping (OpenAI Assistants):** Each assistant has its own vector store for file_search and separate file set for code_interpreter. Thread-level vs assistant-level scoping.

**Identity-Scoped Memory (Mem0):** Memories tagged with `user_id`, `agent_id`, `app_id`. Queries filtered by identity context. Agents can only access their own memories.

**Schema-Validated Guards (LangChain):** StructuredTool Pydantic validators as pre-execution argument guards. Schema validation before tool body executes.

### Synapse Design

```typescript
interface AgentGraphScope {
  allowedNodeTypes?: string[];    // only these types visible
  deniedNodeTypes?: string[];     // these types always hidden
  requiredTags?: string[];        // must have at least one of these tags
  excludedTags?: string[];        // hidden if any of these tags
  maxTraversalDepth?: number;     // cap get_neighbors depth
  readOnly?: boolean;             // strip write tools + block at execution
}
```

**Enforcement at DataStore level** via scoped CommandContext wrapper:

```typescript
function createScopedContext(base: CommandContext, scope: AgentGraphScope): CommandContext {
  return { ...base, db: createScopedDataStore(base.db, scope) };
}
```

The scoped DataStore adds WHERE clause filtering to every repository query. `readOnly` enforced at both tool-list time (capabilities filter) and execution time (reject writes in scoped context).

Frontmatter:

```yaml
graphScope:
  allowedNodeTypes: [concept, paper, author]
  deniedNodeTypes: [personal, private_note]
  readOnly: true
  maxTraversalDepth: 2
```

---

## 5. Execution Control & Observability

### Key Patterns

**maxTurns/maxIterations (all frameworks):** Hard cap on agent loop iterations. Claude Code uses `maxTurns` in frontmatter. OpenAI uses `max_turns` on Runner.run(). LangGraph uses `recursion_limit`.

**Token Budget (Claude Code):** `budget.total`, `budget.spent()`, `budget.remaining()`. Advisory — the model self-regulates, hard cap as backstop. Countdown injected into system prompt.

**Checkpoints (LangGraph):** Full graph state persisted via checkpointer. Time-travel replay for debugging. Resume from any checkpoint.

**Streaming Events (OpenAI):** Run lifecycle events (created, queued, in_progress, completed, failed). Real-time event stream for monitoring.

**Audit Trails:** LangSmith traces (LangChain), RunTree with parent_run_id hierarchy, session replay.

### Synapse Design

```typescript
interface ToolCallLog {
  id: string;
  sessionId: string;
  agentId: string;
  toolName: string;
  toolCategory: 'read' | 'write' | 'execute';
  inputJson: string;
  resultJson: string;         // truncated to 10KB
  isError: boolean;
  durationMs: number;
  createdAt: string;
}
```

Written from the `onAfterToolCall` hook. Per-vault SQLite table for audit trails. UI: tool call timeline panel, budget progress bar.

---

## 6. Unified AgentDefinition Type

```typescript
interface AgentDefinition {
  // Identity
  id: string;
  name: string;
  description: string;
  icon?: string;
  kind: 'chat' | 'extraction';
  scope: 'builtin' | 'vault' | 'user';
  enabled: boolean;

  // Instructions
  customInstructions?: string;
  conversationStarters?: string[];

  // Tool Access
  tools?: string[];
  disabledTools?: string[];
  mcpServers?: string[];

  // Skills
  skills?: string[];

  // Guardrails
  guardrails?: AgentGuardrails;

  // Data Scope
  graphScope?: AgentGraphScope;

  // Execution Control
  maxIterations?: number;
  tokenBudget?: number;

  // Hooks
  hooks?: {
    onAgentStart?: string;
    onAgentEnd?: string;
    onBeforeToolCall?: string;
    onAfterToolCall?: string;
    onBeforeLLMCall?: string;
    onAfterLLMCall?: string;
  };
}
```

---

## 7. Implementation Priority

### Phase 1: MVP
- `AgentDefinition` type with frontmatter parser
- Tool access resolution (tools/disabledTools → ToolFilter)
- Basic guardrails (confirmWrites, confirmDestructive, maxBatchSize, deny/confirm rules)
- `maxIterations` per agent
- Agent picker UI

### Phase 2: Hooks + Audit + Data Scope
- HookRegistry with onBeforeToolCall/onAfterToolCall
- `tool_call_log` SQLite table + audit-log hook
- AgentGraphScope enforcement via scoped CommandContext
- Per-agent usage tracking

### Phase 3: Skills + Advanced
- SkillRegistry with SKILL.md parser
- Progressive disclosure (L1/L2/L3)
- load_skill/load_skill_reference tools
- Token budget with countdown
- Agent activity panel in UI
