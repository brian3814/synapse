# Handoff: Synapse UI Redesign

## Overview
Complete UI redesign of the Synapse desktop app — a local-first knowledge graph for personal knowledge management. The redesign moves from a developer-toolish IDE layout to a warmer, more approachable experience with an Obsidian/Notion-inspired sidebar and immersive graph visualization.

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes showing intended look and behavior, not production code to copy directly. The task is to **recreate these designs in the existing Electron + React 19 + Tailwind CSS 4 codebase** using its established patterns (Zustand stores, Three.js renderer, existing component hierarchy).

## Fidelity
These are **high-fidelity mockups** with final colors, typography, spacing, and component treatments. The developer should recreate the UI using the exact values documented below, adapting them to Tailwind utility classes and the existing component structure.

---

## Design Direction Summary

**Chosen direction:** B's full-height sidebar navigation + C's immersive graph treatment + floating panels on graph view.

**Key structural changes from current app:**
- **Remove** the top header bar entirely
- **Remove** the icon-only activity bar (32px)
- **Replace with** a 260px full-height left sidebar (Notion/Obsidian style) containing: logo, search, navigation, pinned entities, settings
- **Graph view**: floating glassmorphic detail panel (overlays graph, not fixed width)
- **Other views** (notes, reading list, sync): fixed layout panels (left panel pinned, right pane tabbed)
- **Chat**: dockable sidebar OR floating FAB — user toggles between modes
- **Settings**: full-window centered modal with glassmorphic treatment
- **Command palette (⌘K)**: centered overlay modal with grouped search results

---

## Screens / Views

### 1. Graph Exploration (Primary View)
**File:** `Synapse Workflows.dc.html` — Frame 1

**Layout:**
- Full-height sidebar (260px, fixed) | Graph canvas (remaining width)
- Detail panel floats over graph (300px, glassmorphic, top-right)
- Floating toolbar at bottom-center of graph area
- Chat FAB at bottom-right (42px circle)

**Sidebar (260px):**
- Background: `#0c0c0f`
- Border-right: `1px solid rgba(255,255,255,0.04)`
- Logo area: 22px gradient square (`linear-gradient(135deg, #a78bfa, #c084fc)`, border-radius 6px) + "Synapse" (600 14px Geist, `#e8e5e0`) + vault name (400 10px, `#71717a`)
- Search bar: height 32px, background `rgba(255,255,255,0.03)`, border `1px solid rgba(255,255,255,0.05)`, border-radius 8px, placeholder "Search..." with ⌘K hint
- Nav section label: "NAVIGATE" — 500 10px Geist, `#3f3f46`, uppercase, letter-spacing 0.06em
- Nav items: padding 7px 10px, border-radius 7px, gap 8px, icon 14×14 + label 400 13px
  - Active: background `rgba(167,139,250,0.08)`, border `1px solid rgba(167,139,250,0.1)`, icon stroke `#a78bfa`, text 500 `#c4b5fd`
  - Inactive: transparent bg, icon stroke `#71717a`, text 400 `#a1a1aa`
- Nav items: Graph (with node count), Notes (with count), Reading List (with green badge), Chat, Intelligence, Sync (with amber badge when pending)
- Pinned Entities section: label "PINNED ENTITIES", items show 6px colored dot + name (400 12px `#a1a1aa`) + type label (400 10px `#3f3f46`)
- Bottom settings: avatar circle (24px, gradient) + "Settings" text, border-top `1px solid rgba(255,255,255,0.04)`

**Graph canvas:**
- Background: `#07070a` (deepest dark)
- Dot-grid pattern: 20px spacing, 0.5px radius dots at `rgba(255,255,255,0.04)`
- Node circles: 5-7px radius, solid fill with entity-type color, `drop-shadow(0 0 3px {color}40)`
- Edge lines: 1px, `rgba(255,255,255,0.05)`
- Labels: 400 10-11px Geist, `rgba(255,255,255,0.5)`
- No glow/bloom effects on nodes

