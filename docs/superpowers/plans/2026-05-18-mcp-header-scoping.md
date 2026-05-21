# MCP Project Scoping via Headers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow scoping an MCP session to a specific set of repositories using the `projects` HTTP header. The server will only expose and operate on repositories matching this whitelist.

**Architecture:** 
1. Modify `mcp-http.ts` to extract the `projects` header during session initialization.
2. Update `createMCPServer` in `server.ts` to accept an optional `projectWhitelist` array.
3. Update `LocalBackend` or the server handlers to respect this whitelist when listing tools, resources, and repositories.
4. Specifically for the `query` tool, if `projects` is set, restrict discovery and multi-repo fan-out to the whitelist.

**Tech Stack:** TypeScript, MCP SDK, Express

---

### Task 1: Environment & Test Setup

**Files:**
- Create: `gitnexus/test/unit/mcp-header-scoping.test.ts`

- [ ] **Step 1: Create a test for header-based project scoping**
Create a test that simulates an HTTP request with `projects: project-a` and verifies that `list_repos` only returns `project-a`.

- [ ] **Step 2: Run the test and verify it fails**
Run: `cd gitnexus; npx vitest run test/unit/mcp-header-scoping.test.ts`
Expected: FAIL (header ignored, all repos returned)

### Task 2: Pass Whitelist from HTTP to Server

**Files:**
- Modify: `gitnexus/src/server/mcp-http.ts`
- Modify: `gitnexus/src/mcp/server.ts`

- [ ] **Step 1: Update createMCPServer signature**
Add `projectWhitelist?: string[]` to the `createMCPServer` function in `server.ts`.

- [ ] **Step 2: Extract header in mcp-http.ts**
In `mountMCPEndpoints`, extract `req.headers['projects']` and pass it (parsed as array) to `createMCPServer`.

### Task 3: Implement Filtering in Server Handlers

**Files:**
- Modify: `gitnexus/src/mcp/server.ts`
- Modify: `gitnexus/src/mcp/local/local-backend.ts`

- [ ] **Step 1: Filter list_repos tool output**
In `server.ts`, wrap the `backend.callTool` result for `list_repos` (or similar) to filter results if a whitelist exists. *Note: list_repos is a tool, so it's handled in LocalBackend.*

- [ ] **Step 2: Filter multi-repo discovery in LocalBackend**
Modify `LocalBackend.callTool` (specifically the `query` branch) to check a new internal `sessionWhitelist` property or similar. 

*Self-correction: Since LocalBackend is shared across sessions, we should probably pass the whitelist into the tool call or create a scoped view of the backend.*

**Revised Approach:**
Store the whitelist in the `Server` instance's `capabilities` or as a custom property, and pass it to `backend.callTool(name, args, whitelist)`.

### Task 4: Verification

- [ ] **Step 1: Run scoping tests**
Run: `cd gitnexus; npx vitest run test/unit/mcp-header-scoping.test.ts`

- [ ] **Step 2: Run integration tests**
Verify Zoekt discovery still works but is now constrained by the header whitelist.
