import os
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any


def load_runtime_environment(
    loader: Callable[..., Any],
    *,
    ai_dir: Path,
    root_dir: Path,
    environment: Mapping[str, str] = os.environ,
) -> None:
    if environment.get("NODE_ENV", "").strip().casefold() == "production":
        return
    loader(ai_dir / ".env", override=False)
    loader(root_dir / ".env", override=False)
