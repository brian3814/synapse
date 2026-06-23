#!/bin/bash
# Download UMD vendor scripts for the artifact sandbox iframe.
# Uses React 18 UMD (React 19 dropped UMD builds). The sandbox is isolated
# from the main app so version mismatch doesn't matter.
# Run: bash scripts/fetch-sandbox-vendor.sh

set -euo pipefail

VENDOR_DIR="electron/sandbox/vendor"
mkdir -p "$VENDOR_DIR"

echo "Downloading vendor scripts for artifact sandbox..."

curl -sL "https://cdn.jsdelivr.net/npm/react@18/umd/react.production.min.js" -o "$VENDOR_DIR/react.production.min.js"
curl -sL "https://cdn.jsdelivr.net/npm/react-dom@18/umd/react-dom.production.min.js" -o "$VENDOR_DIR/react-dom.production.min.js"
curl -sL "https://cdn.jsdelivr.net/npm/sucrase@3/dist/sucrase.min.js" -o "$VENDOR_DIR/sucrase.min.js"
curl -sL "https://cdn.jsdelivr.net/npm/recharts@2/umd/Recharts.min.js" -o "$VENDOR_DIR/Recharts.min.js"
curl -sL "https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js" -o "$VENDOR_DIR/d3.min.js"

echo "Done. Files in $VENDOR_DIR:"
ls -lh "$VENDOR_DIR"
