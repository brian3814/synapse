# Artifact Systems in AI Chat Applications — Technical Research

> Research conducted 2026-06-08. Sources include official documentation, reverse-engineering write-ups, leaked system prompts, and open-source implementations.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Claude.ai Artifacts (Anthropic)](#2-claudeai-artifacts-anthropic)
3. [ChatGPT Canvas (OpenAI)](#3-chatgpt-canvas-openai)
4. [bolt.new / bolt.diy (StackBlitz)](#4-boltnew--boltdiy-stackblitz)
5. [E2B Fragments](#5-e2b-fragments)
6. [LibreChat](#6-librechat)
7. [Open WebUI](#7-open-webui)
8. [Open Artifacts (13point5)](#8-open-artifacts-13point5)
9. [LangChain Open Canvas](#9-langchain-open-canvas)
10. [v0.dev (Vercel)](#10-v0dev-vercel)
11. [Architectural Pattern Comparison](#11-architectural-pattern-comparison)
12. [Sandbox Comparison](#12-sandbox-comparison)
13. [Implications for Synapse](#13-implications-for-synapse)

---

## 1. Executive Summary

Three dominant architectural patterns exist for artifact generation in AI chat applications:

| Pattern | Mechanism | Used By |
|---|---|---|
| **XML tags in text stream** | LLM emits custom XML tags inline; frontend parser extracts and renders | Claude.ai, bolt.new, LibreChat |
| **Tool calls** | LLM calls a dedicated tool with structured arguments; backend processes | ChatGPT Canvas, LangChain Open Canvas |
| **Structured JSON streaming** | LLM streams a JSON object conforming to a schema; no parsing needed | E2B Fragments |

All production systems use **iframe-based sandboxing** for executing generated code, with varying levels of sophistication (simple `sandbox="allow-scripts"` to double-iframe cross-origin isolation with CSP).

Both XML tags and tool calls are battle-tested at massive scale. The choice depends on existing infrastructure, streaming requirements, and architectural preferences.

---

## 2. Claude.ai Artifacts (Anthropic)

### 2.1 Mechanism: XML Tags in Text Stream

Claude uses **inline XML tags in the assistant's text response**, not structured `tool_use` content blocks. The model emits artifacts directly within its streamed text output using two proprietary XML tags:

- **`<antThinking>`** — A single-sentence chain-of-thought block where the model evaluates whether an artifact is warranted. This tag is **server-side scrubbed** before the response reaches the client — it never appears in API network responses.

- **`<antArtifact>`** — The actual artifact payload with three required attributes:
  - `identifier` — kebab-case slug (e.g., `"us-states-population-table"`), tracks identity across updates
  - `type` — MIME type string (see below)
  - `title` — human-readable title

Example output the model emits:

```
Here's a component that does what you asked:

<antArtifact identifier="population-table" type="application/vnd.ant.react" title="US States Population Table">
export default function PopulationTable() {
  // React component code
}
</antArtifact>
```

The system prompt instructs the model to **never mention** the `antArtifact` tag, MIME types, or related syntax to the user. The entire XML scaffolding is invisible — the frontend strips it and renders accordingly.

This is governed by an `<artifacts_info>` section injected into the system prompt, which was reverse-engineered and leaked in mid-2024.

**Key distinction**: The public Claude API does not include an artifact rendering layer. When using the API, `<antArtifact>` tags appear as plain text within the `text` content block. Rendering is the client's responsibility. This is fundamentally different from `tool_use`, which is a first-class structured response type in the API.

### 2.2 Frontend Parsing

The claude.ai frontend performs **client-side XML tag detection** on the streamed SSE text deltas:

1. **Streaming protocol**: SSE with `content_block_delta` events containing `text_delta` payloads. Text accumulates incrementally.
2. **Tag detection**: Frontend scans accumulated text for `<antArtifact ...>` opening tags. Content between opening and closing tags is extracted from the chat flow.
3. **Rendering split**: Artifact content is routed to the artifact panel (right-side preview). Surrounding conversational text stays in chat. A clickable "artifact link" placeholder is inserted in the chat.
4. **`<antThinking>` scrubbing**: Removed server-side; frontend never sees it.

### 2.3 Supported Artifact Types

| Type | MIME String | Rendering |
|---|---|---|
| Code | `application/vnd.ant.code` | Syntax-highlighted code block (any language) |
| Documents | `text/markdown` | Rendered Markdown |
| HTML | `text/html` | Full HTML page in iframe |
| SVG | `image/svg+xml` | Rendered SVG graphic |
| Mermaid Diagrams | `application/vnd.ant.mermaid` | Rendered Mermaid diagram |
| React Components | `application/vnd.ant.react` | Live React component in sandboxed iframe |

The `vnd.ant` prefix follows MIME conventions: `vnd` = vendor, `ant` = Anthropic.

**React artifact sandbox pre-bundles**: React (with hooks), Tailwind CSS, Shadcn UI, Recharts, Lucide React, D3, Three.js, Lodash.

Requirements: `export default function`, zero props, Tailwind only (no custom config), no `localStorage`/`sessionStorage`.

### 2.4 Sandbox Implementation

Three layers of isolation (confirmed from Anthropic's engineering blog and Pragmatic Engineer interview):

1. **iframe with sandbox attribute**: `<iframe sandbox="allow-scripts">` — permits JS execution, blocks navigation/forms/popups/same-origin access. iframe gets a **null origin**.
2. **Full-site process isolation**: Chrome's Site Isolation runs the iframe in a separate OS process from the main claude.ai page.
3. **Content Security Policy (CSP)**: Strict CSP headers limiting network access, external script loading, and frame sources.

Architecture designed by security engineer Ziyad Edher — uses browser primitives rather than a custom isolation layer.

**Known limitation**: Sandbox hardcodes CSP and does not respect `frameDomains`, `connectDomains`, or `resourceDomains` from MCP App UI resource declarations ([anthropics/claude-ai-mcp issue #40](https://github.com/anthropics/claude-ai-mcp/issues/40)).

### 2.5 Sources

**Official Anthropic:**
- [Anthropic Help Center: What are artifacts](https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them)
- [How we contain Claude across products](https://www.anthropic.com/engineering/how-we-contain-claude) — engineering blog on containment

**Reverse-engineering & technical teardowns:**
- [Reverse engineering Claude Artifacts — Reid Barber](https://www.reidbarber.com/blog/reverse-engineering-claude-artifacts) — definitive technical teardown
- [The Claude Artifacts system prompt — NJ Pearman](https://njpearman.github.io/2024-09-06/the-claude-artifacts-system-prompt-or-message) — leaked prompt analysis
- [Claude System Internals — DEJAN AI](https://dejan.ai/blog/claude-system-internals/) — MIME type details
- [Full system prompt gist](https://gist.github.com/nlile/4c239731ea3a539f8f3423ef458b96e7) — Sonnet 3.5 artifacts system prompt

**Third-party coverage:**
- [How Anthropic built Artifacts — Pragmatic Engineer](https://newsletter.pragmaticengineer.com/p/how-anthropic-built-artifacts) — interview-based deep dive (2-person team, 3-month build)
- [Simon Willison: Claude Artifacts](https://simonwillison.net/tags/claude-artifacts/) — multiple analysis posts

---

## 3. ChatGPT Canvas (OpenAI)

### 3.1 Mechanism: Tool Calls via `canmore` Namespace

Canvas uses **tool calls, not special tokens**. A tool namespace called `canmore` (internal codename) is injected into the model's system prompt. Confirmed through multiple independent system prompt leaks.

Three functions:

**`canmore.create_textdoc`** — Creates a new canvas document:
```json
{
  "name": "string",
  "type": "document | code/python | code/javascript | code/html | code/react | code/java | ...",
  "content": "string"
}
```
The `type` field determines rendering: `"document"` renders as markdown, `"code/*"` types get syntax highlighting, `"code/react"` and `"code/html"` get live preview.

**`canmore.update_textdoc`** — Updates via Python regex patterns:
```json
{
  "updates": [
    {
      "pattern": "regex string (Python re.finditer)",
      "multiple": "boolean",
      "replacement": "string (Python re.Match.expand)"
    }
  ]
}
```

**`canmore.comment_textdoc`** — Adds inline comments without modifying content:
```json
{
  "comments": [
    {
      "pattern": "regex string (Python re.search)",
      "comment": "string"
    }
  ]
}
```

System prompt behavioral rules: "lean towards NOT using canmore if the content can be effectively presented in the conversation" and "ONLY use if you are 100% SURE the user wants to iterate on a long document or code file." Threshold: ~10+ lines that the user will likely modify.

### 3.2 Content Flow

Standard tool-call streaming over the Chat Completions protocol:

1. Model emits a tool call with `canmore.*` function name
2. JSON arguments stream token-by-token
3. Frontend intercepts these specific tool call names and routes content to the side panel
4. `create_textdoc` opens a new canvas panel; `update_textdoc` applies regex patches to existing content

**No special wire protocol** — standard OpenAI tool calling. The "magic" is in (a) the system prompt injecting canmore tools, and (b) the frontend knowing how to render those tool calls.

**Not available via public API.** The `canmore` namespace is injected server-side only for the ChatGPT product.

### 3.3 Rendering Pipeline

**For document/code types** (`"document"`, `"code/*"`): Rendered directly in the React UI with syntax highlighting and rich text editor. No iframe.

**For webview/React types** (`"code/react"`, `"code/html"`): Double-iframe sandbox:

1. **Outer iframe (Sandbox Proxy):** Hosted on `web-sandbox.oaiusercontent.com` (different origin from `chatgpt.com`). Enforces CSP. `sandbox="allow-scripts allow-same-origin"`.
2. **Inner iframe (App Container):** Created by proxy via `document.write()`. Receives per-application CSP. Actual content executes here.
3. **Communication bridge:** JSON-RPC 2.0 over `postMessage()` between host, proxy, and inner iframe. `window.openai` bridge object injected for bidirectional communication.

### 3.4 Update Mechanism

**Code documents (`type="code/*"`):** "ALWAYS REWRITE CODE TEXTDOCS USING A SINGLE UPDATE WITH `'.*'` FOR THE PATTERN." Code is always fully replaced — never partial edits.

**Documents (`type="document"`):** "Default to rewriting the entire document unless the user has a request that changes only an isolated, specific, and small section."

**In practice:** ~90% of updates are full document rewrites using the `".*"` pattern. Partial updates only for simple markdown text edits.

### 3.5 Sources

**Leaked system prompts:**
- [edoardoavenia/chatgpt-system-prompts/canmore.md](https://github.com/edoardoavenia/chatgpt-system-prompts/blob/main/canmore.md)
- [asgeirtj/system_prompts_leaks/tool-canvas-canmore.md](https://github.com/asgeirtj/system_prompts_leaks/blob/main/OpenAI/tool-canvas-canmore.md)
- [0xeb/TheBigPromptLibrary gpt4o_canvas](https://github.com/0xeb/TheBigPromptLibrary/blob/main/SystemPrompts/OpenAI/gpt4o_canvas_10032024.md)

**Technical analysis:**
- [Dave Hulbert: ChatGPT Canvas technical details](https://medium.com/@dave1010/chatgpts-canvas-beta-feature-internal-details-a7c1e2477149)
- [Infoxicator: Reverse engineered ChatGPT Apps iframe sandbox](https://dev.to/infoxicator/i-reverse-engineered-chatgpt-apps-iframe-sandbox-2ok3)
- [Vercel: Running Next.js in ChatGPT](https://vercel.com/blog/running-next-js-inside-chatgpt-a-deep-dive-into-native-app-integration)
- [Simon Willison: ChatGPT Canvas API requests](https://simonwillison.net/2024/Dec/10/chatgpt-canvas/)

---

## 4. bolt.new / bolt.diy (StackBlitz)

### 4.1 Mechanism: Custom XML Tags

Uses `<boltArtifact>` / `<boltAction>` XML tags parsed from streaming LLM output. Most thoroughly documented open-source implementation.

Tag specification (from source: `app/lib/.server/llm/prompts.ts`):

```xml
<boltArtifact id="project-setup" title="Node.js Express App">
  <boltAction type="file" filePath="package.json">
    { "name": "my-app", ... }
  </boltAction>
  <boltAction type="shell">
    npm install && npm run dev
  </boltAction>
</boltArtifact>
```

**Action types:**
- `file` — write/update a file (requires `filePath` attribute)
- `shell` — run shell commands

### 4.2 Streaming Parser

`StreamingMessageParser` class (`app/lib/runtime/message-parser.ts`) does character-by-character scanning using `indexOf()` — NOT regex:

```typescript
const ARTIFACT_TAG_OPEN = '<boltArtifact';
const ARTIFACT_TAG_CLOSE = '</boltArtifact>';
const ARTIFACT_ACTION_TAG_OPEN = '<boltAction';
const ARTIFACT_ACTION_TAG_CLOSE = '</boltAction>';
```

Maintains state per message (`insideArtifact`, `insideAction`, `currentAction`), fires callbacks: `onArtifactOpen`, `onArtifactClose`, `onActionOpen`, `onActionClose`.

### 4.3 Execution Pipeline

`ActionRunner` class (`app/lib/runtime/action-runner.ts`) holds a WebContainer instance. Global sequential execution queue — actions added via `addAction()`, executed via `runAction()`. Lifecycle: `pending` → `running` → `complete`/`failed`/`aborted`.

### 4.4 Sandboxing

StackBlitz **WebContainers** — full Node.js environment in-browser via WebAssembly. Supports npm, Vite, Next.js, most JS tooling. Constraints: no native binaries, limited Python, no pip/git.

### 4.5 Sources

- [stackblitz/bolt.new](https://github.com/stackblitz/bolt.new) (original, open source)
- [stackblitz-labs/bolt.diy](https://github.com/stackblitz-labs/bolt.diy) (community fork, any LLM)
- Key files: `app/lib/runtime/message-parser.ts`, `app/lib/runtime/action-runner.ts`, `app/lib/.server/llm/prompts.ts`

---

## 5. E2B Fragments

### 5.1 Mechanism: Structured JSON Streaming

Architecturally distinct — uses Vercel AI SDK's `streamObject()` with Zod schema validation. No XML tags or tool calls.

Fragment schema (from source: `lib/schema.ts`):
```typescript
z.object({
  commentary: z.string(),
  template: z.string(),
  title: z.string(),
  description: z.string(),
  code: z.string(),
  file_path: z.string(),
  additional_dependencies: z.array(z.string()),
  has_additional_dependencies: z.boolean(),
  install_dependencies_command: z.string(),
  port: z.number().nullable(),
})
```

### 5.2 Content Flow

1. `app/api/chat/route.ts` calls `streamObject()` with the schema and system prompt
2. LLM streams partial JSON objects incrementally
3. Client receives via Vercel AI SDK hook, updating `fragment` state in real-time
4. `Preview` component renders code as it arrives
5. `app/api/sandbox/route.ts` provisions E2B sandbox for execution

### 5.3 Sandboxing

E2B cloud sandboxes — isolated Linux containers provisioned on-demand. Web app templates return a URL to the running app; code interpreter templates return stdout/stderr.

### 5.4 Sources

- [e2b-dev/fragments](https://github.com/e2b-dev/fragments)

---

## 6. LibreChat

### 6.1 Mechanism: Anthropic-Compatible Tag Parsing

Adopted the same `<antArtifact>` tag format, making it model-agnostic — any LLM can be prompted to emit these tags.

- Directive parser in `client/src/utils/artifacts.ts` scans LLM output
- Streaming-aware, processes tokens as they arrive
- Supports `application/vnd.ant.react` and other artifact types

### 6.2 Rendering

- **Code editing:** Monaco Editor (`@monaco-editor/react`)
- **Live preview:** CodeSandbox **Sandpack** library in isolated iframe
- Streaming sync: `model.applyEdits()` appends tokens incrementally
- Self-hosting supported via `SANDPACK_BUNDLER_URL` / `SANDPACK_STATIC_BUNDLER_URL`

### 6.3 Sources

- [danny-avila/LibreChat](https://github.com/danny-avila/LibreChat)
- Key files: `client/src/utils/artifacts.ts`, `client/src/components/Artifacts/ArtifactPreview.tsx`

---

## 7. Open WebUI

### 7.1 Mechanism: Automatic HTML Code Block Detection

Simplest approach: detects when a response contains a renderable HTML code block and renders it as an "artifact."

### 7.2 Rendering

```html
<iframe srcdoc="[escaped HTML content]"
        sandbox="allow-scripts"
        style="width: 100%; height: 400px; border: none;">
</iframe>
```

- `sandbox="allow-scripts"` permits JS, blocks navigation/forms/popups/same-origin
- Without `allow-same-origin`, iframe has a **null origin**
- `IFRAME_CSP` env var injects CSP meta tags into all srcdoc iframes

### 7.3 Sources

- [open-webui/open-webui](https://github.com/open-webui/open-webui)

---

## 8. Open Artifacts (13point5)

### 8.1 Mechanism: postMessage + Babel Transpilation

One of the first open-source Claude artifact clones (archived October 2024).

1. Parent sends LLM-generated code to renderer iframe via `postMessage`
2. Iframe receives `UPDATE_COMPONENT` message
3. `getReactComponentFromCode()` uses **Babel transpilation** to convert code strings to React components
4. Component renders inside iframe
5. `html2canvas` captures screenshots for export

Message protocol: `INIT_COMPLETE`, `UPDATE_COMPONENT`, `CAPTURE_SELECTION`

### 8.2 Sources

- [13point5/open-artifacts](https://github.com/13point5/open-artifacts) (archived)
- [13point5/open-artifacts-renderer](https://github.com/13point5/open-artifacts-renderer)

---

## 9. LangChain Open Canvas

### 9.1 Mechanism: LangGraph Nodes with Tool Calling

Uses separate LangGraph nodes: `generateArtifact`, `updateArtifact`, `updateHighlightedText`, `rewriteArtifact`.

- Stores version history with time-travel support
- Frontend: BlockNote for markdown, CodeMirror for code
- Streaming via LangGraph SDK (HTTP/WebSocket)

### 9.2 Sources

- [langchain-ai/open-canvas](https://github.com/langchain-ai/open-canvas)
- [Architecture (DeepWiki)](https://deepwiki.com/langchain-ai/open-canvas)

---

## 10. v0.dev (Vercel)

**Proprietary** — not open source.

- Uses Vercel's own AI models fine-tuned for UI generation (variants: `v0-1.0-md`, `v0-1.5-lg` up to 512K context)
- Output: TypeScript React with Tailwind + shadcn/ui
- "AutoFix" post-processing scans for errors during and after generation
- Components stream as React Server Components via AI SDK 3.0
- Internal mechanism (XML tags, tool calls, or structured output) is unknown

### 10.1 Sources

- [Vercel Academy: AI SDK and v0](https://vercel.com/academy/ai-sdk/ui-with-v0)

---

## 11. Architectural Pattern Comparison

| System | Generation Mechanism | Parsing | Streaming | Update Model | Open Source |
|---|---|---|---|---|---|
| **Claude.ai** | `<antArtifact>` XML tags | Frontend tag detection during streaming | Character-by-character as tokens arrive | New artifact with same `identifier` | No |
| **ChatGPT Canvas** | `canmore` tool calls | Standard tool-call argument streaming | Token-by-token tool args | Regex replacement (usually full rewrite) | No |
| **bolt.new** | `<boltArtifact>` XML tags | `StreamingMessageParser` indexOf scanning | Character-by-character | File-level replacement | Yes |
| **E2B Fragments** | Zod schema + `streamObject()` | Structured JSON, no parsing needed | Partial JSON objects | Full replacement | Yes |
| **LibreChat** | `<antArtifact>` tags (compatible) | Directive parser | Token-by-token | Full replacement | Yes |
| **Open WebUI** | HTML code block detection | Code block identification | After completion | Full replacement | Yes |
| **Open Artifacts** | postMessage to iframe | Babel transpilation | After completion | Full replacement | Yes (archived) |
| **LangChain Open Canvas** | LangGraph tool calls | LangGraph SDK | HTTP/WebSocket streaming | Versioned (time-travel) | Yes |

### Pattern Tradeoffs

**XML Tags:**
- (+) Natural streaming — content appears character by character
- (+) No tool infrastructure needed
- (+) Works with any LLM via system prompt instructions
- (−) Frontend needs a custom streaming parser
- (−) LLM may produce malformed XML
- (−) Artifact content clutters conversation history
- (−) No structured validation before rendering

**Tool Calls:**
- (+) Structured input — schema enforces required fields
- (+) Backend validates before storing
- (+) Clean separation — artifact content not in prose
- (+) Uses existing tool infrastructure
- (+) LLMs heavily trained on tool calling
- (−) Streaming less natural (tool args vs text)
- (−) Adds tools to the registry
- (−) Slightly more complex backend

**Structured JSON:**
- (+) No parsing at all — schema validates automatically
- (+) Streams partial JSON objects
- (+) Strongest type safety
- (−) Requires Vercel AI SDK (or equivalent)
- (−) Less widely adopted pattern
- (−) Tight coupling to specific SDK

---

## 12. Sandbox Comparison

| System | Sandbox Technology | Isolation Level | Network Access |
|---|---|---|---|
| **Claude.ai** | `<iframe sandbox="allow-scripts">` + CSP + Site Isolation | Process-level (Chromium) | Blocked (CSP `connect-src`) |
| **ChatGPT Canvas** | Double-iframe on `web-sandbox.oaiusercontent.com` | Cross-origin + process-level | Limited (per-app CSP) |
| **bolt.new** | WebContainers (WASM Node.js) | In-browser VM | Limited |
| **E2B** | Cloud Linux containers | Full VM isolation | Yes (configurable) |
| **LibreChat** | Sandpack (CodeSandbox iframe bundler) | iframe | CDN access for packages |
| **Open WebUI** | `<iframe srcdoc sandbox="allow-scripts">` | Null origin iframe | Blocked |
| **Open Artifacts** | iframe + postMessage | iframe | Blocked |

### Electron Considerations

In an Electron app (Synapse's context), the sandbox model differs from web:
- `<iframe sandbox="allow-scripts">` still works and enforces null origin
- No Site Isolation by default (Electron doesn't use Chrome's multi-process model for iframes in the same way)
- `webview` tag is an alternative with stronger isolation (separate process, configurable preload)
- CSP can be enforced via `<meta>` tag in the iframe's srcdoc
- `nodeIntegration` must be `false` in the iframe to prevent Node.js access from generated code

---

## 13. Implications for Synapse

### Recommended Approach: Tool Calls

Synapse already has:
- `ToolRegistry` with tool definitions and execution pipeline
- `ChatToolCall` rendering in the chat UI
- Agent turn pipeline with tool call display
- Platform abstraction for storage (`PlatformNotes`, `PlatformFiles`)

A `create_artifact` / `update_artifact` tool pair integrates naturally with this infrastructure. No streaming parser needed. Structured validation before storage.

### Recommended Sandbox: iframe with Sucrase

For V1, a `<iframe sandbox="allow-scripts">` with:
- Sucrase (lighter than Babel) for JSX transpilation
- Pre-bundled React + Recharts + Tailwind
- `srcdoc` approach (no separate server needed)
- postMessage bridge for future live data access

This matches the Open Artifacts / Open WebUI pattern and is the simplest to implement in Electron.

### Storage Fit

Artifacts stored in `.kg/artifacts/` within the vault:
- Metadata in SQLite (leveraging existing DataStore)
- Content as files (similar to how notes are `.md` files in `notes/`)
- Version history via append-only files or SQLite rows

### Tab Integration

New `ContentTabType`: `{ kind: 'artifact'; artifactId: string }` — fits the existing tab system with no structural changes.
