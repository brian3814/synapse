# SQLite + Filesystem Sync Research

How products that store file path references in SQLite handle the database-vs-filesystem consistency problem. Conducted May 2026 to evaluate Synapse's reconciliation architecture against industry patterns.

## The Core Problem

When a database stores references to files on disk, those references can become stale: the user moves, renames, or deletes a file outside the app. The database says the file is at X, but it's actually at Y (or gone). Every product that manages files through a database faces this.

---

## Three Architectural Tiers

### Tier 1: Filesystem IS the source of truth (index is a disposable cache)

| Product | Index | Reconciliation | Tradeoff |
|---|---|---|---|
| **Obsidian** | In-memory MetadataCache + IndexedDB | Full directory scan on vault open; `fs.watch` during runtime | External renames break incoming wikilinks silently — no link repair |
| **macOS Spotlight** | Custom index in `.Spotlight-V100/` | Kernel-level FSEvents → `mdworker` processes rebuild index | Delete `.Spotlight-V100/` to rebuild from scratch. Index is disposable |
| **Windows Search** | ESE (Win10) / SQLite (Win11) in `ProgramData` | NTFS USN Journal (volume-wide changelog) drives indexer. Journal persists across reboots | Journal can roll over (fixed size, old entries discarded) |

These systems treat the index as derived. If it corrupts, delete it and rebuild from the filesystem.

### Tier 2: Database IS the source of truth (filesystem is managed/projected)

| Product | Database | File Identity | When Files Move Externally |
|---|---|---|---|
| **Calibre** | SQLite (`metadata.db`) | Controlled folder structure: `Author/Title (id)/file.ext`. Per-book OPF sidecar files | `Restore Database` rebuilds SQLite from OPF files. Gold standard for resilience |
| **Lightroom Classic** | SQLite (`.lrcat`) | Normalized: `RootFolder.absolutePath` + `Folder.pathFromRoot` + `File.baseName.ext` | `Find Missing Folder` relinks a root — one DB row update fixes all children |
| **Apple Photos** | SQLite (`Photos.sqlite`) | CFURL bookmarks: path + inode + volume ID (dual-source lookup) | Same-volume moves survive via inode fallback. Cross-volume/cross-machine = broken |
| **Logseq DB** | SQLite (`db.sqlite`) | No files to track — content lives in DB. Markdown Mirror is a one-way projection | N/A — there are no external files to move |
| **Spacedrive** | SQLite (via Prisma) | Relative path + BLAKE3 hash + platform file ID + deterministic v5 UUID | Hash-based relocation finds moved files anywhere. Most resilient approach |

### Tier 3: Database stores references to unmanaged files (the pain zone)

| Product | Database | Path Format | When Files Move Externally |
|---|---|---|---|
| **Zotero** | SQLite (`zotero.sqlite`) | Relative paths with configurable base directory (`attachments:subfolder/file.pdf`) | "Missing" indicator. No watcher. Manual relink or batch path rewriting via Zutilo plugin |
| **DEVONthink** | Proprietary bundle | Absolute paths (indexed mode) | No file watcher. Manual `Update Indexed Items` required |
| **iTunes / Music.app** | SQLite (`.musicdb`) | Absolute paths | Missing tracks greyed out. Fix-one-at-a-time. Mass breakage on drive letter change |
| **Rekordbox** | Encrypted SQLite (`master.db`) | Absolute paths | "Relocate" searches by filename (not hash). Doesn't scale. Encryption blocks external repair |
| **Serato** | Proprietary binary (TLV encoding) | Absolute paths | "Relocate Lost Files" feature. In-memory-first — external edits overwritten on app close |

The DJ software and iTunes are cautionary tales: absolute paths, no fallback identity, no file watcher, no bulk relocation.

---

## Product Deep Dives

### Obsidian

**Architecture:** Filesystem is canonical. MetadataCache is an in-memory index persisted to IndexedDB.

**What MetadataCache stores:** Parsed YAML frontmatter, headings, links (resolved and unresolved), tags, embeds — keyed by vault-relative file paths. `resolvedLinks` maps `{sourcePath: {destPath: linkCount}}`.

**Internal renames:** `FileManager.renameFile()` queries MetadataCache for all files linking to the renamed file, then updates those links in-place in the Markdown source.

