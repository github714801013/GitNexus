---
phase: mcp_proxy_docker_setup
plan: 02
type: execute
wave: 2
depends_on: [01]
files_modified: [mcp_proxy_docker/Dockerfile, mcp_proxy_docker/entrypoint.sh, mcp_proxy_docker/docker-compose.yml]
autonomous: true
requirements: [MCP-PROXY-07, MCP-PROXY-08, MCP-PROXY-09]
user_setup: []

must_haves:
  truths:
    - "FastAPI webhook server is running in the background"
    - "MCP SSE server (mcp-proxy) is running in the foreground"
    - "MCP SSE server correctly wraps `gitnexus mcp`"
  artifacts:
    - path: "mcp_proxy_docker/Dockerfile"
      contains: "npm install -g mcp-proxy"
    - path: "mcp_proxy_docker/entrypoint.sh"
      contains: "mcp-proxy"
    - path: "mcp_proxy_docker/docker-compose.yml"
      contains: "3000:3000"
  key_links:
    - from: "mcp-proxy"
      to: "gitnexus mcp"
      via: "subprocess command line"
---

<objective>
Integrate `mcp-proxy` into the existing Docker setup to expose GitNexus MCP as an SSE service.
This involves updating the Docker configuration to include the necessary dependencies and modifying the startup process to run both the management FastAPI server and the MCP proxy server.
</objective>

<execution_context>
@C:/Users/Administrator/.gemini/get-shit-done/workflows/execute-plan.md
@C:/Users/Administrator/.gemini/get-shit-done/templates/summary.md
</execution_context>

<context>
@mcp_proxy_docker/Dockerfile
@mcp_proxy_docker/entrypoint.sh
@mcp_proxy_docker/docker-compose.yml
@.planning/quick/mcp_proxy_docker_setup/01-SUMMARY.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Update Docker Image and Compose</name>
  <files>mcp_proxy_docker/Dockerfile, mcp_proxy_docker/docker-compose.yml</files>
  <action>
    - Update `mcp_proxy_docker/Dockerfile`:
      - Add `RUN npm install -g mcp-proxy` before the app code copy.
      - Add `EXPOSE 3000` to indicate the MCP SSE port.
    - Update `mcp_proxy_docker/docker-compose.yml`:
      - Map port `3000:3000` to expose the MCP SSE service to the host.
  </action>
  <verify>
    <automated>grep -q "npm install -g mcp-proxy" mcp_proxy_docker/Dockerfile && grep -q "3000:3000" mcp_proxy_docker/docker-compose.yml</automated>
  </verify>
  <done>Docker configuration updated to include mcp-proxy and expose the necessary port.</done>
</task>

<task type="auto">
  <name>Task 2: Update Entrypoint for Dual-Service Startup</name>
  <files>mcp_proxy_docker/entrypoint.sh</files>
  <action>
    - Update `mcp_proxy_docker/entrypoint.sh`:
      - Modify the script to start `uvicorn` in the background (using `&`).
      - Start `mcp-proxy --port 3000 -- gitnexus mcp` in the foreground.
      - Ensure both services log output and the container exits if the foreground service dies.
  </action>
  <verify>
    <automated>grep -q "uvicorn.*&" mcp_proxy_docker/entrypoint.sh && grep -q "mcp-proxy.*gitnexus mcp" mcp_proxy_docker/entrypoint.sh</automated>
  </verify>
  <done>Entrypoint script updated to run both FastAPI and the MCP SSE proxy.</done>
</task>

</tasks>

<verification>
Checklist for completion:
- [ ] `mcp-proxy` is installed in the Docker image.
- [ ] Port 3000 is exposed in `docker-compose.yml`.
- [ ] `entrypoint.sh` starts `uvicorn` in background and `mcp-proxy` in foreground.
- [ ] `mcp-proxy` is configured to wrap `gitnexus mcp`.
</verification>

<success_criteria>
- Running `docker compose up` starts both services.
- FastAPI (webhook) is accessible on port 8000.
- MCP SSE (GitNexus) is accessible on port 3000.
</success_criteria>

<output>
After completion, create `.planning/quick/mcp_proxy_docker_setup/02-SUMMARY.md`
</output>
