import subprocess
import os
import portalocker
import logging
from typing import Optional

logger = logging.getLogger("mcp_proxy.executor")

def run_analyze(repo_path: str, git_url: Optional[str] = None):
    """
    Ensures the repository exists (clone if not), pulls latest changes, 
    and runs 'npx gitnexus analyze'.
    """
    
    # 1. Handle cloning if repository doesn't exist
    if not os.path.isdir(repo_path):
        if not git_url:
            logger.error(f"Repository path {repo_path} does not exist and no git_url provided for cloning.")
            return False
        
        try:
            logger.info(f"Cloning {git_url} into {repo_path}")
            # Ensure parent directory exists
            os.makedirs(os.path.dirname(repo_path), exist_ok=True)
            result = subprocess.run(
                ["git", "clone", git_url, repo_path],
                capture_output=True,
                text=True,
                check=False
            )
            if result.returncode != 0:
                logger.error(f"Failed to clone {git_url}: {result.stderr}")
                return False
        except Exception as e:
            logger.error(f"Error during cloning of {git_url}: {str(e)}")
            return False

    # 2. Proceed with Update and Analyze using a Lock
    lock_file = os.path.join(repo_path, ".gitnexus_analyze.lock")
    
    try:
        with portalocker.Lock(lock_file, timeout=60):
            # Ensure the latest code is pulled before indexing
            logger.info(f"Updating latest changes for {repo_path}")
            subprocess.run(
                ["git", "pull"],
                cwd=repo_path,
                capture_output=True,
                text=True,
                check=False
            )

            logger.info(f"Starting gitnexus analyze for {repo_path}")
            # Ensure npx gitnexus analyze is run in the repository directory
            result = subprocess.run(
                ["npx", "gitnexus", "analyze"],
                cwd=repo_path,
                capture_output=True,
                text=True,
                check=False
            )
            
            if result.returncode == 0:
                logger.info(f"Successfully indexed {repo_path}")
                return True
            else:
                logger.error(f"Failed to index {repo_path}: {result.stderr}")
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
