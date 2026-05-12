import subprocess
import time
from pathlib import Path
from claude_harness.config import HarnessConfig, Requirement
from claude_harness.state import update_status


def handle_pass(config: HarnessConfig, req: Requirement, iter_n: int, cwd: Path) -> None:
    update_status(config, req, "done")
    iter_id = f"{iter_n}-{int(time.time())}"
    subprocess.run(["git", "add", "-A"], cwd=cwd, check=False)
    subprocess.run(
        ["git", "commit", "-m", f"feat: implement {req.id} - {req.title}\n\niter-id: {iter_id}"],
        cwd=cwd, check=False
    )
    print(f"[PASS] {req.id}: {req.title} (iter-id: {iter_id})")


def handle_fail(config: HarnessConfig, req: Requirement, saved_head: str, cwd: Path) -> None:
    subprocess.run(["git", "reset", "--hard", saved_head], cwd=cwd, check=False)
    update_status(config, req, "failed")
    print(f"[FAIL] {req.id}: {req.title} — rolled back to {saved_head}")
