#!/bin/bash
set -e

# --- 配置区 (根据实际远程环境调整) ---
REMOTE_HOST="10.1.14.177" 
REMOTE_USER="ji99"
REMOTE_PATH="/home/ji99/Project/mcp_gitnexus_server"
REGISTRY_URL="harbor.saas.ch999.cn:1088/common"
IMAGE_NAME="gitnexus-mcp-proxy"

# --- 智能路径探测 ---
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SCRIPT_DIR/Dockerfile" ]; then
    BASE_DIR="$SCRIPT_DIR"
    PROJECT_ROOT="$(cd "$BASE_DIR/.." && pwd)"
else
    PROJECT_ROOT="$(pwd)"
    BASE_DIR="$PROJECT_ROOT/mcp_proxy_docker"
fi
DOCKERFILE_PATH="$BASE_DIR/Dockerfile"

echo "--- 步骤 1: 获取版本号 ---"
cd "$PROJECT_ROOT"
version=$(git rev-parse --short HEAD 2>/dev/null || echo "v1.0.0")
remote_docker_image="${REGISTRY_URL}/${IMAGE_NAME}:${version}"

echo "--- 步骤 2: 构建并推送镜像 (宿主机网络模式) ---"
# 使用 --network=host 解决 Docker 网桥网络抖动和 DNS 慢的问题
# 同时构建版本号镜像和 latest 镜像
export DOCKER_BUILDKIT=0
docker build --network=host -t "$remote_docker_image" -f "$DOCKERFILE_PATH" "$PROJECT_ROOT"
docker tag "$remote_docker_image" "${REGISTRY_URL}/${IMAGE_NAME}:latest"

echo "正在推送版本号镜像: $remote_docker_image"
docker push "$remote_docker_image"
echo "正在推送 latest 镜像: ${REGISTRY_URL}/${IMAGE_NAME}:latest"
docker push "${REGISTRY_URL}/${IMAGE_NAME}:latest"


echo "--- 步骤 3: 远程服务器执行 (SSH) ---"
ssh "${REMOTE_USER}@${REMOTE_HOST}" -T << EOF
    mkdir -p "${REMOTE_PATH}"
    cd "${REMOTE_PATH}"
    echo "Updating container with latest image: ${remote_docker_image}"
    
    docker pull "${remote_docker_image}"
    docker stop "${IMAGE_NAME}" 2>/dev/null || true
    docker rm "${IMAGE_NAME}" 2>/dev/null || true

    # 完整的容器运行命令：映射所有端口并挂载项目目录
    docker run -d --name "${IMAGE_NAME}" \
        -p 1347:1347 -p 1348:1348 -p 1349:1349 -p 1350:1350 \
        -v /projects:/projects \
        --restart always \
        "${remote_docker_image}"

    echo "--- 步骤 4: 自动触发所有项目索引 ---"
    # 等待服务启动
    sleep 5
    
    # 获取 /projects 下的所有一级目录并触发 Webhook
    # 我们假设目录名即为项目名，这里通过简单的 find 命令获取
    find /projects -maxdepth 2 -mindepth 2 -type d | while read dir; do
        rel_path=${dir#/projects/}
        # 转换路径为 Gitea Webhook 格式
        # 假设 clone_url 可以通过某种方式推导，或者直接使用本地路径模式（如果 Webhook 支持）
        # 根据 main.py 逻辑，它支持 full_name 定位
        echo "Triggering re-index for project: $rel_path"
        curl -s -X POST "http://localhost:1347/webhook/gitea" \
            -H "Content-Type: application/json" \
            -d "{\"repository\": {\"full_name\": \"$rel_path\", \"clone_url\": \"https://code.9ji.com/$rel_path.git\"}, \"ref\": \"refs/heads/master\"}"
    done
EOF

echo "--- 步骤 5: 清理本地构建镜像 ---"
docker rmi "$remote_docker_image" || true

echo "Local build and remote deployment completed successfully: ${remote_docker_image}"
