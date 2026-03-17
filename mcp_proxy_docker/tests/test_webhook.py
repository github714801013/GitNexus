import pytest
from fastapi.testclient import TestClient
import os
import json
from mcp_proxy_docker.app.main import app

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
