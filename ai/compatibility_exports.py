from __future__ import annotations

from types import ModuleType
from typing import Any


def install_compatibility_exports(
    target: dict[str, Any],
    modules: list[ModuleType],
) -> None:
    for module in modules:
        for name, value in vars(module).items():
            if name.startswith("_"):
                continue
            if name.isupper() or getattr(value, "__module__", None) == module.__name__:
                target.setdefault(name, value)
