# Add Zoekt Search Parameter Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add logging of search parameters (query, repo filter, etc.) to Zoekt search operations to improve observability.

**Architecture:** Inject logging statements into the `ZoektClient` methods in `gitnexus/src/core/search/zoekt-client.ts` before the search requests are dispatched.

**Tech Stack:** TypeScript, Node.js

---

### Task 1: Add logging to `ZoektClient.search` and `ZoektClient.symbolSearch`

**Files:**
- Modify: `gitnexus/src/core/search/zoekt-client.ts`

- [ ] **Step 1: Add logging to `search` method**

```typescript
  async search(query: string, opts: ZoektSearchOpts = {}): Promise<ZoektSearchResult> {
    console.log(`[zoekt] search: query="${query}", opts=${JSON.stringify(opts)}`);
    const results = await this.queryAllEndpoints(query, opts);
    return this.mergeResults(results);
  }
```

- [ ] **Step 2: Add logging to `symbolSearch` method**

```typescript
  async symbolSearch(
    symbol: string,
    _kind: string = 'all',
    opts: ZoektSearchOpts = {},
  ): Promise<ZoektSearchResult> {
    console.log(`[zoekt] symbolSearch: symbol="${symbol}", kind="${_kind}", opts=${JSON.stringify(opts)}`);
    const q = `sym:${symbol}`;
    return this.search(q, opts);
  }
```

- [ ] **Step 3: Commit**

```bash
git add gitnexus/src/core/search/zoekt-client.ts
git commit -m "feat(zoekt): add logging for search and symbolSearch parameters"
```

### Task 2: Add logging to `ZoektClient.queryEndpoint`

**Files:**
- Modify: `gitnexus/src/core/search/zoekt-client.ts`

- [ ] **Step 1: Add logging to `queryEndpoint` method to see the final query sent to Zoekt**

```typescript
  private async queryEndpoint(
    endpoint: string,
    query: string,
    opts: ZoektSearchOpts,
  ): Promise<ZoektSearchResult> {
    const url = `${endpoint.replace(/\/$/, '')}/api/search`;
    // ... existing code to construct q ...
    const repoQuery = opts.repoFilter
      ? `repo:(^|/)${escapeZoektRepoRegex(opts.repoFilter)}$`
      : undefined;
    const q = repoQuery ? `${repoQuery} ${query}` : query;
    
    console.log(`[zoekt] querying endpoint ${endpoint}: Q="${q}"`);
    
    // ... rest of the method ...
  }
```

- [ ] **Step 2: Commit**

```bash
git add gitnexus/src/core/search/zoekt-client.ts
git commit -m "feat(zoekt): add per-endpoint query logging"
```

### Task 3: Verification

- [ ] **Step 1: Run a test search using the CLI or a test script and verify console output**

Create a temporary test script `verify_logging.js`:
```javascript
import { ZoektClient } from './dist/core/search/zoekt-client.js';

async function main() {
  process.env.ZOEKT_URL = 'http://localhost:6070';
  const client = new ZoektClient();
  try {
    await client.search('test-query', { repoFilter: 'test-repo' });
  } catch (e) {
    // Ignore errors since we only care about logging before the request
  }
}
main();
```

Run: `node verify_logging.js`
Expected: See `[zoekt] search: ...` and `[zoekt] querying endpoint ...` in console.

- [ ] **Step 2: Cleanup temporary files**

```bash
rm verify_logging.js
```
