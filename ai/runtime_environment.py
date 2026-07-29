from collections.abc import Callable
from pathlib import Path
from typing import Any


def load_runtime_environment(
    loader: Callable[..., Any],
    *,
    ai_dir: Path,
    root_dir: Path,
) -> None:
    loader(ai_dir / ".env", override=False)
    loader(root_dir / ".env", override=False)
