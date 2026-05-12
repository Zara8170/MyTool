import yaml
from pathlib import Path
from claude_harness.config import HarnessConfig
from claude_harness.state import update_status


def make_config(tmp_path, status="pending"):
    yaml_content = f"project: test\nverify_cmd: pytest\nrequirements:\n  - id: req-001\n    title: test\n    status: {status}\n"
    config_file = tmp_path / "harness.yaml"
    config_file.write_text(yaml_content)
    return HarnessConfig.load(config_file)


def test_update_status_to_done(tmp_path):
    config = make_config(tmp_path, "pending")
    req = config.requirements[0]
    update_status(config, req, "done")
    updated = yaml.safe_load(config.path.read_text())
    assert updated["requirements"][0]["status"] == "done"


def test_update_status_to_failed(tmp_path):
    config = make_config(tmp_path, "pending")
    req = config.requirements[0]
    update_status(config, req, "failed")
    updated = yaml.safe_load(config.path.read_text())
    assert updated["requirements"][0]["status"] == "failed"
