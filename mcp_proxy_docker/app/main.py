from fastapi import FastAPI, Request, BackgroundTasks, HTTPException
import os
import logging
import json
from typing import Optional
from contextlib import asynccontextmanager
from .executor import run_analyze

# Configure Logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("mcp_proxy.main")

def get_projects_root():
    # 宿主机环境通过环境变量注入此路径
    return os.getenv("PROJECTS_ROOT", "/projects")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Log info
    projects_root = get_projects_root()
    logger.info(f"Starting GitNexus MCP Proxy in Trust Mode with PROJECTS_ROOT={projects_root}")
    yield
    # Shutdown: Log info
    logger.info("GitNexus MCP Proxy stopping.")

app = FastAPI(title="GitNexus MCP Proxy Service (Webhook Optimized)", lifespan=lifespan)

@app.get("/health")
def health_check():
    return {"status": "ok", "projects_root": get_projects_root()}

@app.post("/webhook/gitea")
async def gitea_webhook(
    request: Request, 
    background_tasks: BackgroundTasks
):
    """
    Webhook handler for Gitea.
    - Clones repository if missing locally.
    - Updates and analyzes repository if already exists.
    """
    projects_root = get_projects_root()
    
    try:
        payload = await request.json()
    except Exception:
        logger.error("Failed to decode JSON payload")
        raise HTTPException(status_code=400, detail="Invalid JSON")

    # Extract repo info
    try:
        repo_data = payload.get("repository", {})
        repo_name = repo_data.get("full_name")  # e.g., "user/repo"
        clone_url = repo_data.get("clone_url")  # SSH or HTTP URL
        
        # Extract branch from ref (e.g., refs/heads/main -> main)
        ref = payload.get("ref", "")
        branch = ref.replace("refs/heads/", "") if ref.startswith("refs/heads/") else None
        
        if not repo_name:
            logger.error("Repository full_name not found in payload")
            raise HTTPException(status_code=400, detail="Repository full_name missing")
        
        # Determine local path (mapping repo_name directly to subfolders in projects_root)
        repo_path = os.path.join(projects_root, repo_name)
        
        logger.info(f"Queueing indexing for {repo_name} (URL: {clone_url}, Branch: {branch}) at {repo_path}")
        # Pass clone_url and branch to background task to allow cloning and switching branches
        background_tasks.add_task(run_analyze, repo_path, clone_url, branch)
        
        return {"status": "accepted", "repository": repo_name, "path": repo_path}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing webhook: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
