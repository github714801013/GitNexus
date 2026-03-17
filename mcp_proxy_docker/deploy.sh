#!/bin/bash
set -e

# --- 配置区 (根据实际环境调整) ---
REMOTE_HOST="10.1.250.157" # 示例 IP，需根据实际情况修改
REMOTE_USER="devops"
REMOTE_PATH="/home/devops/gitnexus/mcp_proxy_docker"
REGISTRY_URL="harbor.saas.ch999.cn:1088/common"
IMAGE_NAME="gitnexus-mcp-proxy"

# 进入项目根目录 (假设脚本在 mcp_proxy_docker/ 目录下)
cd "$(dirname "$0")/.."

echo "--- 步骤 1: 核心恢复逻辑 ---"
if [ -d ".git" ]; then
    git checkout -- mcp_proxy_docker/Dockerfile
    echo "Dockerfile has been restored to original state via Git."
else
    echo "Warning: .git directory not found, skipping restore."
fi

echo "--- 步骤 2: 获取版本号 ---"
version=$(git rev-parse --short HEAD 2>/dev/null || echo "build-${BUILD_NUMBER:-unknown}")
remote_docker_image="${REGISTRY_URL}/${IMAGE_NAME}:${version}"

echo "--- 步骤 3: 热修复逻辑 (替换基础镜像) ---"
# 将默认的 node:20-bullseye 替换为私有库镜像
sed -i 's|^FROM node:.*|FROM harbor.saas.ch999.cn:1088/common/node:20-bullseye|g' mcp_proxy_docker/Dockerfile

echo "--- 步骤 4: 打包推送 ---"
docker build -t "$remote_docker_image" -f mcp_proxy_docker/Dockerfile .
docker push "$remote_docker_image"

echo "--- 步骤 5: 远程部署 ---"
# 假设远程服务器已存在 restart.sh 脚本，接收镜像地址作为参数
# 如果没有，建议在远程创建基于 docker-compose 的重启逻辑
ssh "${REMOTE_USER}@${REMOTE_HOST}" -T << EOF
    if [ -d "${REMOTE_PATH}" ]; then
        cd "${REMOTE_PATH}"
        # 更新镜像版本并重启
        # 方案 A: 如果使用 docker-compose，动态设置环境变量
        export REMOTE_IMAGE="${remote_docker_image}"
        # 假设远程有 restart.sh 或直接执行 compose
        if [ -f "restart.sh" ]; then
            ./restart.sh "\$REMOTE_IMAGE"
        else
            docker compose pull
            docker compose up -d
        fi
    else
        echo "Error: Remote path ${REMOTE_PATH} not found."
        exit 1
    fi
EOF

echo "--- 步骤 6: 清理 ---"
docker images -f "reference=*${IMAGE_NAME}*" -f "dangling=true" -q | xargs -r docker rmi || true

echo "Deployment of ${remote_docker_image} completed successfully."
