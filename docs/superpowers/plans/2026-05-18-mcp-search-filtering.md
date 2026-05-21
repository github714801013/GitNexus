# MCP Search Filtering (head parameter) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `head` parameter to MCP search tools (starting with `query`) to whitelist repositories for multi-repo search, filtering results to only those matching the specified list.

**Architecture:** Update `tools.ts` to include `head` (array of strings) in the `query` tool's input schema. Modify `local-backend.ts` to filter discovered repositories (via Zoekt) or explicit fanned-out repositories against this whitelist before execution.

**Tech Stack:** TypeScript, MCP SDK, Vitest

---

### Task 1: Environment & Test Setup

**Files:**
- Create: `gitnexus/test/unit/mcp-filtering.test.ts`

- [ ] **Step 1: Create a failing test for the 'head' parameter**
Create a test that calls `backend.callTool('query', { query: 'test', head: ['repo-a'] })` and asserts that results from 'repo-b' are excluded even if discovered.

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalBackend } from '../../src/mcp/local/local-backend.js';

describe('LocalBackend filtering with "head"', () => {
  it('should filter query results to only include repositories in the "head" whitelist', async () => {
    // Mock setup will be detailed in implementation
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**
Run: `cd gitnexus && npx vitest run test/unit/mcp-filtering.test.ts`
Expected: FAIL (parameter 'head' not recognized or ignored)

- [ ] **Step 3: Commit**
```bash
git add gitnexus/test/unit/mcp-filtering.test.ts
git commit -m "test: add failing test for mcp search head filtering"
```

### Task 2: Update MCP Tool Schema

**Files:**
- Modify: `gitnexus/src/mcp/tools.ts`

- [ ] **Step 1: Add "head" to the query tool schema**
Add `head` property to the `inputSchema` of the `query` tool.

```typescript
// gitnexus/src/mcp/tools.ts
// Inside GITNEXUS_TOOLS for 'query'
        head: {
          type: 'array',
          items: { type: 'string' },
          description: 'Whitelist of repository names or aliases to include in the search results.',
        },
```

- [ ] **Step 2: Commit**
```bash
git add gitnexus/src/mcp/tools.ts
git commit -m "feat: add head parameter to query tool schema"
```

### Task 3: Implement Filtering Logic in LocalBackend

**Files:**
- Modify: `gitnexus/src/mcp/local/local-backend.ts`

- [ ] **Step 1: Update callTool to extract head and filter discovery**
In `callTool`, when processing `query`, if `head` is provided, filter the `discovered` repositories.

```typescript
// gitnexus/src/mcp/local/local-backend.ts
// Inside callTool 'query' handling
      let discovered = await this.discoveryReposViaZoekt(discoveryQuery);
      if (Array.isArray(p.head) && p.head.length > 0) {
        discovered = discovered.filter(r => p.head.includes(r.name) || p.head.includes(r.id));
      }
```

- [ ] **Step 2: Run the test to verify it passes**
Run: `cd gitnexus && npx vitest run test/unit/mcp-filtering.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**
```bash
git add gitnexus/src/mcp/local/local-backend.ts
git commit -m "feat: implement head filtering in LocalBackend.query"
```

### Task 4: Final Verification & Red Team Review

- [ ] **Step 1: Run all related tests**
Run: `cd gitnexus && npx vitest run test/unit/zoekt-query-integration.test.ts test/unit/mcp-filtering.test.ts`

- [ ] **Step 2: AI Red Team Review**
Invoke `@generalist` to review the implementation for security and edge cases (e.g., empty head, invalid repo names).

- [ ] **Step 3: Commit and Cleanup**
```bash
git commit -m "chore: finalize mcp filtering implementation"
```