**Floating controls (top-left of graph):**
- Background: `rgba(9,9,11,0.75)`, border `1px solid rgba(255,255,255,0.05)`, border-radius 10px, padding 4px 6px, backdrop-filter blur(16px)
- Layer toggle pills: active has colored bg (`rgba(167,139,250,0.1)`) + border, 6px colored dot with box-shadow, 500 10px Geist label
- Stats: 400 10px Geist Mono, `#3f3f46`

**Floating detail panel (top-right, overlays graph):**
- Width: 300px, position absolute, top 10px right 10px bottom 56px
- Background: `rgba(12,12,15,0.88)`, border `1px solid rgba(255,255,255,0.05)`, border-radius 12px
- Backdrop-filter: `blur(20px)`, box-shadow: `0 8px 40px rgba(0,0,0,0.5)`
- Node name: 600 15px Geist `#e4e4e7` + colored dot (12px, with box-shadow glow)
- Type badge: padding 2px 8px, `rgba(type-color,0.1)` bg, border-radius 10px, 500 10px
- Tags: padding 3px 8px, `rgba(255,255,255,0.03)` bg, border `rgba(255,255,255,0.04)`, 400 10px `#52525b`
- Relationship rows: padding 7px 10px, `rgba(255,255,255,0.02)` bg, border-radius 8px, border `rgba(255,255,255,0.03)`
- Action buttons: "Open note" (indigo bg) + "Ask about" (neutral bg), border-radius 8px, 500 11px

**Floating toolbar (bottom-center of graph):**
- Similar glassmorphic treatment as controls
- Contains: zoom in/out, fit, refresh, extract, add node buttons
- Separated by 1px vertical dividers

**Chat FAB:**
- 42px circle, `linear-gradient(135deg, #6366f1, #818cf8)`, box-shadow `0 4px 20px rgba(99,102,241,0.35)`
- White chat icon inside (16px)

---

### 2. Note Editing
**File:** `Synapse Workflows.dc.html` — Frame 2

**Layout:** Sidebar (260px) | Full-width note editor

**Editor:**
- Header: node color dot (8px) + title (600 14px Geist) + type badge + Write/Preview toggle + saved status
- Content area: max-width 680px, centered, padding 32px 48px
- Title: 600 24px Geist, `#e4e4e7`, letter-spacing -0.02em
- Body: 400 14px/1.8 Geist, `#a1a1aa`
- Headings: 600 18px Geist, `#e4e4e7`
- Entity wikilinks: color `#e4e4e7`, font-weight 500, underline with `text-decoration-color: rgba(255,255,255,0.35)`, text-underline-offset 3px
- Bottom linked entities bar: border-top, entity chips with colored dots

---

### 3. Split View (Graph + Note)
**File:** `Synapse Workflows.dc.html` — Frame 3

**Layout:** Sidebar (260px) | Graph (flex 1) | Resize handle (3px) | Note (flex 1)

- Each pane has its own tab bar (30px height, 10px font)
- Active tab: 2px bottom border (graph = `#818cf8`, note = `#38bdf8`)
- Resize handle: 3px wide, `#0c0c0f`, 1px center line at `rgba(255,255,255,0.06)`
- Graph uses compact controls when narrower

---

### 4. Reading List + File Viewing
**File:** `Synapse Workflows.dc.html` — Frame 4

**Layout:** Sidebar (260px) | Reading list panel (360px, fixed) | File preview (flex 1)

**Reading list panel:**
- Tabs: Pending / Processing / Ready — pill-style toggle, 500 11px
- Items: padding 10px 12px, border-radius 8px, title 500 12px + domain/date 400 10px
- Selected item: `rgba(129,140,248,0.06)` bg with indigo border
- File type badge: PDF = amber, etc.
- Batch actions footer: "Extract selected" (indigo) + "Extract all" (neutral)