**External renames:** Links break silently. Obsidian detects the file change via `fs.watch` (recursive mode on macOS/Windows), re-indexes at the new path, but does NOT update links pointing to the old path. Old links become "unresolved."

**Reconciliation:** Full directory scan on vault open rebuilds MetadataCache from scratch. The `'resolved'` event fires when all files are indexed. The `'changed'` event is NOT fired for renames (performance optimization) — plugins must listen to the vault `rename` event separately.

### Calibre — Gold Standard

**Architecture:** SQLite as primary DB, but every book also has an OPF (XML) sidecar file on disk containing full metadata. The filesystem can reconstruct the database, and the database controls the filesystem.

**Folder structure is deterministic:** `Author Name/Title (id)/filename.ext`. The `id` in the folder name matches the book record ID in SQLite. No arbitrary paths — Calibre owns the structure entirely.

**Reconciliation tools:**
- `Library Maintenance > Restore Database` rebuilds `metadata.db` entirely from OPF sidecar files
- `Check Library` runs integrity checks: `invalid_titles`, `extra_titles`, `missing_formats`, `extra_formats`, `extra_files`, `missing_covers`, `malformed_paths`, `failed_folders`

**Why it works:** Bidirectional recoverability. Corrupt DB → rebuild from OPF. Corrupt filesystem → rebuild from DB. Neither side is a single point of failure.

### Lightroom Classic — Normalized Path Tables

**Schema:**
```
AgLibraryRootFolder: absolutePath (e.g., /Users/brian/Pictures/)
  └─ AgLibraryFolder: pathFromRoot (e.g., 2026/vacation/)
       └─ AgLibraryFile: baseName + extension (e.g., IMG_0001.CR3)
```

Full path reconstructed via JOIN: `root.absolutePath + folder.pathFromRoot + file.baseName + '.' + file.extension`.

**Key insight:** Moving a root folder = updating one row in `AgLibraryRootFolder`. All child paths resolve correctly instantly. This three-level normalization means most file operations only touch leaf rows.

**Tools:** `Find All Missing Photos` creates a "Missing Photographs" collection. `Find Missing Folder` relinks an entire folder tree. Click `!` badge on individual photos to relocate.

### Spacedrive — Most Resilient

**Four-layer file identity:**

| Layer | Purpose | Survives |
|---|---|---|
| Relative path | Primary lookup (O(1)) | Vault root moving as a unit |
| BLAKE3 content hash (`cas_id`) | Content-addressable identity | Any move, any device |
| Platform file ID (inode/file index) | Same-volume rename tracking | Renames without content change |
| Deterministic v5 UUID (from hash) | Cross-device dedup | Any move, any device |

**Reconciliation:** Unified `ChangeHandler` processes both file watcher events and batch indexer jobs through the same code path. Categorizes changes as "deleted from DB view," "new to DB," or "modified (mtime/size differs)." Writes in batches of 1,000 to minimize SQLite locking.

**Safety:** Processing phase validates that indexing paths stay within location boundaries, preventing watcher routing bugs from causing cross-location deletions.

### Apple Photos — CFURL Bookmarks

**Dual-source resolution:**
1. Try absolute path first
2. If path fails, search by inode on same volume
3. If both fail (cross-volume move + rename), bookmark is broken

**Limitation:** Security-scoped bookmarks contain a machine-specific SHA-256 digest. Moving a library between Macs breaks all referenced file links. Apple recommends bookmarks for "small numbers of files" — not practical for tracking millions.

### Zotero — Relative Paths with Base Directory

**Two attachment modes:**
- **Stored:** Files copied into `storage/` subfolder with 8-char random directory names. Path stored with `storage:` prefix
- **Linked:** Files stay at original location. If "Linked Attachment Base Directory" is set, paths use `attachments:` prefix (relative). Otherwise absolute paths

**The base directory pattern:** Changing the base directory setting updates resolution for all relative paths at once. Useful for portability between machines — update one setting, all links resolve. But no watcher, no hash matching, no automatic detection.

---

## Technical Approaches to File Identity

### File Watching APIs

