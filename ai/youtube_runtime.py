from __future__ import annotations

import os
from pathlib import Path
from typing import Any


def youtube_httpx_request_kwargs(**kwargs: Any) -> dict[str, Any]:
    proxy_url = os.getenv("YOUTUBE_PROXY_URL", "").strip()
    if proxy_url:
        kwargs["proxy"] = proxy_url

    cookies = youtube_cookie_file_cookies()
    if cookies:
        existing_cookies = kwargs.get("cookies")
        if isinstance(existing_cookies, dict):
            cookies = {**cookies, **existing_cookies}
        kwargs["cookies"] = cookies
    return kwargs


def youtube_cookie_file_cookies() -> dict[str, str]:
    cookies_file = os.getenv("YOUTUBE_COOKIES_FILE", "").strip()
    if not cookies_file:
        return {}
    try:
        lines = Path(cookies_file).expanduser().read_text(
            encoding="utf-8",
            errors="ignore",
        ).splitlines()
    except OSError:
        return {}

    cookies: dict[str, str] = {}
    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("#HttpOnly_"):
            line = line.removeprefix("#HttpOnly_")
        elif line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) < 7:
            continue
        domain, _include, _path, _secure, _expires, name, value = parts[:7]
        if not name or not value:
            continue
        normalized_domain = domain.lower()
        if "youtube.com" not in normalized_domain and "google.com" not in normalized_domain:
            continue
        cookies[name] = value
    return cookies
