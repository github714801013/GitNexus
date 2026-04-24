#!/bin/bash
set -e

# Link the node_modules so that absolute imports work as expected
mkdir -p /app/gitnexus/node_modules
ln -sfn /app/gitnexus-shared /app/gitnexus/node_modules/gitnexus-shared

# Add compiled JS path to PATH for gitnexus command
export PATH="/app/gitnexus/dist/gitnexus/src/cli:$PATH"
export HF_HOME="/app/models"
export GITNEXUS_EMBEDDING_MODEL="Xenova/bge-small-zh-v1.5"
export GITNEXUS_EMBEDDING_DIMS="512"
export GITNEXUS_FTS_STEMMER="none"
export GITNEXUS_REMOTE_DEPLOY="true"
export GITNEXUS_EMBEDDING_DEVICE="cuda"
# 持久化 registry 到挂载卷，避免容器重启后丢失索引注册信息
export GITNEXUS_HOME="/projects/.gitnexus"
mkdir -p "$GITNEXUS_HOME"

# Ensure CUDA and cuDNN libraries are found
export LD_LIBRARY_PATH="/usr/local/cuda-12/targets/x86_64-linux/lib:/usr/local/cuda-12/compat:/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH"

# Change directory to the proxy app
cd /app/mcp_proxy

# 1. Start the uvicorn server in the background (handles webhooks and indexing)
echo "Starting GitNexus Webhook and Watcher service on port 1347..."
uvicorn app.main:app --host 0.0.0.0 --port 1347 --log-level info &

# 2. Start the GitNexus HTTP API for Graphical UI on port 1349
echo "Starting GitNexus HTTP API (UI Backend) on port 1349..."
node /app/gitnexus/dist/gitnexus/src/cli/index.js serve --port 1349 --host 0.0.0.0 &

# 3. Start the GitNexus Web UI on port 1350
echo "Starting GitNexus Web UI on port 1350..."
# Vite build output is usually in 'dist'
serve -s /app/gitnexus-web/dist -l tcp://0.0.0.0:1350 &

# Wait a bit for initialization
sleep 2

# 4. Start the mcp-proxy in the foreground (exposes gitnexus mcp as SSE)
echo "Starting mcp-proxy (SSE) wrapping 'node /app/gitnexus/dist/gitnexus/src/cli/index.js mcp' on port 1348..."
exec mcp-proxy --port 1348 --address 0.0.0.0 node /app/gitnexus/dist/gitnexus/src/cli/index.js mcp
