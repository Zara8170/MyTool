import subprocess
from pathlib import Path


def run_verify(verify_cmd: str, cwd: Path) -> bool:
    result = subprocess.run(verify_cmd, shell=True, cwd=cwd)
    return result.returncode == 0
