#!/bin/bash
# Kill any previous instance
pkill -f "python app.py" 2>/dev/null
sleep 1

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# Build frontend (compiles TypeScript → dist/)
npm run build

# Start Flask (serves dist/ + API on :5001)
"$DIR/venv-mac/bin/python" app.py
