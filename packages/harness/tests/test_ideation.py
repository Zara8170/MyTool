from claude_harness.config import HarnessConfig
from claude_harness.phases.ideation import select_next


def make_config(tmp_path, statuses):
    reqs = "\n".join(
        f"  - id: req-00{i+1}\n    title: req{i+1}\n    status: {s}"
        for i, s in enumerate(statuses)
    )
    config_file = tmp_path / "harness.yaml"
    config_file.write_text(f"project: t\nverify_cmd: pytest\nrequirements:\n{reqs}")
    return HarnessConfig.load(config_file)


def test_selects_first_pending(tmp_path):
    config = make_config(tmp_path, ["done", "pending", "pending"])
    req = select_next(config)
    assert req.id == "req-002"


def test_returns_none_when_all_done(tmp_path):
    config = make_config(tmp_path, ["done", "done"])
    assert select_next(config) is None
