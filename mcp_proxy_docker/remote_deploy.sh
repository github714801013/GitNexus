#!/bin/bash
# 远程部署脚本 - 绕过本地 Docker 缺失问题

REMOTE_HOST="10.1.14.177"
REMOTE_USER="ji99"
REMOTE_PATH="/home/ji99/Project/mcp_gitnexus_server"
IMAGE_NAME="gitnexus-mcp-proxy"
ARCHIVE_NAME="gitnexus_deploy.tar.gz"

echo "--- 步骤 1: 打包源码 (排除 node_modules, models) ---"
# 在项目根目录下执行
tar --exclude='node_modules' --exclude='.git' --exclude='.history' --exclude='mcp_proxy_docker/models' \
    -czf "$ARCHIVE_NAME" \
    gitnexus gitnexus-shared gitnexus-web mcp_proxy_docker

echo "--- 步骤 2: 发送源码到远程服务器 ---"
scp "$ARCHIVE_NAME" mcp_proxy_docker/auto_verify.py repos.json "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_PATH}/"

echo "--- 步骤 3: 远程执行构建与部署 ---"
ssh "${REMOTE_USER}@${REMOTE_HOST}" -T << EOF
    set -e
    cd "${REMOTE_PATH}"
    echo "正在解压源码..."
    tar -xzf "$ARCHIVE_NAME"
    
    echo "正在构建 Docker 镜像 (可能需要 5-10 分钟)..."
    docker build --network=host --progress=plain \
        --build-arg VITE_BACKEND_URL="http://${REMOTE_HOST}:1349" \
        -t "${IMAGE_NAME}:latest" -f mcp_proxy_docker/Dockerfile .
    
    echo "停止并移除旧容器..."
    docker stop "${IMAGE_NAME}" 2>/dev/null || true
    docker rm "${IMAGE_NAME}" 2>/dev/null || true
    
    echo "启动新容器 (映射 /home/ji99/gitnexus -> /projects)..."
    docker run -d --name "${IMAGE_NAME}" \
        --gpus all \
        -p 1347:1347 -p 1348:1348 -p 1349:1349 -p 1350:1350 \
        -v /home/ji99/gitnexus:/projects \
        -v "${REMOTE_PATH}/models:/app/models" \
        -v "/home/ji99/.gitnexus:/root/.gitnexus" \
        --restart always \
        -e GITEA_TOKEN="401a8a2a8339719a3a313eece19bc1d312f3531b" \
        -e GITNEXUS_EMBEDDING_BATCH_SIZE=32 \
        -e GITNEXUS_EMBEDDING_MODEL="twright8/gte-Qwen2-1.5B-instruct-onnx-fp16" \
        -e GITNEXUS_EMBEDDING_DIMS=1536 \
        -e GITNEXUS_ALLOW_REMOTE_MODELS=true \
        -e GITNEXUS_USE_FLASH_ATTENTION=true \
        "${IMAGE_NAME}:latest"
    
    echo "--- 步骤 4: 启动全自动验证程序 ---"
    python3 auto_verify.py
    
    echo "清理远程压缩包与无用镜像..."
    rm "$ARCHIVE_NAME"
    docker image prune -f
EOF

echo "--- 步骤 5: 清理本地压缩包 ---"
rm "$ARCHIVE_NAME"

echo "远程部署完成，正在查看初始启动日志..."
ssh "${REMOTE_USER}@${REMOTE_HOST}" -t "docker logs --tail 20 ${IMAGE_NAME}"
