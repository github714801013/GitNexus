# MCP SSE Close Reentry Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `gitnexus serve` 在 MCP SSE transport close 期间递归调用 `server.close()` 导致 `RangeError: Maximum call stack size exceeded` 并退出的问题。

**Architecture:** `mountMCPEndpoints` 为每个 SSE session 创建一个 MCP `Server` 与 `SSEServerTransport`。根因假设是 SDK transport close 会触发 `transport.onclose`，而当前 onclose 再调用 `server.close()`，形成 close 重入；修复应在 HTTP 挂载层增加 session close 幂等 guard，不改变工具调用、query 结果或 SSE 路由契约。

**Tech Stack:** TypeScript, Express, MCP SDK `SSEServerTransport`, Vitest.

---

### Task 1: 写失败单测覆盖 close 重入

**Files:**
- Create: `gitnexus/test/unit/mcp-http.test.ts`

- [ ] **Step 1: Mock MCP SDK SSE transport 与 createMCPServer**

```ts
import { describe, expect, it, vi } from 'vitest';
import { mountMCPEndpoints } from '../../src/server/mcp-http.js';

const closeMock = vi.fn();
const connectMock = vi.fn();
let lastTransport: any;

vi.mock('@modelcontextprotocol/sdk/server/sse.js', () => ({
  SSEServerTransport: vi.fn().mockImplementation((_endpoint: string, _res: any) => {
    lastTransport = {
      sessionId: 'session-1',
      close: vi.fn().mockResolvedValue(undefined),
      handlePostMessage: vi.fn().mockResolvedValue(undefined),
      onclose: undefined,
    };
    return lastTransport;
  }),
}));

vi.mock('../../src/mcp/server.js', () => ({
  createMCPServer: vi.fn(() => ({
    connect: connectMock.mockResolvedValue(undefined),
    close: closeMock.mockImplementation(async () => {
      await lastTransport.close();
      lastTransport.onclose?.();
    }),
  })),
}));
```

- [ ] **Step 2: 模拟 Express 注册并触发 `/sse`**

```ts
function createApp() {
  const handlers: Record<string, any> = {};
  return {
    handlers,
    app: {
      get: vi.fn((path: string, handler: any) => {
        handlers[`GET ${path}`] = handler;
      }),
      post: vi.fn((path: string, handler: any) => {
        handlers[`POST ${path}`] = handler;
      }),
    },
  };
}
```

- [ ] **Step 3: 写 RED 断言**

```ts
describe('mountMCPEndpoints close handling', () => {
  it('closes a server once when transport onclose re-enters through SDK close', async () => {
    const { app, handlers } = createApp();
    mountMCPEndpoints(app as any, {} as any);

    await handlers['GET /sse']({ headers: {} }, {});
    await lastTransport.onclose();

    expect(closeMock).toHaveBeenCalledTimes(1);
  });
});
```

Expected before fix: FAIL，`closeMock` 被重复调用或递归触发。

### Task 2: 最小修复 close 幂等

**Files:**
- Modify: `gitnexus/src/server/mcp-http.ts`

- [ ] **Step 1: 在 session 作用域增加 close guard**

```ts
let closed = false;
const closeSession = async () => {
  if (closed) return;
  closed = true;
  transports.delete(sessionId);
  await server.close();
};

transport.onclose = () => {
  void closeSession();
};
```

- [ ] **Step 2: cleanup 仍只关闭 transport**

保留 `cleanup` 的 `t.close()` 聚合逻辑；transport close 会触发 `onclose`，由 guard 负责删除 map 与关闭 server，避免重复。

### Task 3: 验证

**Files:**
- Test: `gitnexus/test/unit/mcp-http.test.ts`

- [ ] **Step 1: 运行定向测试**

Run: `cd gitnexus; npx vitest run test/unit/mcp-http.test.ts`

Expected: PASS。

- [ ] **Step 2: 运行 TypeScript 编译检查**

Run: `cd gitnexus; npx tsc --noEmit`

Expected: PASS。

- [ ] **Step 3: 检查改动范围**

Run: `git diff -- gitnexus/src/server/mcp-http.ts gitnexus/test/unit/mcp-http.test.ts docs/superpowers/TODO.md docs/superpowers/plans/2026-05-18-mcp-sse-close-reentry.md`

Expected: 只包含本计划声明文件。
