from unittest.mock import patch, MagicMock
from pathlib import Path
from claude_harness.config import Requirement
from claude_harness.phases.build import save_head, invoke_claude


def test_save_head(tmp_path):
    with patch("claude_harness.phases.build.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(stdout="abc1234\n", returncode=0)
        head = save_head(tmp_path)
    assert head == "abc1234"


def test_invoke_claude(tmp_path):
    req = Requirement(id="req-001", title="로그인 API", status="pending", description="JWT 기반")
    with patch("claude_harness.phases.build.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0)
        invoke_claude(req, cwd=tmp_path)
    call_args = mock_run.call_args
    cmd = call_args[0][0]
    assert "claude" in cmd[0]
    assert "--dangerously-skip-permissions" in cmd
    assert "로그인 API" in " ".join(str(c) for c in cmd)