---

### 5. Extraction Review
**File:** `Synapse Workflows v2.dc.html` — Frame 5

**Layout:** Sidebar | Review list (420px, fixed left) | Graph preview (flex 1, right)

- Entity items: 8px colored dot + name + type badge + status badge (new=green, merge=indigo, removed=red+strikethrough)
- Relationship items: source → label → target inline
- Filter tabs: All / Entities / Edges / Notes
- Undo/Redo buttons in toolbar
- Bottom: "Add to Graph (N items)" full-width indigo button
- Right pane: graph with "Preview Merge" indicator badge

---

### 6. Vault Setup / Onboarding
**File:** `Synapse Workflows v2.dc.html` — Frame 6

**Layout:** Full-screen centered, no sidebar

- Centered card (440px width)
- Logo: 48px gradient square, border-radius 14px, box-shadow `0 8px 32px rgba(99,102,241,0.25)`
- Title: 700 24px Geist, `#e4e4e7`
- Subtitle: 400 14px/1.5, `#71717a`, centered
- "Create New Vault": gradient bg, 600 14px, white text, box-shadow
- "Open Existing Vault": `rgba(255,255,255,0.04)` bg, border, 500 14px
- Recent vaults: cards with 32px icon square + name + path (monospace) + entity count

---

### 7. Command Palette (⌘K)
**File:** `Synapse Workflows v2.dc.html` — Frame 7

- Centered overlay (520px wide), dimmed backdrop with blur(3px)
- Background: `rgba(14,14,17,0.96)`, border-radius 14px, box-shadow `0 16px 64px rgba(0,0,0,0.6)`
- Search input: 15px Geist, padding 14px 16px, ESC hint
- Results grouped: Entities, Notes, Relationships, Semantic matches
- Section headers: 600 10px uppercase with count
- First result highlighted: `rgba(129,140,248,0.08)` bg
- Result items: 13px Geist, colored dot for entities, return key hint on selected
- Footer: keyboard hints (↑↓ navigate, ↵ open, ⇧↵ split, esc close)

---

### 8. Entity Sync
**File:** `Synapse Workflows v2.dc.html` — Frame 8

**Layout:** Sidebar | Sync panel (380px, fixed left) | Graph (flex 1, right)

- Sync cards: padding 12px, border-radius 10px
- Issue type badges: Title mismatch (amber), New file (green), Broken link (amber) — uppercase 9px, colored bg
- Action buttons: primary action in indigo, secondary neutral
- When viewing a file: "viewing" badge on the selected card

---

### 9. Chat Sidebar (Docked)
**File:** `Synapse Chat Settings.dc.html` — Frame 9

**Layout:** Sidebar | Graph (flex 1) | Chat sidebar (360px, fixed right)

**Chat sidebar:**
- Header: session name (500 13px) + agent picker (green dot + "Default" + dropdown) + new chat + undock buttons
- User messages: right-aligned, `rgba(129,140,248,0.1)` bg, border-radius 14px 14px 2px 14px, text `#c4b5fd`
- Tool calls: collapsed single row, amber badges for tool names, green for results, expandable
- Assistant messages: left-aligned, `rgba(255,255,255,0.015)` bg, border-radius 14px 14px 14px 2px
- Entity links in text: `#e4e4e7`, font-weight 500, underline at `rgba(255,255,255,0.35)`
- Key relationships: list with colored dots (5px), 400 12px `#a1a1aa`
- Referenced entities: neutral gray chips (`rgba(255,255,255,0.03)` bg) with small colored dot, 400 10px `#a1a1aa`
- Pin to graph / Copy action buttons: neutral, 400 10px
- Context chips above input: neutral gray bg, colored dot + name `#a1a1aa` + dismiss ×
- Input: height 36px, border-radius 10px, gradient send button
- Quick action pills below input: border-radius 14px, 400 10px `#52525b`

