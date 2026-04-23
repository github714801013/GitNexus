#!/bin/bash
set -e

# Link the node_modules so that absolute imports work as expected
mkdir -p /app/gitnexus/node_modules
ln -sfn /app/gitnexus-shared /app/gitnexus/node_modules/gitnexus-shared

# Add compiled JS path to PATH for gitnexus command
export PATH="/app/gitnexus/dist/gitnexus/src/cli:$PATH"

# Change directory to the proxy app
cd /app/mcp_proxy

# Start the uvicorn server in the background (handles webhooks and indexing)
echo "Starting GitNexus Webhook and Watcher service on port 1347..."
uvicorn app.main:app --host 0.0.0.0 --port 1347 --log-level info &

# Wait a bit for initialization
sleep 2

# Start the mcp-proxy in the foreground (exposes gitnexus mcp as SSE)
echo "Starting mcp-proxy (SSE) wrapping 'node /app/gitnexus/dist/gitnexus/src/cli/index.js mcp' on port 1348..."
exec mcp-proxy --port 1348 node /app/gitnexus/dist/gitnexus/src/cli/index.js mcp
