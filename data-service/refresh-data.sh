#!/bin/bash
set -e

cd "$(dirname "$0")"
echo "=== $(date): Starting data refresh ==="
npm run fetch
echo "=== $(date): Data refresh complete ==="
