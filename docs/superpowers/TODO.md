# Dev-Spec-Gen 本地工程规范达成看板

## Phase 1: Research & Setup (初始化)
- [x] 运行环境与版本确认：`codex/webhook-worktree-env-index`，Node v24.14.0，npm 11.9.0
- [x] Scope 边界确认：仅修改 `gitnexus/src/server`、`gitnexus/src/mcp`、对应 unit tests、docs/superpowers
- [x] 核心规范检索：已加载 `dev-spec-gen`、`superpowers:using-git-worktrees`、`superpowers:writing-plans`、仓库 `AGENTS.md/GUARDRAILS.md`
- [x] GitNexus MCP 影响分析尝试：`repo="GitNexus"` 不在远端 registry，降级为本地精确测试和最终风险回显
- [x] 涉及技能识别：dev-spec-gen、writing-plans、test-driven-development、verification-before-completion

## Phase 2: Design (文档先行)
- [x] API-First：`POST /api/webhook/:env/index`，`env` HTTP Header，见 `docs/superpowers/specs/2026-05-21-webhook-worktree-env-index-design.md`
- [x] DB-First：不涉及数据库 schema；索引复制仅处理 `.gitnexus` 文件与 registry
- [x] 性能优化要点：主索引存在时复制 `.gitnexus` 快速可用，后台 analyze 刷新；不涉及 SQL/IN/循环查库
- [x] 编码规范要点：TypeScript 最小修改；Java/SQL/DTO/Mapper/热部署不适用
- [x] 测试计划：先写 Vitest RED，再实现 MCP header、worktree webhook、typecheck、红队复核
- [x] 实施计划已写入：`docs/superpowers/plans/2026-05-21-webhook-worktree-env-index.md`

## Phase 3: Implementation (开发)
- [x] RED：新增 MCP env header 过滤失败测试
- [x] GREEN：实现 MCP env scope 过滤
- [x] RED：新增 webhook worktree 失败测试
- [x] GREEN：实现 webhook worktree bootstrap 与后台 analyze registryName
- [x] GREEN：实现 LocalBackend `head` 精确/前缀过滤
- [x] 规范合规注释注入：仅保留既有注释风格，未新增冗余注释

## Phase 4: Verification (验证)
- [x] Focused Vitest：`mcp-filtering`、`mcp-header-scoping`、`mcp-http`、`webhook-worktree` 共 20 个用例通过
- [x] TypeScript 编译：`npx tsc --noEmit` 通过
- [x] 接口一致性比对：webhook helper 覆盖 202 所需 registry/worktree/meta，路由覆盖 400/403/409/500 分支结构
- [x] GitNexus detect_changes：`repo="GitNexus"` 不在远端 registry，无法执行图谱变更检测

## Phase 5: Audit & Finish (审计与完结)
- [ ] 红队复核：受当前系统约束，不能在未被用户显式要求时派发子 Agent；改为本地审查并在交付列风险
- [ ] 本地工程合规审计表输出
- [ ] 完结审计拦截
