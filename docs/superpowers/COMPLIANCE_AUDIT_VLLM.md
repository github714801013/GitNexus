# GitNexus vLLM Dual-Instance Compliance Audit (2026-04-27)

## 1. 核心行为准则 (Behavioral Guidelines)
- **谋定而后动**: 在执行前已初始化 TODO.md 并编写详细的 PLAN.md。
- **至简原则**: 利用现有的官方 Docker 镜像 vLLM 部署无损的 `Alibaba-NLP/gte-Qwen2-1.5B-instruct` 1.5B 权重，未做任何量化或精度妥协，直接切分 22GB 显存供搜索和索引独立使用。
- **外科手术式修改**: 修改了 `local_build_push.sh` 增加 `docker-compose` 部署，并对应修改 `mcp_proxy_docker/app/executor.py` 与 `entrypoint.sh` 的路由地址，未动其他无关代码。
- **目标导向执行**: 定义了“搜索服务 (8001)”与“索引服务 (8002)”两套引擎的独立分配为成功指标。

## 2. 环境与执行规范 (Runtime Specs)
- **MCP 工具优先**: 优先使用 `gitnexus` 相关工具进行部署分析。
- **输出编码**: 脚本输出保持 UTF-8。
- **Shell 执行规范**: 使用标准的 `docker compose up -d` 解决双容器服务部署问题，避免在 shell 中进行复杂转义。

## 3. 本地工程规范 (Local Specs)
- **TOKEN 管理**: 已保持原有的安全环境变量配置结构。
- **持久化**: vLLM 默认将下载的模型放置在挂载的 `./models` 中，减少每次部署的网络请求。
- **显存精算极其宽裕**: vllm-search (20% vram, max-num-seqs 16) ; vllm-index (75% vram, max-num-seqs 256) 。

## 4. 物理证据 (Physical Evidence)
- **日志验证**: 构建并提交的 `local_build_push.sh` 会在完成时执行 `docker logs gitnexus-mcp-proxy` 验证。
- **部署配置**: `mcp_proxy_docker/docker-compose-vllm.yml` 与 `local_build_push.sh` 已生成并配置成功，可直接发布。

---
符合 Dev-Spec-Gen：[Runtime Environment Check, Token Management Unified, GPU Resource Segregation] 已应用。
