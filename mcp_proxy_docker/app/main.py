from fastapi import FastAPI, Request, BackgroundTasks, HTTPException
import os
import asyncio
import logging
import json
import portalocker
from typing import Optional
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor
from .executor import run_analyze

# Configure Logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("mcp_proxy.main")

def get_projects_root():
    # 宿主机环境通过环境变量注入此路径
    return os.getenv("PROJECTS_ROOT", "/projects")

_startup_executor = ThreadPoolExecutor(max_workers=2)

@asynccontextmanager
async def lifespan(app: FastAPI):
    projects_root = get_projects_root()
    logger.info(f"Starting GitNexus MCP Proxy in Trust Mode with PROJECTS_ROOT={projects_root}")

    # 启动时读取 repos.json，对每个 repo 触发后台索引
    repos_file = os.path.join(projects_root, "repos.json")
    if os.path.exists(repos_file):
        try:
            with open(repos_file, 'r') as f:
                repos_list = json.load(f)
            logger.info(f"Auto-indexing {len(repos_list)} repos from repos.json on startup...")
            loop = asyncio.get_event_loop()
            for repo in repos_list:
                full_name = repo.get("full_name")
                clone_url = repo.get("clone_url")
                branch = repo.get("branch")
                if full_name:
                    repo_path = os.path.join(projects_root, full_name)
                    logger.info(f"Scheduling startup index: {full_name} -> {repo_path}")
                    loop.run_in_executor(_startup_executor, run_analyze, repo_path, clone_url, branch)
        except Exception as e:
            logger.error(f"Failed to auto-index repos on startup: {e}")
    else:
        logger.info(f"No repos.json found at {repos_file}, skipping auto-index.")

    yield
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
        
        # Update the dynamic repos.json config file to keep track of Webhook-added repos and branches
        repos_file = os.path.join(projects_root, "repos.json")
        
        try:
            # 使用文件锁防止并发写入冲突
            with portalocker.Lock(repos_file, 'a+', timeout=10) as f:
                f.seek(0)
                try:
                    content = f.read()
                    repos_list = json.loads(content) if content else []
                except Exception:
                    repos_list = []
                
                found = False
                for r in repos_list:
                    if r.get("full_name") == repo_name:
                        if clone_url:
                            r["clone_url"] = clone_url
                        if branch:
                            r["branch"] = branch
                        found = True
                        break
                
                if not found:
                    repos_list.append({
                        "full_name": repo_name,
                        "clone_url": clone_url,
                        "branch": branch or "master"
                    })
                
                f.seek(0)
                f.truncate()
                json.dump(repos_list, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Failed to update repos.json concurrently: {e}")

        logger.info(f"Queueing indexing for {repo_name} (URL: {clone_url}, Branch: {branch}) at {repo_path}")
        # Pass clone_url and branch to background task to allow cloning and switching branches
        background_tasks.add_task(run_analyze, repo_path, clone_url, branch)
        
        return {"status": "accepted", "repository": repo_name, "path": repo_path}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing webhook: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
