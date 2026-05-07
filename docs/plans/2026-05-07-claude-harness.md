# claude-harness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 어떤 프로젝트에도 붙일 수 있는 재사용 가능한 자율 개발 하네스 pip 패키지를 만든다.

**Architecture:** `harness.yaml`에 요구사항 목록을 작성하면 하네스가 Ideation → Build → Verify → Report 사이클을 반복한다. Build 단계에서 `claude -p` CLI로 구현을 요청하고, Verify 단계에서 `verify_cmd`를 실행해 pass/fail을 판정한다. fail이면 `git reset --hard`로 롤백한다.

**Tech Stack:** Python 3.11+, click (CLI), pyyaml (YAML), pytest (테스트), subprocess (외부 명령 실행)

**Repo 위치:** `c:\git\personal\claude-harness` (mytool과 별개의 독립 레포)

---

### Task 1: 레포 및 패키지 구조 생성

**Files:**
- Create: `c:\git\personal\claude-harness\pyproject.toml`
- Create: `c:\git\personal\claude-harness\claude_harness\__init__.py`
- Create: `c:\git\personal\claude-harness\claude_harness\phases\__init__.py`
- Create: `c:\git\personal\claude-harness\tests\__init__.py`

**Step 1: 디렉터리 생성 및 git 초기화**

```bash
mkdir -p c:\git\personal\claude-harness
cd c:\git\personal\claude-harness
git init
mkdir -p claude_harness/phases tests
```

**Step 2: `pyproject.toml` 작성**

```toml
[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.backends.legacy:build"

[project]
name = "claude-harness"
version = "0.1.0"
description = "Autonomous development harness powered by Claude Code"
requires-python = ">=3.11"
dependencies = [
    "click>=8.0",
    "pyyaml>=6.0",
]

[project.scripts]
harness = "claude_harness.cli:main"

[tool.pytest.ini_options]
testpaths = ["tests"]
```

**Step 3: 빈 `__init__.py` 파일 생성**

```bash
touch claude_harness/__init__.py
touch claude_harness/phases/__init__.py
touch tests/__init__.py
```

**Step 4: pip editable 설치**

```bash
pip install -e .
```

Expected: `Successfully installed claude-harness-0.1.0`

**Step 5: 커밋**

```bash
git add .
git commit -m "chore: initial package structure"
```

---

### Task 2: Config 파서 (`config.py`)

**Files:**
- Create: `claude_harness/config.py`
- Create: `tests/test_config.py`

**Step 1: 실패하는 테스트 작성**

```python
# tests/test_config.py
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
```

**Step 2: 테스트 실패 확인**

```bash
pytest tests/test_config.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'claude_harness.config'`

**Step 3: 구현**

```python
# claude_harness/config.py
from __future__ import annotations
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional
import yaml


@dataclass
class Requirement:
    id: str
    title: str
    status: str  # pending | in_progress | done | failed
    description: str = ""


@dataclass
class HarnessConfig:
    project: str
    verify_cmd: str
    requirements: list[Requirement]
    path: Path = field(repr=False)

    @classmethod
    def load(cls, path: Path) -> HarnessConfig:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        requirements = [
            Requirement(
                id=r["id"],
                title=r["title"],
                status=r.get("status", "pending"),
                description=r.get("description", ""),
            )
            for r in data.get("requirements", [])
        ]
        return cls(
            project=data["project"],
            verify_cmd=data["verify_cmd"],
            requirements=requirements,
            path=path,
        )

    def next_pending(self) -> Optional[Requirement]:
        return next(
            (r for r in self.requirements if r.status == "pending"), None
        )
```

**Step 4: 테스트 통과 확인**

```bash
pytest tests/test_config.py -v
```

Expected: 3 passed

**Step 5: 커밋**

```bash
git add claude_harness/config.py tests/test_config.py
git commit -m "feat: config parser for harness.yaml"
```

---

### Task 3: State 매니저 (`state.py`)

**Files:**
- Create: `claude_harness/state.py`
- Create: `tests/test_state.py`

**Step 1: 실패하는 테스트 작성**

```python
# tests/test_state.py
import yaml
from pathlib import Path
from claude_harness.config import HarnessConfig
from claude_harness.state import update_status

def make_config(tmp_path, status="pending"):
    yaml_content = f"""
project: test
verify_cmd: "pytest"
requirements:
  - id: req-001
    title: "테스트 요구사항"
    status: {status}
"""
    config_file = tmp_path / "harness.yaml"
    config_file.write_text(yaml_content)
    return HarnessConfig.load(config_file)

def test_update_status_to_done(tmp_path):
    config = make_config(tmp_path, "pending")
    req = config.requirements[0]

    update_status(config, req, "done")

    # 파일 다시 읽어서 확인
    updated = yaml.safe_load(config.path.read_text())
    assert updated["requirements"][0]["status"] == "done"

def test_update_status_to_failed(tmp_path):
    config = make_config(tmp_path, "pending")
    req = config.requirements[0]

    update_status(config, req, "failed")

    updated = yaml.safe_load(config.path.read_text())
    assert updated["requirements"][0]["status"] == "failed"
```

