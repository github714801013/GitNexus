# Code Snippet Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fast MCP tool that reads a bounded code snippet by repo, file path, and line range.

**Architecture:** The tool resolves the indexed repo through the existing registry-backed `LocalBackend.resolveRepo`, then reads directly from the repository file without LadybugDB, Zoekt, or repo locks. It validates path containment and clamps output through file-size, line-count, and character-count limits.

**Tech Stack:** TypeScript, Node fs/path APIs, Vitest.

---

### Task 1: Tool Schema

**Files:**
- Modify: `gitnexus/src/mcp/tools.ts`
- Test: `gitnexus/test/unit/tools.test.ts`

- [ ] Add `code_snippet` to `GITNEXUS_TOOLS`.
- [ ] Require `filePath`, `startLine`, and `endLine`.
- [ ] Include optional `repo`.
- [ ] Add bounds for line inputs.
- [ ] Update tool-count and expected-name tests.

### Task 2: Fast File Reader

**Files:**
- Modify: `gitnexus/src/mcp/local/local-backend.ts`
- Test: `gitnexus/test/unit/mcp/code-snippet.test.ts`

- [ ] Add `code_snippet` dispatch in `LocalBackend.callTool`.
- [ ] Implement path normalization and repo-root containment checks.
- [ ] Reject files larger than the configured max file size.
- [ ] Reject ranges over the max line limit.
- [ ] Read directly from disk and retry once for transient file errors.
- [ ] Return repo metadata, file path, requested range, actual range, commit, and content.

### Task 3: Verification

**Files:**
- Test: `gitnexus/test/unit/tools.test.ts`
- Test: `gitnexus/test/unit/mcp/code-snippet.test.ts`

- [ ] Run RED test before implementation.
- [ ] Run focused unit tests after implementation.
- [ ] Run `npx tsc --noEmit`.
- [ ] Confirm existing unrelated Zoekt edits remain untouched.
