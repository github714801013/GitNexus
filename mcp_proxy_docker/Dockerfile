# 使用 Ubuntu 24.04 以获取更高版本的 GLIBCXX
FROM ubuntu:24.04

# 配置代理 (加速构建)
ENV http_proxy=http://10.1.14.185:10808
ENV https_proxy=http://10.1.14.185:10808
ENV all_proxy=socks5://10.1.14.185:10808
ENV no_proxy=localhost,127.0.0.1,10.1.14.177,10.1.14.185

# 避免交互式提示
ENV DEBIAN_FRONTEND=noninteractive

# 替换为阿里云国内镜像源以提高下载速度并解决 503 错误
RUN sed -i 's/archive.ubuntu.com/mirrors.aliyun.com/g' /etc/apt/sources.list.d/ubuntu.sources || true

# 1. 系统底层工具 & Node.js 22
RUN apt-get update -y && apt-get install -y --fix-missing \
    curl \
    ca-certificates \
    python3 \
    python3-pip \
    git \
    build-essential \
    libgomp1 \
    util-linux \
    && git config --global user.email "gitnexus@example.com" \
    && git config --global user.name "GitNexus Builder" \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --fix-missing nodejs \
    && ln -s /usr/bin/python3 /usr/bin/python \
    && rm -rf /var/lib/apt/lists/*

# 2. 核心参数配置
ENV PATH="/app/gitnexus/node_modules/.bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin"
ENV HF_HOME="/root/.cache/huggingface"

WORKDIR /app

# 安装 mcp-proxy 和 serve (用于托管前端)
RUN npm install -g mcp-proxy serve --registry=http://registry.npmmirror.com

# 3. 复制项目文件
COPY gitnexus ./gitnexus
COPY gitnexus-shared ./gitnexus-shared
COPY gitnexus-web ./gitnexus-web

# 4. 构建 gitnexus-shared
WORKDIR /app/gitnexus-shared
RUN npm install --registry=http://registry.npmmirror.com --no-audit --no-fund --ignore-scripts && \
    ./node_modules/.bin/tsc

# 5. 构建 GitNexus (Backend) 并预下载模型
WORKDIR /app/gitnexus
RUN npm install --registry=http://registry.npmmirror.com --no-audit --no-fund --ignore-scripts && \
    npm rebuild @ladybugdb/core && \
    npx tsc && \
    mkdir -p dist/_shared && \
    cp -r /app/gitnexus-shared/src/* dist/_shared/ && \
    cp package.json dist/gitnexus/ && \
    mkdir -p dist/gitnexus/vendor && \
    cp -r vendor/* dist/gitnexus/vendor/ && \
    chmod +x dist/gitnexus/src/cli/index.js && \
    pip3 install --no-cache-dir -i http://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com --break-system-packages huggingface_hub "httpx[socks]" && \
    HF_ENDPOINT=https://hf-mirror.com hf download Xenova/bge-small-zh-v1.5 || true

# 6. 构建 GitNexus Web (Frontend)
WORKDIR /app/gitnexus-web
ARG VITE_BACKEND_URL
ENV VITE_BACKEND_URL=${VITE_BACKEND_URL}
RUN npm install --registry=http://registry.npmmirror.com --no-audit --no-fund --ignore-scripts --legacy-peer-deps && \
    npx vite build

# 7. Setup the Proxy Application (Python Side)
WORKDIR /app/mcp_proxy
COPY ./mcp_proxy_docker/requirements.txt .
RUN pip3 install --no-cache-dir -i http://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com --break-system-packages -r requirements.txt

# Copy application code
COPY ./mcp_proxy_docker/app ./app

# Expose ports
EXPOSE 1347 1348 1349 1350

# Entrypoint script
COPY ./mcp_proxy_docker/entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
