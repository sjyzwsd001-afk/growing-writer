#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_DIR="$ROOT_DIR/content-writer"
DST_DIR="$HOME/.openclaw/workspace/skills/content-writer"

mkdir -p "$DST_DIR"
rsync -a --delete --exclude "__pycache__" "$SRC_DIR/" "$DST_DIR/"

echo "Synced content-writer skill to: $DST_DIR"