| Platform | API | Scope | Rename Detection | Caveat |
|---|---|---|---|---|
| **macOS** | FSEvents | Directory-level (coalesced) | No native rename pairing — "something changed" only | Designed for backup (Time Machine), not sync. Events arrive out of order, can be missing or duplicated |
| **macOS** | kqueue | Per-file descriptor | Yes, per-file | Poor scalability (1 fd per file) |
| **Linux** | inotify | Per-directory watch | Yes, via `IN_MOVED_FROM`/`TO` cookie pairing | Cookie pairing is racy — events not atomically queued |
| **Linux** | fanotify | Mount/filesystem-wide | Yes (since Linux 5.1), inode-based | Requires `CAP_SYS_ADMIN` |
| **Windows** | ReadDirectoryChangesW | Per-directory | Yes, paired old/new filename records | Buffer overflow drops events silently |
| **Windows** | USN Journal | Volume-wide (journal) | Yes, journal-based | Journal has fixed size — old entries discarded |
| **Cross-platform** | Chokidar (Node.js) | Uses native APIs per platform | No rename event — emits `unlink` + `add` | Wrapper abstractions hide platform-specific capabilities |

**Key insight:** FSEvents treats notifications as "hint to rescan" not authoritative events. Robust apps must do periodic consistency checks regardless of watcher reliability.

### OS-Level File Identity

| Platform | Mechanism | Survives Rename | Survives Cross-Volume Move | Portable |
|---|---|---|---|---|
| **macOS (APFS)** | Inode number | Yes (same volume) | No | No (volume-scoped) |
| **macOS** | NSURL Bookmark | Yes (path + inode dual lookup) | No | No (machine-specific) |
| **Windows (NTFS)** | File ID | Yes (same volume) | No | No (volume-scoped) |
| **Windows (NTFS)** | Object ID (FSCTL) | Yes (survives backup/restore too) | No | No |
| **Linux** | Inode | Yes (same filesystem) | No | No (filesystem-scoped) |

All OS-level mechanisms are volume/filesystem-scoped. Cross-volume moves require content hashing.

### Content Hashing

| Algorithm | Speed vs SHA-256 | Properties |
|---|---|---|
| **BLAKE3** | 3-14x faster (SIMD-parallelized) | Used by Spacedrive. Not FIPS-compliant |
| **xxHash (XXH3)** | ~10x faster | Non-cryptographic. Good for dedup, not integrity |
| **Partial hash** (first 4KB + last 4KB + file size) | Minimal I/O | Catches most changes. False positives on files differing only in the middle |

**Tradeoff:** Full content hashing is expensive for large files but enables finding moved files anywhere on disk. Partial hashing is a practical compromise for change detection without full I/O cost.

### Path Storage Strategies

| Strategy | Pros | Cons | Used By |
|---|---|---|---|
| **Absolute** | Unambiguous, no resolution needed | Breaks on drive/mount change, not portable | iTunes, Rekordbox, Serato |
| **Relative to vault/library root** | Portable when root moves as a unit | Cannot reference files outside root | Synapse, Obsidian, Calibre |
| **Base directory + relative** | Portable across machines (update one setting) | Requires user to update base dir on new machine | Zotero |
| **Normalized (root + folder + file)** | One row update fixes entire subtree | More complex schema | Lightroom |
| **Content-addressed** | Survives any move | Expensive to compute; ambiguous for duplicates | Spacedrive |
| **Hybrid (path + inode + hash)** | Maximum resilience | Maximum complexity | Spacedrive |

---

## Patterns and Anti-Patterns

### What the Best Systems Do

1. **Dual recoverability** (Calibre): DB can rebuild from filesystem (OPF sidecars). Filesystem can rebuild from DB. Neither is a single point of failure.

2. **Layered file identity** (Spacedrive): Path for fast lookup, content hash for surviving moves, platform file ID for surviving renames. Each layer covers a different failure mode.

3. **Normalized path hierarchy** (Lightroom): Separating root, folder, and filename into three tables. Root folder relocation = one row update, all children resolve correctly.

4. **Relative paths** to a known root (Calibre, Obsidian, Synapse): Nearly every successful system uses relative paths, not absolute. Vault/library can move freely.

5. **Startup reconciliation** (Obsidian, Spacedrive, Windows Search): Full or incremental scan on startup catches changes made while the app was closed. File watchers alone miss offline mutations.

6. **Treat watcher events as hints** (Obsidian, Spacedrive): Verify with `stat`/`exists` rather than trusting event types. FSEvents in particular is designed to coalesce and may miss events.

### What Causes Pain Everywhere

1. **Absolute paths without fallback** (iTunes, Rekordbox, Serato): The single most common cause of the "missing file" problem in desktop software.