**Step 2: 테스트 실패 확인**

```bash
pytest tests/test_state.py -v
```

Expected: FAIL

**Step 3: 구현**

```python
# claude_harness/state.py
import yaml
from claude_harness.config import HarnessConfig, Requirement


def update_status(config: HarnessConfig, req: Requirement, status: str) -> None:
    data = yaml.safe_load(config.path.read_text(encoding="utf-8"))
    for r in data["requirements"]:
        if r["id"] == req.id:
            r["status"] = status
            break
    config.path.write_text(
        yaml.dump(data, allow_unicode=True, default_flow_style=False),
        encoding="utf-8",
    )
```

**Step 4: 테스트 통과 확인**

```bash
pytest tests/test_state.py -v
```

Expected: 2 passed

**Step 5: 커밋**

```bash
git add claude_harness/state.py tests/test_state.py
git commit -m "feat: state manager for requirement status updates"
```

---

### Task 4: Ideation 페이즈 (`phases/ideation.py`)

**Files:**
- Create: `claude_harness/phases/ideation.py`
- Create: `tests/test_ideation.py`

**Step 1: 실패하는 테스트 작성**

```python
# tests/test_ideation.py
from pathlib import Path
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
```

**Step 2: 테스트 실패 확인**

```bash
pytest tests/test_ideation.py -v
```

**Step 3: 구현**

```python
# claude_harness/phases/ideation.py
from typing import Optional
from claude_harness.config import HarnessConfig, Requirement


def select_next(config: HarnessConfig) -> Optional[Requirement]:
    return config.next_pending()
```

**Step 4: 테스트 통과 확인**

```bash
pytest tests/test_ideation.py -v
```

Expected: 2 passed

**Step 5: 커밋**

```bash
git add claude_harness/phases/ideation.py tests/test_ideation.py
git commit -m "feat: ideation phase - select next pending requirement"
```

---

### Task 5: Build 페이즈 (`phases/build.py`)

**Files:**
- Create: `claude_harness/phases/build.py`
- Create: `tests/test_build.py`

**Step 1: 실패하는 테스트 작성**

```python
# tests/test_build.py
import subprocess
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
    req = Requirement(id="req-001", title="로그인 API", status="pending",
                      description="JWT 기반")
    with patch("claude_harness.phases.build.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0)
        invoke_claude(req, cwd=tmp_path)

    call_args = mock_run.call_args
    cmd = call_args[0][0]
    assert "claude" in cmd[0]
    assert "--dangerously-skip-permissions" in cmd
    assert "로그인 API" in " ".join(cmd)
```

**Step 2: 테스트 실패 확인**

```bash
pytest tests/test_build.py -v
```

**Step 3: 구현**

```python
# claude_harness/phases/build.py
import subprocess
from pathlib import Path
from claude_harness.config import Requirement


def save_head(cwd: Path) -> str:
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=cwd, capture_output=True, text=True, check=True
    )
    return result.stdout.strip()


def invoke_claude(req: Requirement, cwd: Path) -> None:
    prompt = (
        f"다음 요구사항을 이 프로젝트에 구현해줘.\n\n"
        f"제목: {req.title}\n"
        f"설명: {req.description or '(없음)'}\n\n"
        f"구현이 완료되면 관련 테스트도 작성해줘."
    )
    subprocess.run(
        ["claude", "-p", prompt, "--dangerously-skip-permissions"],
        cwd=cwd,
        check=False,  # claude 실패해도 verify 단계에서 판정
    )
```

**Step 4: 테스트 통과 확인**

```bash
pytest tests/test_build.py -v
```

Expected: 2 passed

**Step 5: 커밋**

```bash
git add claude_harness/phases/build.py tests/test_build.py
git commit -m "feat: build phase - save git HEAD and invoke claude CLI"
```

---

### Task 6: Verify 페이즈 (`phases/verify.py`)

**Files:**
- Create: `claude_harness/phases/verify.py`
- Create: `tests/test_verify.py`

**Step 1: 실패하는 테스트 작성**

```python
# tests/test_verify.py
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
```

**Step 2: 테스트 실패 확인**

```bash
pytest tests/test_verify.py -v
```

**Step 3: 구현**

```python
# claude_harness/phases/verify.py
import subprocess
from pathlib import Path


def run_verify(verify_cmd: str, cwd: Path) -> bool:
    result = subprocess.run(
        verify_cmd,
        shell=True,
        cwd=cwd,
    )
    return result.returncode == 0
```