---

### 10. Settings Modal
**File:** `Synapse Chat Settings.dc.html` — Frame 10

- Full-window overlay, centered modal (760×620px)
- Scrim covers everything including sidebar: `rgba(0,0,0,0.6)`, backdrop-filter blur(4px)
- Modal: `rgba(14,14,17,0.97)` bg, border-radius 14px
- Left nav (170px): icon + label nav items, same active style as sidebar
- Tabs: General, Model, Agents, Billing, About
- Card-based settings: padding 12px 14px, `rgba(255,255,255,0.02)` bg, border `rgba(255,255,255,0.04)`, border-radius 10px
- Toggle switches: 36×20px, `#6366f1` when on, white knob
- Section labels: 600 11px, `#52525b`, uppercase, letter-spacing 0.06em
- Danger zone: red accent, separated by red-tinted border-top

---

### Tabbed Right Pane Pattern
**File:** `Synapse Tabbed Panes.dc.html`

During extraction review or entity sync:
- Left pane = workflow panel (pinned)
- Right pane = tabbed content area (graph preview, notes, files)
- Tab bar: 30px height, 10px font, 2px colored bottom border on active
- Users can open notes/files while reviewing without losing workflow context

---

## Interactions & Behavior

| Action | Behavior |
|--------|----------|
| Click sidebar nav item | Switch main content view (graph/notes/reading list/etc.) |
| Click entity in graph | Show floating detail panel with entity info |
| Click "Open note" in detail panel | Open note editor (full-width or split view) |
| Click wikilink in note | Focus that entity in graph view |
| ⌘K | Open command palette overlay |
| ⇧↵ in command palette | Open result in split view |
| Drag tab to edge | Create split view |
| Click chat FAB | Open floating chat |
| Dock chat | Chat becomes fixed 360px right sidebar |
| Click "Pin to graph" on chat response | Save as note node, auto-link referenced entities |
| @ in chat input | Show entity autocomplete |
| Click sidebar "Sync" | Show sync panel with notification cards |
| Click filename on sync card | Open file in right pane tabs |

---

## Design Tokens

### Colors
| Token | Value | Usage |
|-------|-------|-------|
| bg-deepest | `#07070a` | Graph canvas |
| bg-deep | `#09090b` | App frame |
| bg-sidebar | `#0c0c0f` | Sidebar, panels |
| bg-surface | `rgba(255,255,255,0.02)` | Cards, items |
| bg-surface-hover | `rgba(255,255,255,0.04)` | Hover states |
| border-subtle | `rgba(255,255,255,0.03-0.04)` | Most borders |
| border-default | `rgba(255,255,255,0.05-0.06)` | Input borders, dividers |
| text-primary | `#e4e4e7` | Headings, primary text |
| text-secondary | `#a1a1aa` | Body text, nav labels |
| text-muted | `#71717a` | Placeholders, metadata |
| text-faint | `#52525b` | Disabled, hints |
| text-ghost | `#3f3f46` | Least emphasis |
| accent-violet | `#a78bfa` | Active nav, entity type |
| accent-violet-light | `#c4b5fd` | Active nav text, user msg |
| accent-indigo | `#6366f1` | Primary buttons, send |
| accent-indigo-light | `#818cf8` | Secondary accent |
| entity-person | `#f472b6` | Person nodes |
| entity-org | `#fbbf24` | Organization nodes |
| entity-tech | `#34d399` | Technology nodes |
| entity-concept | `#60a5fa` | Concept nodes |
| entity-ai-agent | `#a78bfa` | AI agent nodes |
| note-color | `#38bdf8` | Note type indicator |
| success | `#22c55e` | Badges, status |
| warning | `#f59e0b` | Sync issues |
| danger | `#ef4444` | Delete, danger zone |

