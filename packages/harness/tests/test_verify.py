from unittest.mock import patch, MagicMock
from pathlib import Path
from claude_harness.phases.verify import run_verify


def test_verify_pass(tmp_path):
    with patch("claude_harness.phases.verify.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0)
        result = run_verify("npm test", cwd=tmp_path)
    assert result is True


def test_verify_fail(tmp_path):
    with patch("claude_harness.phases.verify.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=1)
        result = run_verify("npm test", cwd=tmp_path)
    assert result is False
