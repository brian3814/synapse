# MCP oneOf Schema Silently Rejected by Claude Desktop

## Problem

Claude Desktop shows the MCP server as "running" and the `tools/list` handshake succeeds in logs, but no tools appear in the chat UI. The user cannot find the wrench/tool icon or invoke any MCP tools.

## Root Cause

Claude Desktop (and the Anthropic tool use API) requires `inputSchema` to have `type: "object"` at the top level. Tool schemas using JSON Schema `oneOf` at the root — without a wrapping `type: "object"` — are silently rejected. No error is logged; the tools simply don't appear.

**Broken:**
```json
{
  "name": "manage_entity",
  "inputSchema": {
    "oneOf": [
      { "type": "object", "properties": { "action": { "const": "create" }, ... } },
      { "type": "object", "properties": { "action": { "const": "update" }, ... } },
      { "type": "object", "properties": { "action": { "const": "delete" }, ... } }
    ]
  }
}
```

**Working:**
```json
{
  "name": "manage_entity",
  "inputSchema": {
    "type": "object",
    "properties": {
      "action": { "type": "string", "enum": ["create", "update", "delete"] },
      "entity_id": { "type": "string", "description": "Required for update." },
      "entity_ids": { "type": "array", "items": { "type": "string" }, "description": "Required for delete." },
      "name": { "type": "string", "description": "Required for create." },
      ...
    },
    "required": ["action"]
  }
}
```

## Symptoms

- MCP server log shows successful `initialize` → `tools/list` → tools returned
- Claude Desktop Settings shows server status as "running"
- But: no tool icon in chat input, no tools available in conversation
- No error in `mcp.log` or `mcp-server-*.log`

## Fix

Flatten discriminated `oneOf` schemas into a single `type: "object"` with all properties at the top level. Use an `enum` for the action field and document per-action required fields in the property descriptions. Move per-action validation to runtime (the handler layer) rather than the JSON Schema.

## Affected Clients

| Client | `oneOf` support |
|--------|----------------|
| Claude Desktop | Silent rejection |
| Claude Code | Likely same (uses Anthropic API) |
| Cursor | Unknown |
| Codex | Unknown |

## Lesson

When designing MCP tool schemas for broad client compatibility, stick to flat `type: "object"` schemas with `enum` for action discriminators. Use `description` strings to document per-action requirements. Enforce required fields at runtime, not in the schema.
