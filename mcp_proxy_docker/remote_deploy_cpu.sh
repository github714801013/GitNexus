#!/bin/bash
# 远程部署脚本 - 绕过本地 Docker 缺失问题

#!/bin/bash
# CPU 服务器远程部署脚本 - 采用 SSH 隧道拉取镜像模式
# 解决 1. 远程服务器网络隔离 2. 导出/同步 Tar 包慢 的问题

set -e

# --- 1. 配置区域 ---
REMOTE_HOST="10.1.250.157"
REMOTE_USER="devops"
REMOTE_PATH="/data1/mcp_gitnexus_project/docker"
PROJECTS_PATH="/data1/mcp_gitnexus_project/project"
DATA_PATH="/data1/mcp_gitnexus_project/.gitnexus"

REGISTRY_HOST="harbor.saas.ch999.cn"
REGISTRY_PORT="1088"
# 根据用户提供的链接：http://harbor.saas.ch999.cn:1088/harbor/projects/2/repositories/gitnexus-mcp-proxy
# 推测项目名为 common 或使用项目 ID，这里统一推向 common 仓库
REGISTRY_URL="${REGISTRY_HOST}:${REGISTRY_PORT}/common"
IMAGE_NAME="gitnexus-mcp-proxy-cpu"

# --- 2. 统一 Token 管理 ---
GITEA_TOKEN="401a8a2a8339719a3a313eece19bc1d312f3531b"
EMBEDDING_API_KEY="sk-oS0AUaRLvSTUDy1MoMPjxA"
EMBEDDING_URL="https://dashscope.ch999.cn/base/v1"
EMBEDDING_MODEL="text-embedding-v4"
EMBEDDING_DIMS=1024

echo "=== 步骤 1: 获取版本号 ==="
version=$(git rev-parse --short HEAD 2>/dev/null || echo "v1.0.0")
full_image_name="${REGISTRY_URL}/${IMAGE_NAME}:${version}"
# 注意：远端拉取时使用 localhost 绕过 HTTPS 检查
local_pull_name="localhost:${REGISTRY_PORT}/common/${IMAGE_NAME}:${version}"

echo "=== 步骤 2: 本地构建 Docker 镜像 ==="
export DOCKER_BUILDKIT=1
docker build --network=host --progress=plain \
    -t "${full_image_name}" \
    -f mcp_proxy_docker/Dockerfile.cpu .

echo "=== 步骤 3: 推送镜像到私有仓库 ==="
docker push "${full_image_name}"

echo "=== 步骤 4: 同步配置文件到远端 ==="
ssh -i "$HOME/.ssh/id_rsa_gitnexus" "${REMOTE_USER}@${REMOTE_HOST}" "mkdir -p ${REMOTE_PATH} ${PROJECTS_PATH} ${DATA_PATH}"
scp -i "$HOME/.ssh/id_rsa_gitnexus" mcp_proxy_docker/auto_verify.py repos.json "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_PATH}/"
scp -i "$HOME/.ssh/id_rsa_gitnexus" repos.json "${REMOTE_USER}@${REMOTE_HOST}:${PROJECTS_PATH}/"

echo "=== 步骤 5: 通过 SSH 隧道远端拉取并启动 ==="
# 使用 -R 将远端的 1088 端口转发到本地可以访问的 harbor 地址
ssh -i "$HOME/.ssh/id_rsa_gitnexus" -o StrictHostKeyChecking=no \
    -R "${REGISTRY_PORT}:${REGISTRY_HOST}:${REGISTRY_PORT}" \
    "${REMOTE_USER}@${REMOTE_HOST}" -T << EOF
    set -e
    cd "${REMOTE_PATH}"

    echo "正在通过隧道拉取镜像: ${local_pull_name}"
    docker pull "${local_pull_name}"

    # 重新打标为原始名称，方便管理
    docker tag "${local_pull_name}" "${full_image_name}"
    docker tag "${full_image_name}" "${REGISTRY_URL}/${IMAGE_NAME}:latest"

    echo "停止并移除旧容器..."
    docker stop "${IMAGE_NAME}" 2>/dev/null || true
    docker rm "${IMAGE_NAME}" 2>/dev/null || true

    echo "启动新容器 (CPU 模式 & 远程 Embedding)..."
    docker run -d --name "${IMAGE_NAME}" \
        --security-opt seccomp=unconfined \
        -p 1347:1347 -p 1348:1348 -p 1349:1349 -p 1350:1350 \
        -v "${PROJECTS_PATH}:/projects" \
        -v "${DATA_PATH}:/root/.gitnexus" \
        --restart always \
        -e GITEA_TOKEN="${GITEA_TOKEN}" \
        -e GITNEXUS_EMBEDDING_API_KEY="${EMBEDDING_API_KEY}" \
        -e GITNEXUS_EMBEDDING_URL="${EMBEDDING_URL}" \
        -e GITNEXUS_EMBEDDING_MODEL="${EMBEDDING_MODEL}" \
        -e GITNEXUS_EMBEDDING_DIMS="${EMBEDDING_DIMS}" \
        -e GITNEXUS_EMBEDDING_DEVICE=cpu \
        -e GITNEXUS_ALLOW_REMOTE_MODELS=true \
        -e GITNEXUS_EMBEDDING_BATCH_SIZE=10 \
        "${full_image_name}"
    
    echo "等待服务启动..."
    sleep 5
    docker logs --tail 50 "${IMAGE_NAME}"
EOF

echo ""
echo "部署完成！使用了 SSH 隧道拉取模式。"
