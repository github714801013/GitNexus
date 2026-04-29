import json
from types import SimpleNamespace

from mcp_proxy_docker.app import executor


def test_run_analyze_runs_structure_first_then_starts_embedding_phase(monkeypatch, tmp_path):
    repo = tmp_path / "repo"
    git_dir = repo / ".git"
    gitnexus_dir = repo / ".gitnexus"
    git_dir.mkdir(parents=True)
    gitnexus_dir.mkdir()
    (gitnexus_dir / "meta.json").write_text(
        json.dumps({"lastCommit": "old", "stats": {"embeddings": 0}}),
        encoding="utf-8",
    )

    commands = []
    started_embedding = []

    def fake_run(cmd, **kwargs):
        commands.append(cmd)
        if cmd[:2] == ["git", "rev-parse"]:
            return SimpleNamespace(returncode=0, stdout="new\n", stderr="")
        if cmd[:2] == ["node", executor.GITNEXUS_BIN] and "analyze" in cmd:
            return SimpleNamespace(returncode=0, stdout="indexed", stderr="")
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(executor.subprocess, "run", fake_run)
    monkeypatch.setattr(executor, "_probe_lbug", lambda _path, _env: (True, ""))
    monkeypatch.setattr(executor, "_start_embedding_phase", lambda *args: started_embedding.append(args))

    assert executor.run_analyze(str(repo), branch="main") is True

    analyze_commands = [cmd for cmd in commands if cmd[:2] == ["node", executor.GITNEXUS_BIN] and "analyze" in cmd]
    assert analyze_commands == [["node", executor.GITNEXUS_BIN, "analyze", str(repo)]]
    assert started_embedding


def test_run_analyze_does_not_start_embedding_phase_when_structure_fails(monkeypatch, tmp_path):
    repo = tmp_path / "repo"
    (repo / ".git").mkdir(parents=True)
    (repo / ".gitnexus").mkdir()

    started_embedding = []

    def fake_run(cmd, **kwargs):
        if cmd[:2] == ["git", "rev-parse"]:
            return SimpleNamespace(returncode=0, stdout="new\n", stderr="")
        if cmd[:2] == ["node", executor.GITNEXUS_BIN] and "analyze" in cmd:
            return SimpleNamespace(returncode=1, stdout="", stderr="boom")
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(executor.subprocess, "run", fake_run)
    monkeypatch.setattr(executor, "_restore_latest_backup", lambda *_args: (False, "no backup"))
    monkeypatch.setattr(executor, "_start_embedding_phase", lambda *args: started_embedding.append(args))

    assert executor.run_analyze(str(repo), branch="main") is False
    assert started_embedding == []


def test_embedding_phase_marker_blocks_duplicate_running_process(monkeypatch, tmp_path):
    repo = tmp_path / "repo"
    gitnexus_dir = repo / ".gitnexus"
    gitnexus_dir.mkdir(parents=True)
    (gitnexus_dir / "embedding.pid").write_text("123", encoding="utf-8")
    monkeypatch.setattr(executor, "_process_is_running", lambda pid: pid == 123)

    assert executor._try_mark_embedding_phase(str(repo)) is False


def test_embedding_phase_marker_replaces_stale_pid(monkeypatch, tmp_path):
    repo = tmp_path / "repo"
    gitnexus_dir = repo / ".gitnexus"
    gitnexus_dir.mkdir(parents=True)
    pid_file = gitnexus_dir / "embedding.pid"
    pid_file.write_text("123", encoding="utf-8")
    monkeypatch.setattr(executor, "_process_is_running", lambda _pid: False)

    assert executor._try_mark_embedding_phase(str(repo)) is True
    assert pid_file.read_text(encoding="utf-8")
