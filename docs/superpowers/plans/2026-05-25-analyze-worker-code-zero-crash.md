# Analyze Worker Code Zero Crash Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 analyze worker 已上报终态后正常 `exit(0)` 被父进程误判为 crashed 的问题。

**Architecture:** 在父进程中记录 worker 是否已经上报 `complete` 或 `error` 终态；`exit` 事件只处理未上报终态的退出。普通 analyze 和 webhook/worktree analyze 共用同一判定辅助函数，避免两段逻辑漂移。

**Tech Stack:** TypeScript, Node `child_process.fork`, Vitest.

---

### Task 1: RED 复现终态后 exit(0) 不应视为 crash

**Files:**
- Modify: `gitnexus/test/unit/analyze-api.test.ts`
- Modify: `gitnexus/src/server/api.ts`

- [ ] **Step 1: Write the failing test**

在 `gitnexus/test/unit/analyze-api.test.ts` 中导入并断言 `shouldTreatAnalyzeWorkerExitAsCrash`：

```ts
import { shouldTreatAnalyzeWorkerExitAsCrash } from '../../src/server/api.js';
```

新增用例：

```ts
it('does not treat exit after worker terminal message as a crash', () => {
  expect(shouldTreatAnalyzeWorkerExitAsCrash('analyzing', true)).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gitnexus; npm test -- test/unit/analyze-api.test.ts`
Expected: FAIL because `shouldTreatAnalyzeWorkerExitAsCrash` is not exported.

### Task 2: GREEN 最小修复父进程退出判定

**Files:**
- Modify: `gitnexus/src/server/api.ts`

- [ ] **Step 1: Add the minimal helper**

在 `api.ts` 顶部辅助函数区域添加：

```ts
export const shouldTreatAnalyzeWorkerExitAsCrash = (
  jobStatus: string | undefined,
  workerReportedTerminal: boolean,
): boolean =>
  !workerReportedTerminal && jobStatus !== 'complete' && jobStatus !== 'failed';
```

- [ ] **Step 2: Use the helper in both exit handlers**

在普通 analyze 和 webhook/worktree analyze 的 worker 作用域中各增加：

```ts
let workerReportedTerminal = false;
```

收到 `complete` 或 `error` 消息时设置：

```ts
workerReportedTerminal = true;
```

在 `exit` 事件中用 helper 判断：

```ts
if (!shouldTreatAnalyzeWorkerExitAsCrash(currentJob?.status, workerReportedTerminal)) return;
```

- [ ] **Step 3: Run focused test**

Run: `cd gitnexus; npm test -- test/unit/analyze-api.test.ts`
Expected: PASS.

### Task 3: Verification and Audit

**Files:**
- Read/verify only.

- [ ] **Step 1: Run typecheck**

Run: `cd gitnexus; npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 2: Run related unit tests**

Run: `cd gitnexus; npm test -- test/unit/analyze-api.test.ts test/unit/analyze-job.test.ts`
Expected: PASS.

- [ ] **Step 3: Inspect changes**

Run: `git diff -- gitnexus/src/server/api.ts gitnexus/test/unit/analyze-api.test.ts docs/superpowers/TODO.md docs/superpowers/plans/2026-05-25-analyze-worker-code-zero-crash.md`
Expected: Only planned files changed.
