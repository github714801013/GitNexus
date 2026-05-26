# Zoekt 排序优化 TODO

- [x] Phase 0: 初始化 dev-spec-gen 物理锚点，确认分支
- [x] Phase 1: 尝试 GitNexus MCP 影响分析，失败时记录降级原因
- [x] Phase 2: 编写计划，限定本次只做 Zoekt 行号映射和 source weight
- [x] Phase 3: RED - 补充 Zoekt 行号映射真实符号、跨源加权排序失败测试
- [x] Phase 4: GREEN - 实现最小排序优化
- [x] Phase 5: Verification - 运行目标测试、相关单测、TypeScript 类型检查
- [x] Phase 6: Compliance Audit - 核对本地规范、输出风险和未验证项

## 约束记录

- GitNexus MCP 未索引本仓库 `GitNexus`，`impact` 返回仓库不存在；本次影响分析降级为本地精确检索和单测。
- 本次为 TypeScript MCP 查询排序逻辑，不适用 Java `AiAutoTestController`。
- 多 Agent 红队工具未获用户显式授权时不派发，改为本地边界复核并在交付说明中标注。

## 跨项目检索异常隔离追加 TODO

- [x] Phase 1: 核实远程日志，确认跨库查询存在单仓库 `not a git repository` / 索引异常噪声
- [x] Phase 2: 定位跨 repo fan-out 的 `Promise.all` 失败传播点
- [x] Phase 3: RED - 补充 query、Zoekt 自动发现 query、route_map、cypher 单仓库异常测试
- [x] Phase 4: GREEN - 单仓库异常转为 repo 级 `errors`，成功仓库继续 merge
- [x] Phase 5: Verification - 运行目标单测、相关 Zoekt 单测、TypeScript 类型检查
- [x] Phase 6: Compliance Audit - 确认未改单 repo 查询语义，未执行 commit/push
- [x] Phase 7: Log Hygiene - 跨库单 repo 预期失败不再输出 `GitNexus [cross-repo:*]` stderr

## Webhook 索引健康检查追加 TODO

- [x] Phase 1: 定义可自动修复索引错误：未初始化、缺失、完整性失败、mmap、提示 re-analyze
- [x] Phase 2: 启动时遍历注册仓库，轻量初始化 LadybugDB 做健康探测
- [x] Phase 3: 发现可修复索引异常时复用 webhook analyze queue 异步重建
- [x] Phase 4: 非索引损坏类错误只记录 warning，不进入自动重建循环
- [x] Phase 5: Verification - 运行 analyze-api、calltool-dispatch、zoekt 相关单测和 TypeScript 类型检查
- [x] Phase 6: Project Discovery - 启动时遍历 `/projects` 下真实 Git 仓库，未注册 MCP 的项目补注册或排队 analyze
- [x] Phase 7: Embedding Discovery - 启动巡检发现 `nodes > 0 && embeddings <= 0` 时排队 `embeddings:true` 补向量
