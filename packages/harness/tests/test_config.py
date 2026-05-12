import pytest
import yaml
from pathlib import Path
from claude_harness.config import HarnessConfig, Requirement


def test_load_config(tmp_path):
    yaml_content = """
project: advisor
verify_cmd: "npm test"
requirements:
  - id: req-001
    title: "로그인 API"
    description: "JWT 기반 로그인"
    status: pending
  - id: req-002
    title: "대시보드"
    status: pending
"""
    config_file = tmp_path / "harness.yaml"
    config_file.write_text(yaml_content)

    config = HarnessConfig.load(config_file)

    assert config.project == "advisor"
    assert config.verify_cmd == "npm test"
    assert len(config.requirements) == 2
    assert config.requirements[0].id == "req-001"
    assert config.requirements[0].title == "로그인 API"
    assert config.requirements[0].status == "pending"


def test_next_pending(tmp_path):
    yaml_content = """
project: test
verify_cmd: "pytest"
requirements:
  - id: req-001
    title: "완료된 것"
    status: done
  - id: req-002
    title: "다음 것"
    status: pending
"""
    config_file = tmp_path / "harness.yaml"
    config_file.write_text(yaml_content)

    config = HarnessConfig.load(config_file)
    next_req = config.next_pending()

    assert next_req is not None
    assert next_req.id == "req-002"


def test_next_pending_none(tmp_path):
    yaml_content = """
project: test
verify_cmd: "pytest"
requirements:
  - id: req-001
    title: "완료됨"
    status: done
"""
    config_file = tmp_path / "harness.yaml"
    config_file.write_text(yaml_content)

    config = HarnessConfig.load(config_file)
    assert config.next_pending() is None
