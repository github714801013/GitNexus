#!/bin/bash
# 本地构建 Docker 镜像并推送到远端启动
# 解决远端构建时 NuGet 下载失败的问题

set -e

REMOTE_HOST="10.1.14.177"
REMOTE_USER="ji99"
REMOTE_PATH="/home/ji99/Project/mcp_gitnexus_server"
IMAGE_NAME="gitnexus-mcp-proxy"
IMAGE_TAR="gitnexus_image.tar.gz"

echo "=== 步骤 1: 本地构建 Docker 镜像 ==="
docker build --network=host --progress=plain \
    --build-arg VITE_BACKEND_URL="http://${REMOTE_HOST}:1349" \
    -t "${IMAGE_NAME}:latest" \
    -f mcp_proxy_docker/Dockerfile .

echo ""
echo "=== 步骤 2: 导出镜像为 tar.gz ==="
docker save "${IMAGE_NAME}:latest" | gzip > "/tmp/${IMAGE_TAR}"
echo "镜像大小: $(du -sh /tmp/${IMAGE_TAR} | cut -f1)"

echo ""
echo "=== 步骤 3: 上传镜像到远端 ==="
scp "/tmp/${IMAGE_TAR}" "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_PATH}/"

echo ""
echo "=== 步骤 4: 上传 repos.json 和 auto_verify.py ==="
scp mcp_proxy_docker/auto_verify.py repos.json "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_PATH}/"

echo ""
echo "=== 步骤 5: 远端加载镜像并启动容器 ==="
ssh "${REMOTE_USER}@${REMOTE_HOST}" -T << EOF
    set -e
    cd "${REMOTE_PATH}"

    echo "加载镜像..."
    docker load < "${IMAGE_TAR}"

    echo "停止并移除旧容器..."
    docker stop "${IMAGE_NAME}" 2>/dev/null || true
    docker rm "${IMAGE_NAME}" 2>/dev/null || true

    echo "启动新容器..."
    docker run -d --name "${IMAGE_NAME}" \
        --gpus all \
        -p 1347:1347 -p 1348:1348 -p 1349:1349 -p 1350:1350 \
        -v /home/ji99/gitnexus:/projects \
        --restart always \
        -e GITEA_TOKEN="401a8a2a8339719a3a313eece19bc1d312f3531b" \
        "${IMAGE_NAME}:latest"

    echo "清理远端镜像包..."
    rm -f "${IMAGE_TAR}"
EOF

echo ""
echo "=== 步骤 6: 验证 GPU 是否生效 ==="
ssh "${REMOTE_USER}@${REMOTE_HOST}" -T << 'VERIFY'
    echo "--- 检查 CUDA 二进制文件 ---"
    docker exec gitnexus-mcp-proxy ls -la \
        /app/gitnexus/node_modules/onnxruntime-node/bin/napi-v6/linux/x64/ 2>&1

    echo ""
    echo "--- 等待服务启动 (15s) ---"
    sleep 15

    echo "--- 查看启动日志 (GPU 相关) ---"
    docker logs gitnexus-mcp-proxy 2>&1 | grep -iE "cuda|gpu|device|embedding|onnx|error" | head -30

    echo ""
    echo "--- 完整启动日志 (最后 30 行) ---"
    docker logs --tail 30 gitnexus-mcp-proxy 2>&1
VERIFY

echo ""
echo "=== 清理本地临时文件 ==="
rm -f "/tmp/${IMAGE_TAR}"

echo ""
echo "部署完成！"
