from typing import Optional
from claude_harness.config import HarnessConfig, Requirement


def select_next(config: HarnessConfig) -> Optional[Requirement]:
    return config.next_pending()
