#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VAULT_DB="${1:-$HOME/Desktop/obsidian/.kg/graph.db}"

if [ ! -f "$VAULT_DB" ]; then
  echo "Error: database not found at $VAULT_DB"
  echo "Usage: $0 [path/to/graph.db]"
  exit 1
fi

BACKUP="${VAULT_DB}.bak.$(date +%Y%m%d_%H%M%S)"
cp "$VAULT_DB" "$BACKUP"
echo "Backed up → $BACKUP"

BEFORE_NODES=$(sqlite3 "$VAULT_DB" "SELECT count(*) FROM nodes;")
BEFORE_EDGES=$(sqlite3 "$VAULT_DB" "SELECT count(*) FROM edges;")

sqlite3 "$VAULT_DB" < "$SCRIPT_DIR/seed-demo-data.sql"

AFTER_NODES=$(sqlite3 "$VAULT_DB" "SELECT count(*) FROM nodes;")
AFTER_EDGES=$(sqlite3 "$VAULT_DB" "SELECT count(*) FROM edges;")

echo "Nodes: $BEFORE_NODES → $AFTER_NODES (added $((AFTER_NODES - BEFORE_NODES)))"
echo "Edges: $BEFORE_EDGES → $AFTER_EDGES (added $((AFTER_EDGES - BEFORE_EDGES)))"
echo "Done."
