# 2026-04-25-cpu-deployment-refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine the CPU deployment on server 10.1.250.157, unifying token management and resolving analysis exceptions.

**Architecture:** 
- Centralize all secrets (Git Token, Embedding Key) into a unified configuration file or environment variables managed by the deployment script.
- Update the deployment script to reflect the validated `seccomp=unconfined` security option and remote embedding parameters.
- Enhance logging and error handling in the analyze process to debug Git clone and database issues.

**Tech Stack:** Docker, Bash, Node.js, Python, Git.

---

### Task 1: Environment Audit & Log Analysis

**Files:**
- Remote: `docker logs gitnexus-mcp-proxy-cpu`

- [ ] **Step 1: Fetch and analyze remote logs**
    - Run: `ssh -i "$HOME/.ssh/id_rsa_gitnexus" devops@10.1.250.157 "docker logs --tail 200 gitnexus-mcp-proxy-cpu"`
    - Goal: Identify exact Git clone error messages and any "analyze" process stack traces.

- [ ] **Step 2: Check remote filesystem state**
    - Run: `ssh -i "$HOME/.ssh/id_rsa_gitnexus" devops@10.1.250.157 "ls -R /data1/mcp_gitnexus_project/"`
    - Goal: Verify `.gitnexus` and `project` folder structures and permissions.

### Task 2: Unified Token Management

**Files:**
- Modify: `mcp_proxy_docker/remote_deploy_cpu.sh`
- Modify: `mcp_proxy_docker/entrypoint.sh`

- [ ] **Step 1: Centralize tokens in deployment script**
    - Define variables at the top of `remote_deploy_cpu.sh`: `GITEA_TOKEN`, `EMBEDDING_KEY`, `VITE_BACKEND_URL`.
    - Pass these via `--env-file` or multiple `-e` flags to `docker run`.

- [ ] **Step 2: Update entrypoint to handle environment variables robustly**
    - Ensure `GITEA_TOKEN` and `GITNEXUS_EMBEDDING_KEY` are correctly exported.

### Task 3: Script Refinement & Deployment Fixes

**Files:**
- Modify: `mcp_proxy_docker/remote_deploy_cpu.sh`
- Modify: `mcp_proxy_docker/app/executor.py` (if token injection needs fix)

- [ ] **Step 1: Update `remote_deploy_cpu.sh` with validated parameters**
    - Include `--security-opt seccomp=unconfined`.
    - Fix `VITE_BACKEND_URL` to point to `http://10.1.250.157:1349`.
    - Add logic to check and create remote directories if missing.

- [ ] **Step 2: Fix Git Token injection in executor**
    - Verify `executor.py` correctly uses the token for cloning.
    - If needed, modify `executor.py` to support `https://<token>@host/repo` format or Git credential helper.

### Task 4: Final Verification & Compliance Audit

**Files:**
- New: `docs/superpowers/COMPLIANCE_AUDIT.md`

- [ ] **Step 1: Execute refined deployment**
    - Run: `bash mcp_proxy_docker/remote_deploy_cpu.sh`

- [ ] **Step 2: Verify indexing success**
    - Monitor logs: `docker logs -f gitnexus-mcp-proxy-cpu`
    - Check for "Indexing complete" or "Success" messages for all 3 repos.

- [ ] **Step 3: Run Compliance Audit**
    - Create `docs/superpowers/COMPLIANCE_AUDIT.md` based on `dev-spec-gen` rules.
