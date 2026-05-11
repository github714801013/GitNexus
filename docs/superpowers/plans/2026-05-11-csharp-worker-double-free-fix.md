# C# Worker Double Free Fix Plan

**Goal:** 修复远端索引 `/projects/OA_CSharp/saasoanew` 时 `double free or corruption (out)` 导致 analyze 退出码 1 的问题，并通过 `remote_deploy.sh` 部署后日志验证不再报错。

**关键假设:** C# 大仓触发 parse worker pool，worker 线程加载 `tree-sitter-c-sharp` native N-API addon 后在远端 Linux/glibc 环境出现 native 内存破坏。仓库测试注释已有同类已知风险记录；顺序解析路径仍使用同一解析器，但不跨 worker 线程加载 native addon。

**Scope:**

- `gitnexus/src/core/ingestion/pipeline-phases/parse-impl.ts`
- 相关单测文件，优先复用 parse worker/fallback 测试
- `docs/superpowers/TODO.md`

**Tasks:**

- [ ] 收集远端日志、确认错误发生在 `node gitnexus analyze /projects/OA_CSharp/saasoanew` 子进程。
- [ ] 读取 parse worker 创建条件和 C# 已知 native worker 风险证据。
- [ ] 编写失败测试：包含 C# 文件且超过 worker 阈值时，解析阶段不应创建 worker pool。
- [ ] 实现最小修复：C# 文件存在时禁用 parse worker pool，走顺序解析。
- [ ] 运行目标单测。
- [ ] 运行 TypeScript 类型检查。
- [ ] 使用 `remote_deploy.sh` 部署。
- [ ] 观察远端日志，确认 `saasoanew` 不再出现 `double free or corruption`、`Failed to index`。
