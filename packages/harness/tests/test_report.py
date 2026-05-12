import yaml
from unittest.mock import patch, MagicMock
from pathlib import Path
from claude_harness.config import HarnessConfig
from claude_harness.phases.report import handle_pass, handle_fail


def make_config(tmp_path):
    config_file = tmp_path / "harness.yaml"
    config_file.write_text(
        "project: t\nverify_cmd: pytest\nrequirements:\n"
        "  - id: req-001\n    title: t\n    status: pending\n"
    )
    return HarnessConfig.load(config_file)


def test_handle_pass_updates_status(tmp_path):
    config = make_config(tmp_path)
    req = config.requirements[0]
    with patch("claude_harness.phases.report.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0)
        handle_pass(config, req, iter_n=1, cwd=tmp_path)
    updated = yaml.safe_load(config.path.read_text())
    assert updated["requirements"][0]["status"] == "done"


def test_handle_fail_resets_git(tmp_path):
    config = make_config(tmp_path)
    req = config.requirements[0]
    saved_head = "abc1234"
    with patch("claude_harness.phases.report.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0)
        handle_fail(config, req, saved_head=saved_head, cwd=tmp_path)
    calls = [str(c) for c in mock_run.call_args_list]
    assert any("reset" in c and "abc1234" in c for c in calls)
