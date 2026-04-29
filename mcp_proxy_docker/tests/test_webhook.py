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
