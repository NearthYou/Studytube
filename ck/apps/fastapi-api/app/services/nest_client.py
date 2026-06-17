from __future__ import annotations

import json
import os
from urllib.parse import urlencode
from urllib.request import Request, urlopen


class NestClientError(RuntimeError):
    pass


class NestClient:
    def __init__(self) -> None:
        self.base_url = os.getenv("NEST_API_BASE_URL", "http://localhost:3000").strip().rstrip("/")
        self.timeout = float(os.getenv("NEST_API_TIMEOUT_SECONDS", "8"))

    def get_json(self, path: str, params: dict[str, object | None] | None = None):
        query = _clean_params(params or {})
        query_string = f"?{urlencode(query)}" if query else ""
        return self._request("GET", f"{path}{query_string}")

    def post_json(self, path: str, body: dict[str, object]):
        return self._request("POST", path, body=body)

    def _request(self, method: str, path: str, body: dict[str, object] | None = None):
        data = json.dumps(body).encode("utf-8") if body is not None else None
        request = Request(
            f"{self.base_url}{path}",
            data=data,
            method=method,
            headers={"Content-Type": "application/json"},
        )

        try:
            with urlopen(request, timeout=self.timeout) as response:
                payload = response.read().decode("utf-8")
                return json.loads(payload) if payload else None
        except Exception as exc:
            raise NestClientError(str(exc)) from exc


def _clean_params(params: dict[str, object | None]) -> dict[str, str]:
    cleaned: dict[str, str] = {}

    for key, value in params.items():
        if value is None or value == "":
            continue

        if isinstance(value, bool):
            cleaned[key] = "true" if value else "false"
            continue

        cleaned[key] = str(value)

    return cleaned
