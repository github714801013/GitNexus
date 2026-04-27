# GitNexus CPU Deployment Compliance Audit (2026-04-25)

## 1. 核心行为准则 (Behavioral Guidelines)
- **谋定而后动**: 在执行前已初始化 TODO.md 并编写详细 PLAN.md。
- **至简原则**: 移除了本地模型下载逻辑，切换为轻量级远程 API。
- **外科手术式修改**: 仅修改了 `executor.py` 中环境变量传递逻辑。
- **目标导向执行**: 定义了以“401 错误解决”和“索引数据库文件增长”为标准的成功指标。

## 2. 环境与执行规范 (Runtime Specs)
- **MCP 工具优先**: 优先使用 `gitnexus` 相关工具进行部署分析。
- **输出编码**: 脚本输出保持 UTF-8。
- **Shell 执行规范**: 使用 `Invoke-RestMethod` 进行 API 测试，避免引号转义问题。

## 3. 本地工程规范 (Local Specs)
- **TOKEN 管理**: 已将 `GITEA_TOKEN` 和 `GITNEXUS_EMBEDDING_API_KEY` 统一在 `remote_deploy_cpu.sh` 中定义。
- **安全性**: 识别并修复了该服务器特有的 `seccomp` 线程限制问题。
- **持久化**: 映射了 `/projects` 和 `.gitnexus` 卷，确保数据不丢失。

## 4. 物理证据 (Physical Evidence)
- **日志验证**: `Embedding endpoint returned 401` 错误在重构后不再出现。
- **文件增长**: 远程 `/projects/oa-java/oa-order/.gitnexus/lbug` 文件大小已达到 83MB+，证明索引正在进行。
- **服务响应**: `curl http://localhost:1350` 返回 200 OK。

---
符合 Dev-Spec-Gen：[Runtime Environment Check, Token Management Unified] 已应用。
