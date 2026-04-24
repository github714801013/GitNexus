import subprocess
import os
import portalocker
import logging
from typing import Optional
from urllib.parse import urlparse

logger = logging.getLogger("mcp_proxy.executor")

def get_authenticated_url(url: str) -> str:
    """
    Injects GITEA_TOKEN into the Git URL if available.
    """
    token = os.getenv("GITEA_TOKEN")
    if not token or not url.startswith("http"):
        return url
    
    parsed = urlparse(url)
    # Reconstruct URL with token: https://token@domain/path
    return f"{parsed.scheme}://{token}@{parsed.netloc}{parsed.path}"

def run_analyze(repo_path: str, git_url: Optional[str] = None, branch: Optional[str] = None):
    """
    Ensures the repository exists (clone if not), pulls latest changes, 
    and runs 'npx gitnexus analyze'.
    """
    
    # 1. Handle cloning if repository doesn't exist
    if not os.path.isdir(repo_path):
        # Webhook mapping is projects_root/group/repo
        # Let's check if it exists at projects_root/repo instead (flat structure fallback)
        projects_root = os.getenv("PROJECTS_ROOT", "/projects")
        repo_basename = os.path.basename(repo_path)
        flat_path = os.path.join(projects_root, repo_basename)
        
        if os.path.isdir(flat_path):
            logger.info(f"Found existing repository at flat path: {flat_path}")
            repo_path = flat_path
        elif not git_url:
            logger.error(f"Repository path {repo_path} does not exist and no git_url provided for cloning.")
            return False
        else:
            try:
                auth_url = get_authenticated_url(git_url)
                logger.info(f"Cloning {git_url} (authenticated) into {repo_path}")
                # Ensure parent directory exists
                os.makedirs(os.path.dirname(repo_path), exist_ok=True)
                
                clone_cmd = ["git", "clone", "--depth", "1"]
                if branch:
                    clone_cmd.extend(["-b", branch])
                clone_cmd.extend([auth_url, repo_path])

                # Use --depth 1 for faster initial clone in webhook
                result = subprocess.run(
                    clone_cmd,
                    capture_output=True,
                    text=True,
                    check=False
                )
                if result.returncode != 0:
                    logger.error(f"Failed to clone repository. Exit code: {result.returncode}")
                    if result.stderr:
                        # Clean stderr to avoid leaking token
                        clean_err = result.stderr.replace(os.getenv("GITEA_TOKEN", "MISSING_TOKEN"), "****")
                        logger.error(f"Clone error: {clean_err}")
                    return False
            except Exception as e:
                logger.error(f"Error during cloning: {str(e)}")
                return False

    # 2. Proceed with Update and Analyze using a Global Lock and per-repo Lock
    # Use a global lock to prevent concurrent GPU-heavy tasks
    global_lock_file = os.path.join(os.getenv("PROJECTS_ROOT", "/projects"), ".gitnexus_global.lock")
    lock_file = os.path.join(repo_path, ".gitnexus_analyze.lock")
    
    try:
        # First acquire global lock (wait up to 1 hour for others to finish)
        with portalocker.Lock(global_lock_file, timeout=3600):
            # Then acquire per-repo lock
            with portalocker.Lock(lock_file, timeout=60):
                # Mark directory as safe for git (to avoid dubious ownership issues in Docker)
                subprocess.run(["git", "config", "--global", "--add", "safe.directory", repo_path], check=False)

            # Ensure the latest code is pulled before indexing
            logger.info(f"Updating latest changes for {repo_path}")
            
            # Use authenticated URL for pull as well
            if git_url:
                auth_url = get_authenticated_url(git_url)
                subprocess.run(
                    ["git", "remote", "set-url", "origin", auth_url],
                    cwd=repo_path,
                    capture_output=True,
                    check=False
                )

            if branch:
                logger.info(f"Switching to branch {branch} and updating")
                subprocess.run(
                    ["git", "remote", "set-branches", "origin", branch],
                    cwd=repo_path,
                    capture_output=True,
                    check=False
                )
                subprocess.run(
                    ["git", "fetch", "--depth", "1", "origin", branch],
                    cwd=repo_path,
                    capture_output=True,
                    check=False
                )
                subprocess.run(
                    ["git", "checkout", "-f", branch],
                    cwd=repo_path,
                    capture_output=True,
                    check=False
                )
                subprocess.run(
                    ["git", "reset", "--hard", f"origin/{branch}"],
                    cwd=repo_path,
                    capture_output=True,
                    check=False
                )
            else:
                subprocess.run(
                    ["git", "pull"],
                    cwd=repo_path,
                    capture_output=True,
                    text=True,
                    check=False
                )

            logger.info(f"Starting gitnexus analyze for {repo_path}")
            # Use absolute path to gitnexus binary inside container
            gitnexus_bin = "/app/gitnexus/dist/gitnexus/src/cli/index.js"
            
            # EXPLICITLY pass proxy env vars to ensure fetch works in container runtime
            env = os.environ.copy()
            if os.getenv("https_proxy"):
                env["HTTPS_PROXY"] = os.getenv("https_proxy")
            if os.getenv("http_proxy"):
                env["HTTP_PROXY"] = os.getenv("http_proxy")
            
            # Use HF mirror to bypass proxy timeout issues for transformers.js
            env["HF_ENDPOINT"] = os.getenv("HF_ENDPOINT", "https://hf-mirror.com")
            
            # Explicitly set embedding model for Chinese support (bge-small-zh-v1.5)
            env["GITNEXUS_EMBEDDING_MODEL"] = os.getenv("GITNEXUS_EMBEDDING_MODEL", "Xenova/bge-small-zh-v1.5")
            env["GITNEXUS_EMBEDDING_DIMS"] = os.getenv("GITNEXUS_EMBEDDING_DIMS", "512")
            env["GITNEXUS_FTS_STEMMER"] = os.getenv("GITNEXUS_FTS_STEMMER", "none")
            env["GITNEXUS_EMBEDDING_LIMIT"] = os.getenv("GITNEXUS_EMBEDDING_LIMIT", "500000")
            env["GITNEXUS_REMOTE_DEPLOY"] = os.getenv("GITNEXUS_REMOTE_DEPLOY", "true")
            
            if os.getenv("GITNEXUS_EMBEDDING_DEVICE"):
                env["GITNEXUS_EMBEDDING_DEVICE"] = os.getenv("GITNEXUS_EMBEDDING_DEVICE")

            if os.getenv("GITNEXUS_EMBEDDING_URL"):
                env["GITNEXUS_EMBEDDING_URL"] = os.getenv("GITNEXUS_EMBEDDING_URL")
            
            # Add --force to ensure registry is updated even if repo is "Already up to date"
            result = subprocess.run(
                ["node", gitnexus_bin, "analyze", repo_path, "--embeddings", "--force"],
                capture_output=True,
                text=True,
                check=False,
                env=env
            )
            
            if result.stdout:
                logger.info(f"Analyze output: {result.stdout}")
            if result.stderr:
                logger.info(f"Analyze error/warning output: {result.stderr}")
            
            if result.returncode == 0:
                logger.info(f"Successfully indexed {repo_path}")
                # Fix permissions so non-root processes (serve/mcp) can write FTS indexes
                gitnexus_dir = os.path.join(repo_path, ".gitnexus")
                if os.path.isdir(gitnexus_dir):
                    subprocess.run(["chmod", "-R", "a+rw", gitnexus_dir], check=False)
                    subprocess.run(["chmod", "a+rwx", gitnexus_dir], check=False)
                return True
            else:
                logger.error(f"Failed to index {repo_path}. Exit code: {result.returncode}")
                return False
                
    except portalocker.exceptions.AlreadyLocked:
        logger.warning(f"Analyze for {repo_path} is already in progress.")
        return False
    except Exception as e:
        logger.error(f"Error during indexing for {repo_path}: {str(e)}")
        return False
    finally:
        # Cleanup lock file
        if os.path.exists(lock_file):
            try:
                os.remove(lock_file)
            except:
                pass
