$RemoteHost = "10.1.14.177"
$RemoteUser = "ji99"
$RemotePath = "/home/ji99/Project/mcp_gitnexus_server"
$ImageID = "843bb3fc8401"
$FullImageName = "harbor.saas.ch999.cn:1088/common/gitnexus-mcp-proxy:latest"
$GiteaToken = $env:gitnexus_gitea_token
if (-not $GiteaToken) { throw "gitnexus_gitea_token environment variable is required" }

Write-Host "=== 步骤 3: 导出镜像为压缩包 ==="
$TarPath = "gitnexus_image_noble.tar.gz"
$TempTar = "gitnexus_image_noble.tar"
if (Test-Path $TarPath) { Remove-Item $TarPath -Force }
if (Test-Path $TempTar) { Remove-Item $TempTar -Force }

# 1. 导出为 tar
Write-Host "正在导出 tar 文件 (ID: $ImageID)..."
docker save -o "$TempTar" "$ImageID"
if ($LASTEXITCODE -ne 0) { throw "Docker save failed" }

# 2. 压缩
Write-Host "正在压缩 tar 文件..."
gzip -f "$TempTar"
if ($LASTEXITCODE -ne 0) { throw "Gzip failed" }

Write-Host "=== 步骤 4: 上传镜像 ==="
scp "$TarPath" "${RemoteUser}@${RemoteHost}:${RemotePath}/"

Write-Host "=== 步骤 5: 远程加载镜像并启动 ==="
$SshCommand = @"
    set -e
    cd "${RemotePath}"
    echo "正在加载镜像..."
    gunzip -c "${TarPath}" | docker load

    docker tag "${ImageID}" "${FullImageName}"
    docker tag "${FullImageName}" "gitnexus-mcp-proxy:latest"

    echo "停止并移除旧容器..."
    docker stop gitnexus-mcp-proxy 2>/dev/null || true
    docker rm gitnexus-mcp-proxy 2>/dev/null || true

    echo "启动 vLLM 双实例搜索与索引引擎..."
    docker compose -f docker-compose-vllm.yml up -d

    echo "启动新容器..."
    docker run -d --name gitnexus-mcp-proxy `
        -p 1347:1347 -p 1348:1348 -p 1349:1349 -p 1350:1350 `
        -v /home/ji99/gitnexus:/projects `
        -v "${RemotePath}/models:/app/models" `
        -v "/home/ji99/.gitnexus:/root/.gitnexus" `
        --restart always `
        -e GITEA_TOKEN="$GiteaToken" `
        -e INDEXING_CONCURRENCY="3" `
        -e GITNEXUS_EMBEDDING_URL="http://${RemoteHost}:8001/v1" `
        -e GITNEXUS_INDEX_EMBEDDING_URL="http://${RemoteHost}:8002/v1" `
        -e GITNEXUS_EMBEDDING_MODEL="Alibaba-NLP/gte-Qwen2-1.5B-instruct" `
        -e GITNEXUS_EMBEDDING_DIMS="1536" `
        -e GITNEXUS_ALLOW_REMOTE_MODELS="true" `
        gitnexus-mcp-proxy:latest

    echo "--- 启动验证程序 ---"
    python3 auto_verify.py
"@

ssh "${RemoteUser}@${RemoteHost}" $SshCommand
