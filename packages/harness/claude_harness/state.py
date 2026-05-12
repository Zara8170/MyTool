import yaml
from claude_harness.config import HarnessConfig, Requirement


def update_status(config: HarnessConfig, req: Requirement, status: str) -> None:
    data = yaml.safe_load(config.path.read_text())
    for r in data["requirements"]:
        if r["id"] == req.id:
            r["status"] = status
            break
    config.path.write_text(
        yaml.dump(data, allow_unicode=True, default_flow_style=False)
    )
