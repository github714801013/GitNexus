# Webhook Worktree Env Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add TypeScript support for environment-scoped webhook worktree indexing and MCP header filtering.

**Architecture:** Keep `/api/analyze` unchanged. Add a small worktree/index bootstrap service for `POST /api/webhook/:env/index`, reuse the existing analyze worker for background refresh, and extend MCP session scoping with an environment-prefix filter. The fast path copies an existing main `.gitnexus` index when available, then refreshes in the background.

**Tech Stack:** TypeScript, Express, Vitest, Node child_process, existing GitNexus storage registry.

---

### Task 1: Runtime And Scope Check

**Files:**
- Read: `AGENTS.md`
- Read: `GUARDRAILS.md`
- Read: `docs/superpowers/specs/2026-05-21-webhook-worktree-env-index-design.md`
- Modify: `docs/superpowers/TODO.md`

- [ ] **Step 1: Confirm branch and runtime**

Run: `git branch --show-current; node --version; npm --version`
Expected: branch is `codex/webhook-worktree-env-index`, Node is `>=20`.

- [ ] **Step 2: Record GitNexus MCP impact limitation**

Run: `remote_gitnexus.impact(repo="GitNexus", target="createMCPServer", direction="upstream")`
Expected: if repo is unavailable, record fallback to local tests before editing.

### Task 2: MCP Env Header Filtering

**Files:**
- Modify: `gitnexus/src/mcp/server.ts`
- Modify: `gitnexus/src/server/mcp-http.ts`
- Test: `gitnexus/test/unit/mcp-header-scoping.test.ts`
- Test: `gitnexus/test/unit/mcp-http.test.ts`

- [ ] **Step 1: Write failing tests for env prefix filtering**

Add tests proving `createMCPServer(backend, { projects: ["dev-api"], envs: ["dev"] })` only allows the intersection and that `env: dev` is passed from `/sse`.

- [ ] **Step 2: Run focused tests to see RED**

Run: `npm test -- test/unit/mcp-header-scoping.test.ts test/unit/mcp-http.test.ts`
Expected: fail because `createMCPServer` does not accept env scoping yet.

- [ ] **Step 3: Implement minimal MCP scope object**

Change `createMCPServer` to accept either the existing string array or a scope object `{ projects?: string[]; envs?: string[] }`. Preserve old callers. Add env-prefix check using `${env}-`.

- [ ] **Step 4: Parse `env` in SSE handler**

Read both `projects` and `env` headers in `mountMCPEndpoints`, pass the scope object, and keep existing behavior when no env header exists.

- [ ] **Step 5: Run focused tests to see GREEN**

Run: `npm test -- test/unit/mcp-header-scoping.test.ts test/unit/mcp-http.test.ts`
Expected: pass.

### Task 3: Worktree Webhook Bootstrap

**Files:**
- Create: `gitnexus/src/server/webhook-worktree.ts`
- Modify: `gitnexus/src/server/api.ts`
- Modify: `gitnexus/src/server/analyze-worker.ts`
- Test: `gitnexus/test/unit/webhook-worktree.test.ts`

- [ ] **Step 1: Write failing unit tests for request validation and naming**

Test allowed env parsing, safe name validation, `registryName = env-projectName`, and 403 for disallowed env.

- [ ] **Step 2: Write failing unit tests for worktree decisions**

Test missing main repo without `repoUrl`, existing worktree reuse, and mismatched worktree conflict returning a typed conflict error.

- [ ] **Step 3: Run focused test to see RED**

Run: `npm test -- test/unit/webhook-worktree.test.ts`
Expected: fail because the module does not exist.

- [ ] **Step 4: Implement validation and path helpers**

Implement `parseAllowedEnvs`, `assertSafeSegment`, `buildRegistryName`, `getManagedWorktreePath`, and typed errors. Keep worktree roots under `~/.gitnexus/worktrees`.

- [ ] **Step 5: Implement git worktree helper**

Use `git worktree add -b <branch> <path> <baseRef>` for new branches and `git worktree add <path> <branch>` for existing branches. Reject mismatched existing paths.

- [ ] **Step 6: Implement index copy bootstrap**

If main `.gitnexus/meta.json` and `lbug` exist, copy `.gitnexus` into the worktree, update `meta.json` fields for path, branch, commit and indexed time, then register with the env registry name.

- [ ] **Step 7: Add webhook route**

Mount `POST /api/webhook/:env/index`, validate body, create or reuse worktree, return `202` with `warming` or `analyzing`, and start the existing analyze worker with `registryName`.

- [ ] **Step 8: Run focused tests to see GREEN**

Run: `npm test -- test/unit/webhook-worktree.test.ts test/unit/analyze-api.test.ts`
Expected: pass.

### Task 4: Typecheck And Audit

**Files:**
- Modify: `docs/superpowers/TODO.md`

- [ ] **Step 1: Run TypeScript compile**

Run: `npx tsc --noEmit`
Expected: pass.

- [ ] **Step 2: Run focused unit tests**

Run: `npm test -- test/unit/mcp-header-scoping.test.ts test/unit/mcp-http.test.ts test/unit/webhook-worktree.test.ts test/unit/analyze-api.test.ts`
Expected: pass.

- [ ] **Step 3: Run red-team review**

Ask a reviewer agent to inspect the implementation for at least two risk points or missed edge cases before finalizing.

- [ ] **Step 4: Run change impact fallback**

Run: `git diff --name-only` and, if GitNexus MCP remains unavailable for this repo, report that graph-backed `detect_changes` could not run.

