# GitNexus MCP Proxy Roadmap

This roadmap tracks the development of the Dockerized proxy and management service for GitNexus.

## Phase 1: Foundation & Webhook Server
- [x] 01-PLAN.md: Setup FastAPI webhook server, directory monitoring, and basic Dockerization.
- [x] 01-SUMMARY.md: Completed on 2026-03-17.

## Phase 2: MCP SSE Integration
- [ ] 02-PLAN.md: Integrate `mcp-proxy` (npm) to expose GitNexus MCP as an SSE service.

**Requirements:** [MCP-PROXY-07, MCP-PROXY-08, MCP-PROXY-09]
**Goal:** Expose GitNexus MCP (stdio) as an SSE service using the `mcp-proxy` package.
**Plans:** 1 plan
- [ ] 02-PLAN.md — Integrate `mcp-proxy` to expose GitNexus MCP as an SSE service.
