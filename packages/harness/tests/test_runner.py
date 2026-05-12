from unittest.mock import patch, MagicMock
from pathlib import Path
from claude_harness.config import HarnessConfig
from claude_harness.runner import run_once


def make_config(tmp_path, status="pending"):
    config_file = tmp_path / "harness.yaml"
    config_file.write_text(
        f"project: t\nverify_cmd: pytest\nrequirements:\n"
        f"  - id: req-001\n    title: t\n    status: {status}\n"
    )
    return HarnessConfig.load(config_file)


def test_run_once_pass(tmp_path):
    config = make_config(tmp_path)
    with patch("claude_harness.runner.save_head", return_value="abc"):
        with patch("claude_harness.runner.invoke_claude"):
            with patch("claude_harness.runner.run_verify", return_value=True):
                with patch("claude_harness.runner.handle_pass") as mock_pass:
                    result = run_once(config, iter_n=1, cwd=tmp_path)
    assert result == "pass"
    mock_pass.assert_called_once()


def test_run_once_fail(tmp_path):
    config = make_config(tmp_path)
    with patch("claude_harness.runner.save_head", return_value="abc"):
        with patch("claude_harness.runner.invoke_claude"):
            with patch("claude_harness.runner.run_verify", return_value=False):
                with patch("claude_harness.runner.handle_fail") as mock_fail:
                    result = run_once(config, iter_n=1, cwd=tmp_path)
    assert result == "fail"
    mock_fail.assert_called_once()


def test_run_once_no_pending(tmp_path):
    config = make_config(tmp_path, status="done")
    result = run_once(config, iter_n=1, cwd=tmp_path)
    assert result == "done"


def test_run_once_emits_to_reporter(tmp_path):
    """reporter 가 ideation/build/verify/report phase 모두에 emit 받는지."""
    config = make_config(tmp_path)
    reporter = MagicMock()
    with patch("claude_harness.runner.save_head", return_value="abc"):
        with patch("claude_harness.runner.invoke_claude"):
            with patch("claude_harness.runner.run_verify", return_value=True):
                with patch("claude_harness.runner.handle_pass"):
                    run_once(config, iter_n=1, cwd=tmp_path, reporter=reporter)
    phases_emitted = [c.args[0] for c in reporter.emit.call_args_list]
    assert "ideation" in phases_emitted
    assert "build" in phases_emitted
    assert "verify" in phases_emitted
    assert "report" in phases_emitted
