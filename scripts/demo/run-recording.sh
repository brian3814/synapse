#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_ROOT"

# Check ffmpeg
if ! command -v ffmpeg &>/dev/null; then
  echo "Error: ffmpeg is required. Install with: brew install ffmpeg"
  exit 1
fi

# Build Electron if main.js is missing or stale
MAIN_JS="dist-electron/main/main.js"
if [ ! -f "$MAIN_JS" ]; then
  echo "Building Electron app..."
  npm run build:electron
else
  echo "Electron build exists, skipping. Run 'npm run build:electron' to rebuild."
fi

# Create output dir
mkdir -p docs/images/demo

# Run the recording
echo ""
echo "Starting demo recording..."
echo ""
npx tsx scripts/demo/record-demo.ts

echo ""
echo "Done. Output:"
echo "  Screenshots: docs/images/demo/step-*.png"
echo "  GIF:         docs/images/demo/demo-workflow.gif"
