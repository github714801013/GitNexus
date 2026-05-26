# MCP Multi Env Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 支持 MCP env scope 同时指定基础环境 `pro` 与其他环境前缀，例如 `"env": "pro,dev"` 返回基础仓库和 `dev-*` 仓库。

**Architecture:** 保持 HTTP header 解析不变，修正 `createMCPServer` 的环境匹配逻辑，让多个 env 按并集匹配。用 Vitest 覆盖 `pro + dev` 的 list_repos 过滤和 SSE header 传参。

**Tech Stack:** TypeScript, Vitest, MCP server, Express SSE endpoint.

---

### Task 1: RED - 覆盖多环境过滤

**Files:**
- Modify: `gitnexus/test/unit/mcp-header-scoping.test.ts`

- [ ] **Step 1: Write the failing test**

在 `MCP Server with project whitelisting` suite 中新增测试：`should return base repositories and requested env-prefixed indexes when pro is combined with another env`。

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/unit/mcp-header-scoping.test.ts`
Expected: FAIL，当前只返回基础仓库 `api`，不会返回 `dev-api`。

### Task 2: GREEN - 修正环境并集匹配

**Files:**
- Modify: `gitnexus/src/mcp/server.ts`

- [ ] **Step 1: Implement minimal logic change**

将 `matchesEnv` 从 `pro` 优先的二选一逻辑改成：基础环境命中或任一指定环境前缀命中即可；无 env scope 时仍全部允许。

- [ ] **Step 2: Run focused test**

Run: `npm test -- test/unit/mcp-header-scoping.test.ts`
Expected: PASS。

### Task 3: Header 解析回归

**Files:**
- Modify: `gitnexus/test/unit/mcp-http.test.ts`

- [ ] **Step 1: Add/adjust assertion for comma-separated env header**

确认 `env: 'pro,dev'` 传入 `createMCPServer` 为 `{ envs: ['pro', 'dev'] }`。

- [ ] **Step 2: Run HTTP endpoint test**

Run: `npm test -- test/unit/mcp-http.test.ts`
Expected: PASS。

### Task 4: Verification

**Files:**
- No production changes beyond Task 2.

- [ ] **Step 1: Run combined unit tests**

Run: `npm test -- test/unit/mcp-header-scoping.test.ts test/unit/mcp-http.test.ts`
Expected: PASS。

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: exit code 0。

- [ ] **Step 3: Diff check**

Run: `git diff --check -- gitnexus/src/mcp/server.ts gitnexus/test/unit/mcp-header-scoping.test.ts gitnexus/test/unit/mcp-http.test.ts docs/superpowers/TODO.md docs/superpowers/plans/2026-05-25-mcp-multi-env-scope.md`
Expected: no whitespace errors。
