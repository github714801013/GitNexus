import pytest
from fastapi.testclient import TestClient
import os
import json
import asyncio
from mcp_proxy_docker.app.main import app
from mcp_proxy_docker.app import main

client = TestClient(app)

def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"

def test_webhook_trust_mode_success(tmp_path):
    """
    In Trust Mode, signatures are not required. 
    The webhook should accept requests and queue indexing even if path is missing (it will clone).
    """
    os.environ["PROJECTS_ROOT"] = str(tmp_path)
    
    payload = {
        "repository": {
            "full_name": "test/new-repo",
            "clone_url": "https://gitea.example.com/test/new-repo.git"
        }
    }
    
    response = client.post(
        "/webhook/gitea",
        json=payload
    )
    
    assert response.status_code == 200
    assert response.json()["status"] == "accepted"
    assert response.json()["repository"] == "test/new-repo"
    assert "test/new-repo" in response.json()["path"]

def test_webhook_missing_repo_name():
    payload = {"repository": {"other": "data"}}
    response = client.post(
        "/webhook/gitea",
        json=payload
    )
    assert response.status_code == 400

def test_warmup_extensions_installs_before_loading(monkeypatch):
    captured = {}

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        return type("Result", (), {"returncode": 0, "stdout": "", "stderr": ""})()

    monkeypatch.setattr(main.subprocess, "run", fake_run)

    assert asyncio.run(main.warmup_extensions()) is True

    script = captured["cmd"][3]
    assert script.index("INSTALL fts") < script.index("LOAD EXTENSION fts")
    assert script.index("INSTALL vector") < script.index("LOAD EXTENSION vector")


def test_deferred_analyze_waits_for_embedding_before_retrying(monkeypatch, tmp_path):
    repo = tmp_path / "repo"
    calls = []
    embedding_running = True

    def fake_run_analyze(repo_path, clone_url=None, branch=None):
        calls.append((repo_path, clone_url, branch))
        return main.DEFER_ANALYZE if len(calls) == 1 else True

    monkeypatch.setattr(main, "run_analyze", fake_run_analyze)
    monkeypatch.setattr(main, "get_deferred_retry_delay", lambda: 0)
    monkeypatch.setattr(main, "_embedding_phase_is_running", lambda _repo: embedding_running, raising=False)

    async def scenario():
        main._queued_repo_paths.clear()
        main._pending_repo_requests.clear()

        await main.run_guarded_analyze(str(repo), "https://example.com/repo.git", "main")
        await asyncio.sleep(0.05)

        assert len(calls) == 1

        nonlocal embedding_running
        embedding_running = False
        await asyncio.sleep(0.05)

        assert len(calls) == 2

    asyncio.run(scenario())


def test_pending_duplicate_waits_when_embedding_started_after_success(monkeypatch, tmp_path):
    repo = tmp_path / "repo"
    repo_key = os.path.abspath(str(repo))
    calls = []
    embedding_running = True

    def fake_run_analyze(repo_path, clone_url=None, branch=None):
        calls.append((repo_path, clone_url, branch))
        return True

    monkeypatch.setattr(main, "run_analyze", fake_run_analyze)
    monkeypatch.setattr(main, "get_deferred_retry_delay", lambda: 0)
    monkeypatch.setattr(main, "_embedding_phase_is_running", lambda _repo: embedding_running)

    async def scenario():
        main._queued_repo_paths.clear()
        main._pending_repo_requests.clear()
        main._queued_repo_paths.add(repo_key)
        main._pending_repo_requests[repo_key] = (str(repo), "https://example.com/repo.git", "main")

        await main.run_guarded_analyze(str(repo), "https://example.com/repo.git", "main", repo_key)
        await asyncio.sleep(0.05)

        assert len(calls) == 1

        nonlocal embedding_running
        embedding_running = False
        await asyncio.sleep(0.05)

        assert len(calls) == 2

    asyncio.run(scenario())
