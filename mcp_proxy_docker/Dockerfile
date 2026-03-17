# Use Node.js as base to support gitnexus CLI
FROM node:20-bullseye

# Install Python and dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    git \
    && rm -rf /var/lib/apt/lists/*

# Set workdir
WORKDIR /app

# 1. Install GitNexus and mcp-proxy globally via npm
RUN npm install -g gitnexus mcp-proxy

# 2. Setup the Proxy Application
WORKDIR /app/mcp_proxy
COPY ./mcp_proxy_docker/requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# Copy application code
COPY ./mcp_proxy_docker/app ./app

# Expose FastAPI port (1347) and mcp-proxy port (1348)
EXPOSE 1347 1348

# Entrypoint script
COPY ./mcp_proxy_docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
