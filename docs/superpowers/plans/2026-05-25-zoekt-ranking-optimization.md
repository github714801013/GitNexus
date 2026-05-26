# Zoekt Ranking Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提升 `query` 中 Zoekt 结果参与排序的质量，让 Zoekt 行命中尽量映射到真实符号，并让不同检索源通过可读常量加权参与 RRF。

**Architecture:** 保持现有 `query()` 单入口和三路并行检索不变。仅在 merge 阶段新增源权重，并在 Zoekt 文件命中进入 RRF 前，基于 `lineMatches.lineNumber` 查询同文件覆盖行号的最窄符号节点；找不到符号时仍保留 File 级结果作为兜底。

**Tech Stack:** TypeScript, Vitest, GitNexus MCP LocalBackend.

---

### Task 1: RED Tests

**Files:**
- Modify: `D:/workplace/typescript/GitNexus/gitnexus/test/unit/zoekt-query-integration.test.ts`

- [ ] **Step 1: Zoekt 行命中映射真实符号测试**

Mock Zoekt 返回 `src/foo.ts` 第 12 行命中，Mock graph 返回覆盖第 12 行的 `Function:src/foo.ts:handleRequest`。断言返回的 `process_symbols[0].id` 是真实函数 ID，而不是 `File:src/foo.ts`。

- [ ] **Step 2: 跨源加权排序测试**

Mock BM25 和 Zoekt 返回同一个符号，vector 返回另一个符号；两个符号分别归属不同 Process。断言 BM25+Zoekt 命中的 Process 排在 vector-only Process 前面。

- [ ] **Step 3: 运行 RED**

Run: `npm test -- test/unit/zoekt-query-integration.test.ts -t "Zoekt"`

Expected: 新测试失败，暴露当前 Zoekt 只映射 File、RRF 无 source weight。

### Task 2: GREEN Implementation

**Files:**
- Modify: `D:/workplace/typescript/GitNexus/gitnexus/src/mcp/local/local-backend.ts`

- [ ] **Step 1: 增加权重常量**

Add constants near tool/search constants:

```ts
const RRF_K = 60;
const SEARCH_SOURCE_WEIGHTS = {
  bm25: 1,
  vector: 0.8,
  zoekt: 1.2,
} as const;
```

- [ ] **Step 2: 替换 RRF 计算**

Use `sourceWeight / (RRF_K + rank + 1)` for BM25, vector, and Zoekt.

- [ ] **Step 3: Zoekt 行号映射符号**

Add a helper that queries graph nodes in the matched file with:

```cypher
MATCH (n)
WHERE n.filePath = $filePath
  AND n.startLine <= $lineNumber
  AND n.endLine >= $lineNumber
  AND labels(n)[0] IN [...]
RETURN n.id, n.name, labels(n)[0], n.filePath, n.startLine, n.endLine
ORDER BY (n.endLine - n.startLine) ASC
LIMIT 1
```

- [ ] **Step 4: 保留 File 兜底**

If no line match or no graph symbol is found, keep current `File:${fileName}` result.

### Task 3: Verification

**Files:**
- Test: `D:/workplace/typescript/GitNexus/gitnexus/test/unit/zoekt-query-integration.test.ts`

- [ ] **Step 1: 目标测试**

Run: `npm test -- test/unit/zoekt-query-integration.test.ts -t "Zoekt"`

Expected: pass.

- [ ] **Step 2: 相关测试**

Run: `npm test -- test/unit/zoekt-query-integration.test.ts test/unit/calltool-dispatch.test.ts`

Expected: pass.

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`

Expected: exit code 0.
