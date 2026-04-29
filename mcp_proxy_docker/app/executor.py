import subprocess
import os
import json
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

    # 2. Proceed with Update and Analyze using a per-repo Lock
    # Use per-repo lock to prevent concurrent analysis of the same repository
    lock_file = os.path.join(repo_path, ".gitnexus_analyze.lock")

    try:
        # Acquire per-repo lock
        with portalocker.Lock(lock_file, timeout=60):
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

            # Force fetch and overwrite local code to ensure consistency
            subprocess.run(["git", "fetch", "origin", "--depth", "1"], cwd=repo_path, capture_output=True, check=False)
            
            if not branch:
                # Try to detect default branch if not provided
                res = subprocess.run(["git", "remote", "show", "origin"], cwd=repo_path, capture_output=True, text=True, check=False)
                for line in res.stdout.splitlines():
                    if "HEAD branch" in line:
                        branch = line.split(":")[-1].strip()
                        break
                if not branch:
                    branch = "main" # Final fallback

            logger.info(f"Forcing remote overwrite to origin/{branch}")
            subprocess.run(["git", "checkout", "-f", branch], cwd=repo_path, capture_output=True, check=False)
            subprocess.run(["git", "reset", "--hard", f"origin/{branch}"], cwd=repo_path, capture_output=True, check=False)
            subprocess.run(["git", "clean", "-fd", "-e", ".gitnexus", "-e", ".gitnexus/"], cwd=repo_path, capture_output=True, check=False)

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

            # Explicitly set embedding model for Chinese support (gte-Qwen2-1.5B-instruct ONNX)
            env["GITNEXUS_EMBEDDING_MODEL"] = os.getenv("GITNEXUS_EMBEDDING_MODEL", "twright8/gte-Qwen2-1.5B-instruct-onnx-fp16")
            env["GITNEXUS_EMBEDDING_DIMS"] = os.getenv("GITNEXUS_EMBEDDING_DIMS", "1536")
            env["GITNEXUS_USE_FLASH_ATTENTION"] = os.getenv("GITNEXUS_USE_FLASH_ATTENTION", "true")
            env["GITNEXUS_FTS_STEMMER"] = os.getenv("GITNEXUS_FTS_STEMMER", "none")
            env["GITNEXUS_EMBEDDING_LIMIT"] = os.getenv("GITNEXUS_EMBEDDING_LIMIT", "500000")
            env["GITNEXUS_REMOTE_DEPLOY"] = os.getenv("GITNEXUS_REMOTE_DEPLOY", "true")
            env["GITNEXUS_EMBEDDING_BATCH_SIZE"] = os.getenv("GITNEXUS_EMBEDDING_BATCH_SIZE", "32")
            env["GITNEXUS_ALLOW_REMOTE_MODELS"] = os.getenv("GITNEXUS_ALLOW_REMOTE_MODELS", "false")

            if os.getenv("GITNEXUS_EMBEDDING_DEVICE"):
                env["GITNEXUS_EMBEDDING_DEVICE"] = os.getenv("GITNEXUS_EMBEDDING_DEVICE")

            # Use dedicated indexing vLLM instance if provided, else fallback to main URL
            index_url = os.getenv("GITNEXUS_INDEX_EMBEDDING_URL", os.getenv("GITNEXUS_EMBEDDING_URL"))
            if index_url:
                env["GITNEXUS_EMBEDDING_URL"] = index_url

            if os.getenv("GITNEXUS_EMBEDDING_API_KEY"):                env["GITNEXUS_EMBEDDING_API_KEY"] = os.getenv("GITNEXUS_EMBEDDING_API_KEY")

            # Skip analyze if already indexed at the current commit
            current_commit_res = subprocess.run(
                ["git", "rev-parse", "HEAD"], cwd=repo_path, capture_output=True, text=True, check=False
            )
            current_commit = current_commit_res.stdout.strip()
            meta_path = os.path.join(repo_path, ".gitnexus", "meta.json")
            lbug_path = os.path.join(repo_path, ".gitnexus", "lbug")
            shadow_wal = os.path.join(repo_path, ".gitnexus", "lbug.shadow.wal")
            if current_commit and os.path.exists(meta_path):
                try:
                    with open(meta_path, "r") as f:
                        meta = json.load(f)
                    if meta.get("lastCommit") == current_commit:
                        # Also verify lbug is intact: must exist, be non-empty, and have no
                        # leftover shadow.wal (sign of an interrupted atomic swap).
                        lbug_ok = os.path.exists(lbug_path) and os.path.getsize(lbug_path) > 0
                        shadow_leftover = os.path.exists(shadow_wal)
                        if lbug_ok and not shadow_leftover:
                            logger.info(f"Skipping analyze for {repo_path}: already indexed at {current_commit[:8]}")
                            gitnexus_bin = "/app/gitnexus/dist/gitnexus/src/cli/index.js"
                            register_result = subprocess.run(
                                ["node", gitnexus_bin, "index", repo_path],
                                capture_output=True,
                                text=True,
                                check=False,
                                env=env,
                            )
                            if register_result.returncode != 0:
                                logger.warning(f"Failed to refresh registry for {repo_path}; re-indexing.")
                            else:
                                return True
                        else:
                            logger.warning(f"Index integrity check failed for {repo_path}: lbug_ok={lbug_ok}, shadow_leftover={shadow_leftover}. Re-indexing.")
                except Exception:
                    pass

            logger.info(f"Starting gitnexus analyze for {repo_path}")
            # Incremental indexing: gitnexus analyze handles updates automatically
            result = subprocess.run(
                ["node", gitnexus_bin, "analyze", repo_path, "--embeddings"],
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
