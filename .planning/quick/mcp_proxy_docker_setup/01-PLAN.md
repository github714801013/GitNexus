---
phase: mcp_proxy_docker_setup
plan: 01
type: execute
wave: 1
depends_on: []
files_modified: []
autonomous: true
requirements: [MCP-PROXY-01, MCP-PROXY-02, MCP-PROXY-03, MCP-PROXY-04, MCP-PROXY-05, MCP-PROXY-06]
user_setup:
  - service: gitea
    why: "Webhook authentication"
    env_vars:
      - name: GITEA_SECRET
        source: "Gitea Repo Settings -> Webhooks -> Secret"
      - name: PROJECTS_ROOT
        source: "The root directory containing your git repositories on the host"

must_haves:
  truths:
    - "Gitea webhook triggers GitNexus index update"
    - "New directory in project root automatically triggers indexing"
    - "Docker container sees same paths as host for indexed files"
    - "Concurrent index updates for same repo are serialized via locking"
  artifacts:
    - path: "mcp_proxy_docker/app/main.py"
      provides: "FastAPI webhook server"
    - path: "mcp_proxy_docker/app/watcher.py"
      provides: "Directory monitoring service"
    - path: "mcp_proxy_docker/Dockerfile"
      provides: "Docker image definition"
    - path: "mcp_proxy_docker/docker-compose.yml"
      provides: "Host-matching container orchestration"
  key_links:
    - from: "mcp_proxy_docker/app/main.py"
      to: "npx gitnexus analyze"
      via: "subprocess.run"
      pattern: "npx gitnexus analyze"
---

<objective>
Setup a Python-based proxy and management service for GitNexus in Docker, supporting Gitea webhooks and dynamic project indexing.
The service will monitor a project root for new repositories and handle Gitea push events to auto-update GitNexus indexes.
</objective>

<execution_context>
@C:/Users/Administrator/.gemini/get-shit-done/workflows/execute-plan.md
@C:/Users/Administrator/.gemini/get-shit-done/templates/summary.md
</execution_context>

<context>
@gitnexus/package.json
@gitnexus/src/cli/mcp.ts
@gitnexus/src/storage/repo-manager.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Project Foundation & Webhook Server</name>
  <files>mcp_proxy_docker/app/main.py, mcp_proxy_docker/app/executor.py, mcp_proxy_docker/requirements.txt</files>
  <action>
    - Create `mcp_proxy_docker/` directory structure.
    - Create `mcp_proxy_docker/requirements.txt` with `fastapi`, `uvicorn`, `pydantic`, `watchdog`, and `portalocker`.
    - Implement `mcp_proxy_docker/app/executor.py` containing a `run_analyze(path)` function.
      - Use `portalocker` (or similar) to ensure only one `gitnexus analyze` process runs per repository path at any given time.
      - Execute `npx gitnexus analyze` via `subprocess.run` within the repository path.
    - Implement `mcp_proxy_docker/app/main.py` using FastAPI.
      - Add a `/webhook/gitea` POST endpoint that parses Gitea push events.
      - Map the repository name from the payload to a local path under `PROJECTS_ROOT`.
      - Use `BackgroundTasks` to trigger `run_analyze(repo_path)` asynchronously.
      - Include basic secret validation using the `GITEA_SECRET` environment variable.
  </action>
  <verify>
    <automated>python3 -m pytest mcp_proxy_docker/tests/test_webhook.py</automated>
  </verify>
  <done>FastAPI server running with webhook endpoint, successfully triggering indexer with locking.</done>
</task>

<task type="auto">
  <name>Task 2: Dynamic Project Monitoring</name>
  <files>mcp_proxy_docker/app/watcher.py</files>
  <action>
    - Implement `mcp_proxy_docker/app/watcher.py` using `watchdog`.
    - Configure an `Observer` to watch `PROJECTS_ROOT`.
    - When a new directory is created:
      - Verify it contains a `.git` folder.
      - Check if it is already indexed in GitNexus (optional, or just run analyze to ensure).
      - Trigger an initial `run_analyze(repo_path)`.
    - Integrate the watcher into the FastAPI startup lifecycle (`@app.on_event("startup")`).
  </action>
  <verify>
    <automated>python3 mcp_proxy_docker/tests/test_watcher.py</automated>
  </verify>
  <done>Directory monitor detects new git repositories and triggers indexing automatically.</done>
</task>

<task type="auto">
  <name>Task 3: Dockerization & Host-Path Matching</name>
  <files>mcp_proxy_docker/Dockerfile, mcp_proxy_docker/docker-compose.yml, mcp_proxy_docker/entrypoint.sh</files>
  <action>
    - Create `mcp_proxy_docker/Dockerfile`:
      - Use `node:20-bullseye` or `python:3.11-slim-bullseye` as base (ensure both Node.js and Python are installed).
      - COPY `gitnexus/` directory to `/app/gitnexus`.
      - RUN `cd /app/gitnexus && npm install && npm run build && npm link`.
      - COPY `mcp_proxy_docker/` directory to `/app/mcp_proxy`.
      - RUN `pip install -r /app/mcp_proxy/requirements.txt`.
    - Create `mcp_proxy_docker/docker-compose.yml`:
      - Map `PROJECTS_ROOT` on host to the SAME absolute path in the container (e.g., `- ${PROJECTS_ROOT}:${PROJECTS_ROOT}`).
      - Map host's `~/.gitnexus` to the SAME path in the container to share the registry and indices.
      - Set `GITEA_SECRET` and `PROJECTS_ROOT` environment variables.
    - Create `mcp_proxy_docker/entrypoint.sh` to start the FastAPI server (which in turn starts the watcher).
  </action>
  <verify>
    <automated>docker compose -f mcp_proxy_docker/docker-compose.yml up -d && docker ps | grep mcp_proxy_docker</automated>
  </verify>
  <done>GitNexus MCP proxy running in Docker with identical path mappings and functional webhook/monitoring.</done>
</task>

</tasks>

<verification>
Checklist for completion:
- [ ] Gitea webhook triggers `gitnexus analyze` for the correct repo.
- [ ] New git repo folders in `PROJECTS_ROOT` are indexed automatically.
- [ ] Docker container paths match host paths exactly.
- [ ] Concurrent `analyze` requests for the same repo are queued or locked correctly.
- [ ] Existing source code is NOT modified (all work in `mcp_proxy_docker/`).
</verification>

<success_criteria>
- A new git repository added to the host's projects directory is automatically indexed by GitNexus within 60 seconds.
- A push to Gitea triggers a webhook call that successfully refreshes the GitNexus index for that repository.
- `npx gitnexus list` inside the container shows all repositories with their host-equivalent absolute paths.
</success_criteria>

<output>
After completion, create `.planning/quick/mcp_proxy_docker_setup/01-SUMMARY.md`
</output>
