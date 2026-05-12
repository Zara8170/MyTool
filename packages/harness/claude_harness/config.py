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
        data = yaml.safe_load(path.read_text())
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
