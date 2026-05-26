# Cross Project Search Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 MCP 只读检索工具在多项目且未显式传 `repo` 时，服务端自动循环可见项目并返回聚合结果。

**Architecture:** `query` 保留现有 Zoekt 跨项目发现能力；其它只读检索工具在 `LocalBackend.callTool` 分发层进入通用循环兜底。每个项目仍调用现有单项目实现，聚合层只负责标注 `repo`、合并数组和统计数量，避免改动各工具查询逻辑。

**Tech Stack:** TypeScript, Vitest, GitNexus MCP LocalBackend.

---

### Task 1: Runtime Environment Check

**Files:**
- Read: `D:/workplace/typescript/GitNexus/AGENTS.md`
- Read: `D:/workplace/typescript/GitNexus/gitnexus/src/mcp/local/local-backend.ts`
- Read: `D:/workplace/typescript/GitNexus/gitnexus/test/unit/calltool-dispatch.test.ts`

- [x] **Step 1: 初始化 TODO**

Run: `uv run D:\workplace\skills\my-skills\dev-spec-gen\scripts\manage_todo.py --action init --project-path .`

Expected: `docs/superpowers/TODO.md` exists.

- [x] **Step 2: 确认分支**

Run: `git branch --show-current`

Expected: 当前临时修复分支可用。

- [x] **Step 3: 尝试 qmd 初始化**

Run: `uv run D:\workplace\skills\my-skills\dev-spec-gen\scripts\manage_qmd.py --action init`

Expected: 若仓库没有 `references`，记录降级原因。

### Task 2: Bug Reproduction

**Files:**
- Modify: `D:/workplace/typescript/GitNexus/gitnexus/test/unit/calltool-dispatch.test.ts`

- [ ] **Step 1: 写 route_map 跨项目失败测试**

Add a test where two repos are registered and `backend.callTool('route_map', { route: '/api' })` is called without `repo`.

Expected behavior after fix:

```ts
expect(result.total).toBe(2);
expect(result.routes.map((route: any) => route.repo)).toEqual(['test-project', 'other-project']);
```

- [ ] **Step 2: 写 cypher 跨项目失败测试**

Add a test where two repos are registered and `backend.callTool('cypher', { query: 'MATCH (n) RETURN n.name AS name' })` is called without `repo`.

Expected behavior after fix:

```ts
expect(result.row_count).toBe(2);
expect(result.markdown).toContain('test-project');
expect(result.markdown).toContain('other-project');
```

- [ ] **Step 3: 运行 RED**

Run: `npm test -- test/unit/calltool-dispatch.test.ts -t "loops across repos"`

Expected before implementation: failure with `Multiple repositories indexed`.

### Task 3: Minimal Implementation

**Files:**
- Modify: `D:/workplace/typescript/GitNexus/gitnexus/src/mcp/local/local-backend.ts`

- [ ] **Step 1: 定义跨项目循环工具白名单**

Add a readonly set for search-like tools:

```ts
const CROSS_REPO_LOOP_TOOLS = new Set([
  'cypher',
  'context',
  'explore',
  'route_map',
  'shape_check',
  'tool_map',
  'api_impact',
]);
```

- [ ] **Step 2: 添加可见项目选择**

Use existing `head` scope filtering through `matchesHeadScope`; without head, loop all registered repos.

- [ ] **Step 3: 添加单项目调用封装**

Route each repo to the existing implementation method. For `cypher`, format each raw result or aggregate raw rows before final markdown formatting.

- [ ] **Step 4: 添加聚合函数**

For object results:
- array fields are concatenated
- `total`, `row_count`, `routesWithShapes`, `mismatches` are summed
- single route/api results are wrapped into `routes`
- every row/item receives `repo`
- per-repo errors are returned in `errors`

### Task 4: Verification

**Files:**
- Test: `D:/workplace/typescript/GitNexus/gitnexus/test/unit/calltool-dispatch.test.ts`

- [ ] **Step 1: 运行目标测试**

Run: `npm test -- test/unit/calltool-dispatch.test.ts -t "loops across repos"`

Expected: new cross-project tests pass.

- [ ] **Step 2: 运行相关单测**

Run: `npm test -- test/unit/calltool-dispatch.test.ts`

Expected: all tests in file pass.

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`

Expected: exit code 0.

### Task 5: Compliance Audit

**Files:**
- Read: `D:/workplace/typescript/GitNexus/docs/superpowers/TODO.md`
- Read: `D:/workplace/typescript/GitNexus/docs/superpowers/plans/2026-05-25-cross-project-search-fallback.md`

- [ ] **Step 1: 核对边界**

Confirm no write-like tools (`rename`, `detect_changes`) were made implicit multi-repo.

- [ ] **Step 2: 核对变更范围**

Run: `git diff --check -- gitnexus/src/mcp/local/local-backend.ts gitnexus/test/unit/calltool-dispatch.test.ts docs/superpowers/TODO.md docs/superpowers/plans/2026-05-25-cross-project-search-fallback.md`

Expected: no whitespace errors.
