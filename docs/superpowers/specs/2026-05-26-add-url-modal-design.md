# Add URL Modal Redesign

## Summary

Replace the inline `AddUrlForm` in `ReadingListPanel` with a centered modal that supports multi-URL input via a textarea, live validation preview, async title extraction, HTTP security warnings, and improved relative time display on reading list items.

## Current State

- `AddUrlForm` is an inline panel inside `ReadingListPanel.tsx` (lines 243-331)
- Single URL input field + optional title + vault selector dropdown
- Store's `addItem(url, title, vaultPath, vaultName)` requires explicit vault params
- `timeAgo()` in `ReadingListItemCard.tsx` caps at `Xd ago` — no weeks/months
- `ReadingListItem.pageTitle` field exists but only gets set during full extraction

## Changes

### 1. Add URL Modal Component

**New file:** `src/ui/components/reading-list/AddUrlModal.tsx`

Follows the `SettingsModal` pattern: fixed overlay (`z-50`), backdrop click to close, Escape key handler. Approximately 480px wide, centered vertically and horizontally.

**Layout (top to bottom):**
- Header row: "Add URLs to Reading List" title + close (x) button
- Instruction text (muted): "Paste one URL per line"
- Textarea: 6 rows default height, monospace font (`font-mono`), auto-focus on mount
- Live preview section: parsed URL list with per-URL status indicators
- Footer row: Cancel button (text) + "Add N URLs" primary button (disabled when 0 valid new URLs)

**URL parsing (on every textarea change):**
1. Split value on `\n`
2. Trim each line, filter empty lines
3. For each non-empty line:
   - If no `https://` or `http://` prefix, prepend `https://`
   - Try `new URL(normalized)` — if it throws, mark as invalid
   - Check if URL already exists in `useReadingListStore.items` — if so, mark as duplicate
   - Check if URL appears earlier in the same batch — if so, mark as duplicate
   - Check if protocol is `http:` — if so, mark as insecure

**Preview indicators per parsed URL:**
- Valid HTTPS: green dot + domain hostname
- HTTP (insecure): amber warning icon + "insecure" label next to domain
- Duplicate (in store or within batch): grayed out text + "already added" label
- Invalid: red x + grayed line text

**"Add N URLs" button:** count = valid, non-duplicate URLs. Disabled when count is 0.

### 2. Vault Resolution

Remove vault selection from the add flow entirely. The store's `addItem` method will internally resolve the current vault.

**Resolution logic inside `addItem`:**
1. Call `vaultWorkspace.getStatus()` via the platform layer
2. If `status.open === true`: use `status.path` and `status.name` as `targetVaultPath` / `targetVaultName` on the new item
3. If `status.open === false` (edge case — vault closed between opening modal and clicking Add): set `targetVaultPath` to `undefined`. The existing filter in `ReadingListPanel` already handles this — items without `targetVaultPath` are shown in all vaults (`if (!i.targetVaultPath) return true`). The item will appear in whichever vault the user opens next and will be scoped to that vault once extraction runs.

In practice, this fallback cannot trigger. `App.tsx` gates the entire UI behind `vaultOpen` — if no vault is open, the user sees `VaultSetupScreen` and cannot reach `ReadingListPanel` at all. The fallback exists only as defensive code against future layout changes.

**Store signature change:** `addItem(url: string, title: string)` — drop `vaultPath` and `vaultName` params. Vault is resolved internally.

### 3. Async Title Extraction

After adding URLs, kick off background title resolution for each new item.

**Flow per URL:**
1. Item appears in the reading list with domain name as placeholder title (e.g., "arxiv.org")
2. Fetch HTML via existing IPC: `electronIPC.invoke('fetch-url-content', url)`
3. Parse `<title>` tag from HTML using `DOMParser`
4. Evaluate title quality: if the title is empty, matches the domain, or is a generic error string (e.g., "404", "Page Not Found", "Access Denied"), treat it as no title
5. If no usable title: use the configured LLM to generate a short title (approximately 5-8 words) from the first 2000 characters of page content. System prompt: "Generate a concise title (about 5-8 words) for this web page content. Return only the title text, nothing else."
6. Store the resolved title in `item.pageTitle`
7. Persist to storage

**New store method:** `fetchTitles(urls: string[])` — processes URLs sequentially with a ~500ms delay between each to avoid hammering the network. Skips URLs that already have a `pageTitle`.

**Error handling:** If fetch fails (network error, timeout), leave the domain placeholder in place. Do not retry automatically — the title will be resolved during the full extraction step if the user triggers it.

### 4. HTTP Indicator on Item Cards

In `ReadingListItemCard.tsx`, check `item.url.startsWith('http://')` at render time.

If true, render a small amber shield icon inline with the domain text in the metadata row. The icon uses an inline SVG (shield with exclamation mark) at 12x12px with `text-amber-500` color. Title attribute: "Insecure connection (HTTP)".

No new data field on `ReadingListItem` — purely a render-time check.

### 5. Enhanced Relative Time Display

Replace the `timeAgo()` function in `ReadingListItemCard.tsx` with an improved version:

| Elapsed time | Display format |
|---|---|
| < 1 minute | "just now" |
| 1-59 minutes | "X min ago" |
| 1-23 hours | "X hours ago" |
| 1-6 days | "X days ago" |
| 7-29 days | "X weeks ago" |
| 30-364 days | "X months ago" |
| 365+ days | "X years ago" |

All singular/plural handled: "1 day ago" vs "3 days ago".

In the card display, prefix with "Added": "Added 2 weeks ago".

The `ReadingListHistory` component's date display (`mergedDate`) is unchanged — it shows the merge date, not the add date.

### 6. Files Changed

| File | Change |
|---|---|
| `src/ui/components/reading-list/AddUrlModal.tsx` | **New.** Modal component with textarea, URL parsing, live preview |
| `src/ui/components/reading-list/ReadingListPanel.tsx` | Replace `AddUrlForm` with `AddUrlModal`. Remove `AddUrlForm` function. Remove vault-related state from add flow. Keep vault state for item filtering. |
| `src/ui/components/reading-list/ReadingListItemCard.tsx` | Enhance `timeAgo()`. Add HTTP indicator. Prefix "Added" to time display. |
| `src/graph/store/reading-list-store.ts` | Simplify `addItem` signature. Add `fetchTitles` method. Auto-resolve vault internally. |

### 7. Companion Extension (Unchanged)

The Chrome companion extension has its own code path for adding URLs (`useCompanionCapture` hook → direct storage write → store reload). This is **not modified** by this spec.

Companion-added items use the title from `document.title` in Chrome (fallback: the URL itself). No async title extraction is applied — the companion-provided title is accepted as-is.

**Vault resolution note:** The companion sends `targetVaultPath`/`targetVaultName` from a cached vault list, but `useCompanionCapture` overrides these with the current Electron vault via `getStatus()`. The companion's vault selection is effectively unused. This is pre-existing behavior and out of scope for this change.

### 8. Out of Scope

- Drag-and-drop URL import
- URL metadata enrichment beyond title (favicon, description, preview image)
- Batch title extraction progress indicator in the UI
- Changes to the Chrome extension code path (deprecated)
