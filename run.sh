#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
    echo "Installing dependencies..."
    npm install
    echo
fi

read -rp "Path to the repo you want to visualize: " REPO_DIR

if [ ! -d "$REPO_DIR" ]; then
    echo
    echo "That path doesn't exist: $REPO_DIR"
    exit 1
fi

echo
echo "Building graph..."
node src/languages/javascript/build-graph.js "$REPO_DIR" output/graph.json

echo
if [ -d "$REPO_DIR/.git" ]; then
    echo "Building history graph..."
    node src/languages/javascript/build-history-graph.js "$REPO_DIR" output/history-graph.json
else
    echo "No .git folder found in that path - skipping history playback build."
    rm -f output/history-graph.json
fi

echo
echo "Starting server at http://localhost:8090"
URL="http://localhost:8090/src/viewer/viewer.html"
( command -v xdg-open >/dev/null && xdg-open "$URL" ) || \
( command -v open >/dev/null && open "$URL" ) || \
echo "Open $URL in your browser."
node serve.js
