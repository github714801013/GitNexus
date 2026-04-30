import logging
import os
import subprocess
import sys

import portalocker

logger = logging.getLogger("mcp_proxy.embedding_phase")


def _remove_pid_file(repo_path: str):
    try:
        os.remove(os.path.join(repo_path, ".gitnexus", "embedding.pid"))
    except FileNotFoundError:
        pass


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
    if len(sys.argv) != 3:
        logger.error("Usage: python -m app.embedding_phase <repo_path> <gitnexus_bin>")
        return 2

    repo_path = sys.argv[1]
    gitnexus_bin = sys.argv[2]
    lock_file = os.path.join(repo_path, ".gitnexus_embedding.lock")

    try:
        with portalocker.Lock(lock_file, timeout=0):
            logger.info("Starting GitNexus embedding phase for %s", repo_path)
            result = subprocess.run(
                ["node", gitnexus_bin, "analyze", repo_path, "--embeddings-only", "--skip-agents-md"],
                capture_output=True,
                text=True,
                check=False,
                env=os.environ.copy(),
            )
            if result.stdout:
                logger.info("Embedding phase output for %s: %s", repo_path, result.stdout)
            if result.stderr:
                logger.info("Embedding phase warning output for %s: %s", repo_path, result.stderr)
            if result.returncode == 0:
                logger.info("Embedding phase finished for %s", repo_path)
            else:
                logger.error("Embedding phase failed for %s. Exit code: %s", repo_path, result.returncode)
            return result.returncode
    except portalocker.exceptions.AlreadyLocked:
        logger.info("Embedding phase already running for %s", repo_path)
        return 0
    finally:
        _remove_pid_file(repo_path)


if __name__ == "__main__":
    raise SystemExit(main())
