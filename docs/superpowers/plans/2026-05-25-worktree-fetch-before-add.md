# Worktree Fetch Before Add Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 webhook 创建环境 worktree 时，本地远端跟踪引用缺失导致 `git worktree failed: fatal: invalid reference: origin/<branch>` 的问题。

**Architecture:** 保持 `ensureLocalWorktree` 为唯一改动入口，在创建 worktree 前对 `origin/*` 的 `baseRef` 做幂等 fetch。已有 worktree 的 reset 路径继续沿用现有 fetch + `FETCH_HEAD` 逻辑。

**Tech Stack:** TypeScript、Vitest、真实临时 git 仓库。

---

### Task 1: Runtime Environment Check

**Files:**
- Modify: `docs/superpowers/TODO.md`

- [ ] **Step 1: 确认分支和工具可用性**

Run: `git branch --show-current`
Expected: 当前临时修复分支可继续。

- [ ] **Step 2: 尝试 GitNexus MCP 影响分析**

Run: `remote_gitnexus.impact(repo="GitNexus", target="ensureLocalWorktree")`
Expected: 若仓库未索引，记录降级到本地检索。

### Task 2: Bug Reproduction

**Files:**
- Test: `gitnexus/test/unit/webhook-worktree.test.ts`

- [ ] **Step 1: 编写失败测试**

在 `webhook worktree helpers` 中新增测试：创建 bare remote 和 main clone，push `master_depart_iteng` 后删除本地 `origin/master_depart_iteng` 引用，预先创建本地 `dev-oanew` 分支，再调用 `ensureLocalWorktree({ branch: "dev-oanew", baseRef: "origin/master_depart_iteng", resetToRef: "origin/master_depart_iteng" })`，期望成功创建 worktree 并 reset 到远端提交。

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm test -- test/unit/webhook-worktree.test.ts -t "fetches the requested remote source before adding an existing local branch worktree"`
Expected: FAIL，错误包含 `invalid reference: origin/master_depart_iteng` 或等价 worktree add 失败。

### Task 3: Minimal Fix

**Files:**
- Modify: `gitnexus/src/server/webhook-worktree.ts`

- [ ] **Step 1: 提取本地小 helper**

新增 `fetchOriginRef(ref, cwd)`：仅当 `ref.startsWith("origin/")` 时执行 `git fetch origin <branch> --depth 1`。

- [ ] **Step 2: 在 worktree add 前调用 helper**

在 `worktreePath` 不存在分支中，读取 `hasBranch` 后、`git worktree add` 前，对 `params.baseRef` 调用 helper。这样本地已有分支和本地无分支两条路径都能先获取远端引用。

- [ ] **Step 3: 复用 helper 到 reset 路径**

将已有 `resetToRef` 的 origin fetch 替换为 helper，保持行为一致。

### Task 4: Verification Execution

**Files:**
- Test: `gitnexus/test/unit/webhook-worktree.test.ts`

- [ ] **Step 1: 运行目标测试**

Run: `npm test -- test/unit/webhook-worktree.test.ts`
Expected: PASS。

- [ ] **Step 2: 运行类型检查**

Run: `npx tsc --noEmit`
Expected: exit 0。

- [ ] **Step 3: 检查补丁格式**

Run: `git diff --check -- gitnexus/src/server/webhook-worktree.ts gitnexus/test/unit/webhook-worktree.test.ts docs/superpowers/TODO.md docs/superpowers/plans/2026-05-25-worktree-fetch-before-add.md`
Expected: exit 0。

### Task 5: Compliance Audit

**Files:**
- Modify: `docs/superpowers/TODO.md`

- [ ] **Step 1: 枚举关键场景**

覆盖：本地已有分支 + 远端引用缺失、本地无分支、已有 worktree reset、远端分支不存在、安全 ref 校验。

- [ ] **Step 2: 记录未验证项和降级点**

记录：GitNexus MCP 未索引、qmd references 不可用、未连接远程 `ji99@10.1.14.177` 做真实 webhook 请求。
