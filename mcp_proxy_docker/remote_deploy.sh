#!/bin/bash
# GitNexus 远程部署脚本 (Bash 版)
# 功能：本地构建 -> 压缩导出 -> SCP 传输 -> 远程加载 -> 容器启动

set -e

# 配置参数
REMOTE_HOST="10.1.14.177"
REMOTE_USER="ji99"
REMOTE_PATH="/home/ji99/Project/mcp_gitnexus_server"
REGISTRY_URL="harbor.saas.ch999.cn:1088/common"
IMAGE_NAME="gitnexus-mcp-proxy"
TAR_FILE="gitnexus_noble_deploy.tar.gz"
: "${gitnexus_gitea_token:?gitnexus_gitea_token environment variable is required}"

# 自动修复 Windows Bash 下的 Docker 路径问题
DOCKER_HELPER_PATH=$(where.exe docker-credential-desktop.exe 2>/dev/null | head -n 1)
if [ -n "$DOCKER_HELPER_PATH" ]; then
    DOCKER_BIN_DIR=$(dirname "$DOCKER_HELPER_PATH" | sed 's/\\/\//g' | sed 's/C:/\/c/' | sed 's/c:/\/c/')
    export PATH="$PATH:$DOCKER_BIN_DIR"
fi

echo "=== 步骤 1: 本地构建镜像 (使用缓存) ==="
version=$(git rev-parse --short HEAD 2>/dev/null || echo "latest")
full_image_tag="${REGISTRY_URL}/${IMAGE_NAME}:${version}"

export DOCKER_BUILDKIT=1
MSYS_NO_PATHCONV=1 docker build -t "${full_image_tag}" -f mcp_proxy_docker/Dockerfile --build-arg VITE_BACKEND_URL=/ .

# 同时也打一个 latest 标签
docker tag "${full_image_tag}" "${IMAGE_NAME}:latest"

echo ""
echo "=== 步骤 2: 导出并压缩镜像 (流式操作，避免临时大文件) ==="
# 使用管道直接压缩，减少磁盘占用和 IO 锁风险
docker save "${IMAGE_NAME}:latest" | gzip > "${TAR_FILE}"

echo ""
echo "=== 步骤 3: 传输镜像和配置到远端 ==="
ssh "${REMOTE_USER}@${REMOTE_HOST}" -T << EOF
    set -e
    mkdir -p "${REMOTE_PATH}/models" /home/ji99/.gitnexus
    if [ -f "${REMOTE_PATH}/repos.json" ]; then cp "${REMOTE_PATH}/repos.json" "${REMOTE_PATH}/repos.json.bak"; fi
    if [ -f /home/ji99/gitnexus/repos.json ]; then cp /home/ji99/gitnexus/repos.json /home/ji99/gitnexus/repos.json.bak; fi
    if [ -f /home/ji99/.gitnexus/registry.json ]; then cp /home/ji99/.gitnexus/registry.json "${REMOTE_PATH}/registry.json.bak"; fi

    echo "备份现有索引 meta.json..."
    if docker image inspect "${IMAGE_NAME}:latest" >/dev/null 2>&1; then
        docker run --rm --entrypoint sh \
            -v /home/ji99/gitnexus:/projects \
            "${IMAGE_NAME}:latest" \
            -lc 'find /projects -path "*/.gitnexus/meta.json" -type f -exec cp -p {} {}.bak \;'
    else
        echo "WARN: ${IMAGE_NAME}:latest 不存在，跳过 meta.json 容器内备份"
    fi
EOF
scp "${TAR_FILE}" mcp_proxy_docker/auto_verify.py repos.json mcp_proxy_docker/docker-compose-vllm.yml "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_PATH}/"

echo ""
echo "=== 步骤 4: 远程部署与启动 ==="
ssh "${REMOTE_USER}@${REMOTE_HOST}" -T << EOF
    set -e
    cd "${REMOTE_PATH}"
    
    echo "正在加载镜像..."
    gunzip -c "${TAR_FILE}" | docker load
    
    echo "清理传输文件..."
    rm "${TAR_FILE}"

    echo "停止旧容器..."
    docker stop -t 30 "${IMAGE_NAME}" 2>/dev/null || true
    docker rm "${IMAGE_NAME}" 2>/dev/null || true

    echo "启动辅助引擎 (vLLM)..."
    docker compose -f docker-compose-vllm.yml up -d

    echo "启动主代理容器..."
    docker run -d --name "${IMAGE_NAME}" \
        --stop-timeout 300 \
        -p 1347:1347 -p 1348:1348 -p 1349:1349 -p 1350:1350 \
        -v /home/ji99/gitnexus:/projects \
        -v "${REMOTE_PATH}/models:/app/models" \
        -v "/home/ji99/.gitnexus:/root/.gitnexus" \
        --restart always \
        -e GITEA_TOKEN="${gitnexus_gitea_token}" \
        -e INDEXING_CONCURRENCY="3" \
        -e GITNEXUS_EMBEDDING_URL="http://${REMOTE_HOST}:8001/v1" \
        -e GITNEXUS_INDEX_EMBEDDING_URL="http://${REMOTE_HOST}:8002/v1" \
        -e GITNEXUS_EMBEDDING_MODEL="Alibaba-NLP/gte-Qwen2-1.5B-instruct" \
        -e GITNEXUS_EMBEDDING_DIMS="1536" \
        -e GITNEXUS_EMBEDDING_TIMEOUT_MS="3600000" \
        -e GITNEXUS_ALLOW_REMOTE_MODELS="true" \
        "${IMAGE_NAME}:latest"
    
    echo "--- 执行自动验证 ---"
    python3 auto_verify.py
EOF

echo ""
echo "=== 步骤 5: 部署完成，查看日志 ==="
ssh "${REMOTE_USER}@${REMOTE_HOST}" "docker logs --tail 20 ${IMAGE_NAME}"

# 本地清理
rm -f "${TAR_FILE}"