**Step 4: 테스트 통과 확인**

```bash
pytest tests/test_verify.py -v
```

Expected: 2 passed

**Step 5: 커밋**

```bash
git add claude_harness/phases/verify.py tests/test_verify.py
git commit -m "feat: verify phase - run verify_cmd and return pass/fail"
```

---

### Task 7: Report 페이즈 (`phases/report.py`)

**Files:**
- Create: `claude_harness/phases/report.py`
- Create: `tests/test_report.py`

**Step 1: 실패하는 테스트 작성**

```python
# tests/test_report.py
import time
from unittest.mock import patch, MagicMock
from pathlib import Path
from claude_harness.config import HarnessConfig, Requirement
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

    import yaml
    updated = yaml.safe_load(config.path.read_text())
    assert updated["requirements"][0]["status"] == "done"

def test_handle_fail_resets_git(tmp_path):
    config = make_config(tmp_path)
    req = config.requirements[0]
    saved_head = "abc1234"

    with patch("claude_harness.phases.report.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0)
        handle_fail(config, req, saved_head=saved_head, cwd=tmp_path)

    # git reset --hard가 호출됐는지 확인
    calls = [str(c) for c in mock_run.call_args_list]
    assert any("reset" in c and "abc1234" in c for c in calls)
```

**Step 2: 테스트 실패 확인**

```bash
pytest tests/test_report.py -v
```

**Step 3: 구현**

```python
# claude_harness/phases/report.py
import subprocess
import time
from pathlib import Path
from claude_harness.config import HarnessConfig, Requirement
from claude_harness.state import update_status


def handle_pass(config: HarnessConfig, req: Requirement, iter_n: int, cwd: Path) -> None:
    update_status(config, req, "done")
    iter_id = f"{iter_n}-{int(time.time())}"
    subprocess.run(
        ["git", "add", "-A"],
        cwd=cwd, check=False
    )
    subprocess.run(
        ["git", "commit", "-m",
         f"feat: implement {req.id} - {req.title}\n\niter-id: {iter_id}"],
        cwd=cwd, check=False
    )
    print(f"[PASS] {req.id}: {req.title} (iter-id: {iter_id})")


def handle_fail(config: HarnessConfig, req: Requirement, saved_head: str, cwd: Path) -> None:
    subprocess.run(
        ["git", "reset", "--hard", saved_head],
        cwd=cwd, check=False
    )
    update_status(config, req, "failed")
    print(f"[FAIL] {req.id}: {req.title} — rolled back to {saved_head}")
```

**Step 4: 테스트 통과 확인**

```bash
pytest tests/test_report.py -v
```

Expected: 2 passed

**Step 5: 커밋**

```bash
git add claude_harness/phases/report.py tests/test_report.py
git commit -m "feat: report phase - handle pass/fail with git commit or reset"
```

---

### Task 8: 메인 이터레이션 루프 (`runner.py`)

**Files:**
- Create: `claude_harness/runner.py`
- Create: `tests/test_runner.py`

**Step 1: 실패하는 테스트 작성**

```python
# tests/test_runner.py
from unittest.mock import patch, MagicMock
from pathlib import Path
from claude_harness.config import HarnessConfig, Requirement
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
```

**Step 2: 테스트 실패 확인**

```bash
pytest tests/test_runner.py -v
```

**Step 3: 구현**

```python
# claude_harness/runner.py
import time
from pathlib import Path
from claude_harness.config import HarnessConfig
from claude_harness.phases.ideation import select_next
from claude_harness.phases.build import save_head, invoke_claude
from claude_harness.phases.verify import run_verify
from claude_harness.phases.report import handle_pass, handle_fail

SLEEP_BETWEEN_ITERATIONS = 10


def run_once(config: HarnessConfig, iter_n: int, cwd: Path) -> str:
    req = select_next(config)
    if req is None:
        return "done"

    print(f"\n[Iteration {iter_n}] Building: {req.id} - {req.title}")
    head = save_head(cwd)
    invoke_claude(req, cwd)
    passed = run_verify(config.verify_cmd, cwd)

    if passed:
        handle_pass(config, req, iter_n=iter_n, cwd=cwd)
        return "pass"
    else:
        handle_fail(config, req, saved_head=head, cwd=cwd)
        return "fail"


def run_loop(config: HarnessConfig, cwd: Path) -> None:
    iter_n = 1
    print(f"[harness] Starting autonomous loop for project: {config.project}")
    while True:
        result = run_once(config, iter_n=iter_n, cwd=cwd)
        if result == "done":
            print("[harness] All requirements complete.")
            break
        iter_n += 1
        time.sleep(SLEEP_BETWEEN_ITERATIONS)
```

