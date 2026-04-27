# Plan: Deploy Dual-Instance vLLM for Alibaba-NLP/gte-Qwen2-1.5B-instruct

## 目标 (Goal)
利用 22GB 显卡，以双活实例 (Dual-Active) 部署原版 FP16 精度 `Alibaba-NLP/gte-Qwen2-1.5B-instruct`，从而避免任何量化损失，并将搜索（20% 显存，吞吐较低响应快）和索引（75% 显存，大并发吞吐巨兽）的服务物理隔离。

## 阶段划分 (Phases)

### Phase 1: Research & Setup
- 确认远程部署环境 (`mcp_proxy_docker` 目录结构)。
- 确认现有代码通过何种环境变量对接外部 Embeddings 接口。

### Phase 2: Design
- 编写 `docker-compose-vllm.yml`（按要求配置 vllm-search 和 vllm-index）。
- 在 `remote_deploy_cpu.sh` (或一个新的部署脚本 `remote_deploy_vllm.sh`) 中适配 vLLM 的端口和部署。
- 修改 `mcp_proxy_docker/app/executor.py` 中的 `GITNEXUS_EMBEDDING_URL`，使得分析器（Analyze）能够将流量发往 `http://localhost:1349/v1` (vllm-index)。
- 在 `mcp_proxy_docker/entrypoint.sh` 中修改 serving (1349) 的 `GITNEXUS_EMBEDDING_URL` 环境变量，使其指向 `http://localhost:1348/v1` (vllm-search)。

### Phase 3: Implementation
- 物理写入 `mcp_proxy_docker/docker-compose-vllm.yml`。
- 修改相关的环境变量配置以接入这两套 vLLM 服务。
- 将 vLLM 相关配置更新至部署链路。

### Phase 4: Verification
- 确保部署配置逻辑无误，并通过本地构建脚本将其推送到远程运行环境。
- 确认容器端口绑定与 vLLM 实例能够被主程序正常访问。

### Phase 5: Audit & Finish
- 完成本地工程规范审计，展示证据。