2. **No file watcher / no startup scan** (DEVONthink indexed mode, Zotero): Requires manual intervention to detect any external change.

3. **Machine-specific identity** (Apple Photos security-scoped bookmarks): Breaks when moving libraries between machines.

4. **In-memory-first architecture** (Serato): Overwrites on-disk database from memory on close. External repairs get silently destroyed.

5. **No bulk relocation tools** (Rekordbox, Serato, iTunes): Fix-one-at-a-time doesn't scale to large collections.

6. **Encryption blocking external repair** (Rekordbox SQLCipher): When the DB corrupts, third-party tools can't help.

---

## Where Synapse Sits

### Already Doing Well

- **Relative paths** (`vault_path` column) — portable when the vault directory moves
- **Startup reconciliation** — full filesystem walk comparing against DB on vault open
- **File watcher** — `fs.watch` with `recursive: true` (maps to FSEvents on macOS)
- **Debounced event processing** — treats watcher events as hints, verifies with `statSync`
- **App-written file exclusion** — `recentlyWritten` set prevents echo loops
- **DB as source of truth** with filesystem as projection — clear authority model

### Potential Improvements

**1. Content hashing for moved-file detection (Spacedrive pattern)**

Current behavior: file moved within vault = "orphaned DB entry + new unknown file." Adding even a partial hash (first 4KB + file size) to the node record would enable matching moved files to their DB entries during reconciliation.

Complexity: Low (partial hash) to Medium (full BLAKE3). Benefit increases with vault size.

**2. Per-node sidecar metadata (Calibre pattern)**

Current state: if `graph.db` corrupts, the graph is lost. Notes survive (they're `.md` on disk) but entity metadata, edges, and type information do not.

Potential: Write node metadata into note frontmatter (type, tags, key properties) so the graph could be partially reconstructed from the `.md` files on disk. Synapse already stores some metadata in frontmatter — extending this to include graph relationships would provide Calibre-level resilience.

Complexity: Medium. Tradeoff: frontmatter becomes heavier; bidirectional sync between frontmatter and DB adds reconciliation surface.

**3. Normalized path hierarchy (Lightroom pattern)**

If Synapse ever needs to support nested vault directory restructuring (user moves a subfolder), Lightroom's three-table model (root + folder + file) enables fixing an entire subtree with one row update rather than updating every file record.

Complexity: Medium (schema change). Only worthwhile if vault restructuring becomes a real user problem.

---

## Sources

- [Obsidian MetadataCache API](https://docs.obsidian.md/Reference/TypeScript+API/MetadataCache)
- [Obsidian data storage](https://obsidian.md/help/data-storage)
- [Logseq DB version docs](https://github.com/logseq/docs/blob/master/db-version.md)
- [DEVONthink: Relocate indexed files](https://www.devontechnologies.com/blog/20211130-relocate-indexed-files)
- [Zotero data directory](https://www.zotero.org/support/zotero_data)
- [Adobe: Locate missing photos in Lightroom](https://helpx.adobe.com/lightroom-classic/help/locate-missing-photos.html)
- [Lightroom catalog schema](https://github.com/thatlarrypearson/LightroomClassicCatalogReader)
- [Calibre FAQ](https://manual.calibre-ebook.com/faq.html)
- [Calibre metadata.db schema](https://github.com/kovidgoyal/calibre/blob/master/resources/metadata_sqlite.sql)
- [Spacedrive v3 launch](https://spacedrive.com/blog/spacedrive-v3-launch)
- [Spacedrive VDFS architecture](https://www.spacedrive.com/docs/developers/architecture/vdfs)
- [Spacedrive indexing](https://v2.spacedrive.com/core/indexing)
- [Apple Photos forensics](https://github.com/RhetTbull/osxphotos/discussions/319)
- [How Spotlight works](https://eclecticlight.co/2021/01/28/spotlight-on-search-how-spotlight-works/)
- [Windows Search forensics](https://medium.com/@boutnaru/the-windows-forensic-journey-windows-search-index-windows-desktop-search-3055667197bd)
- [Serato missing files](https://support.serato.com/hc/en-us/articles/360000666795)
- [Rekordbox database encryption](https://github.com/liamcottle/pioneer-rekordbox-database-encryption)
- [FSEvents and volume journals](https://eclecticlight.co/2017/09/12/watching-macos-file-systems-fsevents-and-volume-journals/)
