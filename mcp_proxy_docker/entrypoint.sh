#!/bin/bash
set -e

# Link the node_modules so that absolute imports work as expected
mkdir -p /app/gitnexus/node_modules
ln -sfn /app/gitnexus-shared /app/gitnexus/node_modules/gitnexus-shared

# Add compiled JS path to PATH for gitnexus command
export PATH="/app/gitnexus/dist/gitnexus/src/cli:$PATH"
export HF_HOME="${HF_HOME:-/app/models}"
export GITNEXUS_EMBEDDING_MODEL="${GITNEXUS_EMBEDDING_MODEL:-Xenova/bge-small-zh-v1.5}"
export GITNEXUS_EMBEDDING_DIMS="${GITNEXUS_EMBEDDING_DIMS:-512}"
export GITNEXUS_FTS_STEMMER="${GITNEXUS_FTS_STEMMER:-none}"
export GITNEXUS_REMOTE_DEPLOY="${GITNEXUS_REMOTE_DEPLOY:-true}"
export GITNEXUS_EMBEDDING_DEVICE="${GITNEXUS_EMBEDDING_DEVICE:-cuda}"
export GITNEXUS_EMBEDDING_BATCH_SIZE="${GITNEXUS_EMBEDDING_BATCH_SIZE:-16}"
# 持久化 registry 到挂载卷，避免容器重启后丢失索引注册信息
export GITNEXUS_HOME="${GITNEXUS_HOME:-/projects/.gitnexus}"
mkdir -p "$GITNEXUS_HOME"

# Ensure CUDA and cuDNN libraries are found.
# NOTE: /usr/local/cuda-12/compat is intentionally excluded — it contains
# libcuda.so.560.35.05 which conflicts with the host driver (590+) mounted
# by the NVIDIA container runtime, causing CUDA error 803 (driver mismatch).
export LD_LIBRARY_PATH="/usr/local/cuda-12/targets/x86_64-linux/lib:/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH"

# Route analyze subprocess embedding calls through the serve process (port 1349).
# This ensures only one CUDA session exists (in the serve process), preventing
# concurrent GPU memory allocation from multiple analyze subprocesses.
export GITNEXUS_EMBEDDING_URL="${GITNEXUS_EMBEDDING_URL:-http://localhost:1349/v1}"

# Change directory to the proxy app
cd /app/mcp_proxy

# 1. Start the uvicorn server in the background (handles webhooks and indexing)
echo "Starting GitNexus Webhook and Watcher service on port 1347..."
uvicorn app.main:app --host 0.0.0.0 --port 1347 --log-level info &

# 2. Start the GitNexus HTTP API (UI Backend) on port 1349
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
