#!/bin/bash
set -e

# Change directory to the proxy app
cd /app/mcp_proxy

# Start the uvicorn server in the background (handles webhooks and indexing)
# Port changed from 8000 to 1347 per user requirement
echo "Starting GitNexus Webhook and Watcher service on port 1347..."
uvicorn app.main:app --host 0.0.0.0 --port 1347 --log-level info &

# Wait a bit for initialization
sleep 2

# Start the mcp-proxy in the foreground (exposes gitnexus mcp as SSE)
# Port changed from 3000 to 1348 per user requirement
echo "Starting mcp-proxy (SSE) wrapping 'gitnexus mcp' on port 1348..."
exec mcp-proxy --port 1348 "gitnexus mcp"