### Typography
| Style | Value |
|-------|-------|
| Font family | Geist, system-ui, sans-serif |
| Font mono | Geist Mono, monospace |
| Page title | 700 22-24px, letter-spacing -0.02em |
| Section heading | 600 14-18px, letter-spacing -0.01em |
| Nav label | 400-500 13px |
| Body | 400 13-14px, line-height 1.7-1.8 |
| Small label | 500 10-11px |
| Section header | 600 10px, uppercase, letter-spacing 0.06em |
| Badge | 500-600 9-10px |
| Mono stats | 400 10px Geist Mono |

### Spacing & Radii
| Token | Value |
|-------|-------|
| Sidebar width | 260px |
| Chat sidebar width | 360px |
| Detail panel width | 300px |
| Nav item padding | 7px 10px |
| Card padding | 12px 14px |
| Border radius (cards) | 8-10px |
| Border radius (pills) | 10-14px |
| Border radius (modal) | 14px |
| Border radius (buttons) | 6-8px |

### Glassmorphic Surfaces
| Property | Value |
|----------|-------|
| Background | `rgba(9-14, 9-14, 11-17, 0.75-0.97)` |
| Border | `1px solid rgba(255,255,255,0.04-0.06)` |
| Backdrop-filter | `blur(12-20px)` |
| Box-shadow | `0 4-24px 16-64px rgba(0,0,0,0.3-0.6)` |

---

## Assets
- **Geist font**: loaded via Google Fonts (`https://fonts.googleapis.com/css2?family=Geist:wght@100..900&family=Geist+Mono:wght@100..900`)
- **Icons**: Lucide icon set (stroke-based, 14px default, stroke-width 2)
- **Logo mark**: CSS gradient square (`linear-gradient(135deg, #a78bfa, #c084fc)`), border-radius 6px

---

## Files in This Bundle
| File | Contents |
|------|----------|
| `Synapse Workflows.dc.html` | Frames 1-4: Graph exploration, note editing, split view, reading list |
| `Synapse Workflows v2.dc.html` | Frames 5-8: Extraction review, vault setup, command palette, entity sync |
| `Synapse Tabbed Panes.dc.html` | Frames 5a, 8a: Tabbed right pane during review/sync |
| `Synapse Chat Settings.dc.html` | Frames 9-10: Chat sidebar, settings modal |
| `Synapse Redesign v3.dc.html` | Earlier exploration: 3 layout variations (A/B/C) |

Open any `.dc.html` file in a browser to view the designs. Pan and zoom the canvas to see all frames.

---

## Migration Notes for Existing Codebase

### Components to Remove/Replace
- `Header.tsx` → remove entirely (no top bar)
- `ActivityBar.tsx` → remove (replaced by sidebar nav)
- `LeftSidebar.tsx` → replace with new full-height sidebar component
- `TabLayout.tsx` → restructure (sidebar + content area, no header)

### Components to Modify
- `ChatBot.tsx` → update styling, add tool call collapse, entity chips, pin-to-graph, context bar
- `NodeDetailPanel.tsx` → glassmorphic floating treatment on graph view, fixed panel elsewhere
- `SettingsModal.tsx` → full-window centered overlay, card-based settings
- `HeaderSearch.tsx` → becomes command palette modal (⌘K)
- `GraphControls.tsx` → floating glassmorphic toolbar
- `KnowledgeGraph.tsx` → deeper dark bg, dot-grid pattern
- `ContentTabBar.tsx` → update styling to match new tab treatment
- `VaultSetupScreen.tsx` → centered card with gradient logo

### New Components Needed
- Sidebar navigation component (replaces header + activity bar)
- Floating detail panel wrapper (glassmorphic, for graph view only)
- Chat context chip bar (redesigned)
- Quick action pills component
- Command palette modal

### State Changes
- `ui-store.ts`: remove `displayMode` header/activity-bar states, add sidebar nav state
- Existing `leftPanel` state can be repurposed for new sidebar sections
- `chatDisplayMode` stays (float vs sidebar)
