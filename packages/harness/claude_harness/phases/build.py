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
        check=False,
    )