**Step 4: 테스트 통과 확인**

```bash
pytest tests/test_runner.py -v
```

Expected: 3 passed

**Step 5: 전체 테스트 확인**

```bash
pytest -v
```

Expected: 모든 테스트 통과

**Step 6: 커밋**

```bash
git add claude_harness/runner.py tests/test_runner.py
git commit -m "feat: main iteration loop"
```

---

### Task 9: CLI (`cli.py`)

**Files:**
- Create: `claude_harness/cli.py`
- Create: `tests/test_cli.py`

**Step 1: 실패하는 테스트 작성**

```python
# tests/test_cli.py
from click.testing import CliRunner
from pathlib import Path
from claude_harness.cli import main

def test_init_creates_harness_yaml(tmp_path):
    runner = CliRunner()
    with runner.isolated_filesystem(temp_dir=tmp_path):
        result = runner.invoke(main, ["init"])
    assert result.exit_code == 0
    assert (Path(runner.isolated_filesystem.__self__ if hasattr(runner.isolated_filesystem, '__self__') else tmp_path) / "harness.yaml").exists() or "harness.yaml" in result.output

def test_init_creates_file(tmp_path):
    runner = CliRunner()
    result = runner.invoke(main, ["init"], catch_exceptions=False)
    # tmp_path가 아닌 현재 디렉터리에 생성되므로 출력으로 확인
    assert result.exit_code == 0
    assert "harness.yaml" in result.output
```

**Step 2: 테스트 실패 확인**

```bash
pytest tests/test_cli.py -v
```

**Step 3: 구현**

```python
# claude_harness/cli.py
import click
from pathlib import Path
from claude_harness.config import HarnessConfig
from claude_harness.runner import run_loop

HARNESS_TEMPLATE = """\
project: my-project
verify_cmd: "npm run build && npm test"

requirements:
  - id: req-001
    title: "첫 번째 요구사항"
    description: "상세 설명을 여기에"
    status: pending
  - id: req-002
    title: "두 번째 요구사항"
    status: pending
"""


@click.group()
def main():
    pass


@main.command()
def init():
    target = Path.cwd() / "harness.yaml"
    if target.exists():
        click.echo("harness.yaml already exists. Skipping.")
        return
    target.write_text(HARNESS_TEMPLATE, encoding="utf-8")
    click.echo(f"Created harness.yaml at {target}")
    click.echo("Edit requirements, then run: harness run")


@main.command()
@click.option("--config", default="harness.yaml", help="Path to harness.yaml")
def run(config):
    config_path = Path(config)
    if not config_path.exists():
        click.echo(f"Error: {config} not found. Run 'harness init' first.", err=True)
        raise SystemExit(1)
    harness_config = HarnessConfig.load(config_path)
    run_loop(harness_config, cwd=Path.cwd())
```

**Step 4: 테스트 통과 확인**

```bash
pytest tests/test_cli.py -v
```

**Step 5: `harness` 커맨드 동작 확인**

```bash
harness --help
harness init --help
harness run --help
```

**Step 6: 전체 테스트 + 커밋**

```bash
pytest -v
git add claude_harness/cli.py tests/test_cli.py
git commit -m "feat: CLI - harness init and harness run commands"
```

---

### Task 10: README 작성 및 마무리

**Files:**
- Create: `README.md`

**Step 1: README 작성**

```markdown
# claude-harness

Claude Code로 구동되는 자율 개발 하네스.

## 설치

```bash
pip install -e ~/tools/claude-harness
```

## 사용법

```bash
# 프로젝트에서 초기화
cd ~/projects/my-project
harness init

# harness.yaml에 요구사항 작성 후 실행
harness run
```

## harness.yaml 예시

```yaml
project: my-project
verify_cmd: "npm run build && npm test"

requirements:
  - id: req-001
    title: "사용자 로그인 API"
    description: "JWT 기반 로그인 엔드포인트"
    status: pending
```

## 이터레이션 사이클

1. **Ideation** — pending 요구사항 선택
2. **Build** — claude -p로 구현 요청
3. **Verify** — verify_cmd 실행
4. **Report** — pass: commit / fail: git reset
```

**Step 2: 커밋**

```bash
git add README.md
git commit -m "docs: add README"
```

**Step 3: 최종 전체 테스트**

```bash
pytest -v
```

Expected: 모든 테스트 통과

---

## 적용 방법 (다른 프로젝트에서)

```bash
# 1. 설치
pip install -e c:\git\personal\claude-harness

# 2. 대상 프로젝트에서
cd c:\git\personal\advisor
harness init
# harness.yaml 편집해서 요구사항 입력

# 3. 실행
harness run
```
