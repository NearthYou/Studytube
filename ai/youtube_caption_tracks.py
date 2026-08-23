from __future__ import annotations

from dataclasses import dataclass
import html as html_lib
import json
import re
from typing import Any, Callable
from urllib.parse import urlencode

from caption_utils import normalize_language, parse_timedtext_response
from youtube_runtime import youtube_httpx_request_kwargs
from ytdlp_captions import append_query_params, sanitized_caption_exception


@dataclass(frozen=True)
class CaptionTrackRuntime:
    http_client: Callable[[], Any | None]
    recovery_url: Callable[[str, str], str]


_runtime: CaptionTrackRuntime | None = None


def configure_caption_track_runtime(runtime: CaptionTrackRuntime) -> None:
    global _runtime
    _runtime = runtime


def caption_track_runtime() -> CaptionTrackRuntime:
    if _runtime is None:
        raise RuntimeError("Caption track runtime is not configured")
    return _runtime

def fetch_youtube_caption_tracks(video_id: str) -> list[dict[str, Any]]:
    if caption_track_runtime().http_client() is None:
        return []

    response = caption_track_runtime().http_client().get(
        "https://www.youtube.com/watch",
        params={"v": video_id, "hl": "en"},
        headers={
            "User-Agent": (
                "Mozilla/5.0 StudyTubeBoard/1.0 "
                "(educational caption retrieval)"
            )
        },
        **youtube_httpx_request_kwargs(timeout=8.0, follow_redirects=True),
    )
    response.raise_for_status()
    player_response = parse_yt_initial_player_response(response.text)
    track_list = (
        ((player_response.get("captions") or {}).get("playerCaptionsTracklistRenderer"))
        or {}
    ).get("captionTracks")

    return [track for track in track_list or [] if isinstance(track, dict)]


def parse_yt_initial_player_response(html: str) -> dict[str, Any]:
    return parse_json_assignment(
        html,
        ["ytInitialPlayerResponse", "var ytInitialPlayerResponse"],
    )


def parse_json_assignment(source: str, names: list[str]) -> dict[str, Any]:
    decoder = json.JSONDecoder()

    for name in names:
        start = source.find(name)

        if start < 0:
            continue

        equals = source.find("=", start)
        brace = source.find("{", equals)

        if equals < 0 or brace < 0:
            continue

        try:
            parsed, _end = decoder.raw_decode(source[brace:])
        except json.JSONDecodeError:
            continue

        if isinstance(parsed, dict):
            return parsed

    return {}


def choose_caption_track(
    tracks: list[dict[str, Any]],
    target_language: str,
    *,
    prefer_source_captions: bool = False,
) -> dict[str, Any] | None:
    if not tracks:
        return None

    if prefer_source_captions:
        for track in tracks:
            source_language = normalize_language(track.get("languageCode"))

            if source_language and source_language != target_language and track.get(
                "isTranslatable"
            ):
                return track

        for track in tracks:
            source_language = normalize_language(track.get("languageCode"))

            if source_language and source_language != target_language:
                return track

    for track in tracks:
        if normalize_language(track.get("languageCode")) == target_language:
            return track

    for track in tracks:
        if track.get("isTranslatable"):
            return track

    return tracks[0]


def build_caption_url(track: dict[str, Any], target_language: str) -> str:
    base_url = html_lib.unescape(str(track.get("baseUrl") or ""))
    source_language = normalize_language(track.get("languageCode"))
    params = {"fmt": "json3"}

    if target_language and source_language != target_language:
        params["tlang"] = target_language

    return append_query_params(base_url, params)


def caption_candidate_urls(
    track: dict[str, Any],
    video_id: str,
    target_language: str,
) -> list[str]:
    source_language = normalize_language(track.get("languageCode")) or "en"
    candidates = [
        build_caption_url(track, target_language),
        simple_timedtext_url(video_id, source_language, target_language),
    ]
    unique: list[str] = []

    for candidate in candidates:
        if candidate and candidate not in unique:
            unique.append(candidate)

    return unique


def source_caption_candidate_urls(
    track: dict[str, Any],
    video_id: str,
) -> list[str]:
    source_language = normalize_language(track.get("languageCode")) or "en"
    candidates = [
        build_caption_url(track, source_language),
        simple_timedtext_url(video_id, source_language, source_language),
    ]
    unique: list[str] = []

    for candidate in candidates:
        if candidate and candidate not in unique:
            unique.append(candidate)

    return unique


def fetch_caption_segments_from_urls(
    urls: list[str],
    video_id: str,
) -> tuple[list[dict[str, Any]], Exception | None]:
    if caption_track_runtime().http_client() is None:
        return [], None

    last_error: Exception | None = None

    for caption_url in urls:
        try:
            request_url = caption_track_runtime().recovery_url(caption_url, video_id)
            response = caption_track_runtime().http_client().get(
                request_url,
                headers=caption_request_headers(video_id),
                **youtube_httpx_request_kwargs(timeout=8.0, follow_redirects=True),
            )
            response.raise_for_status()
            segments = parse_timedtext_response(response)

            if segments:
                return segments, None
        except Exception as exc:
            last_error = sanitized_caption_exception(exc)

    return [], last_error


def caption_request_headers(video_id: str) -> dict[str, str]:
    return {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/125.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        "Referer": f"https://www.youtube.com/watch?v={video_id}",
        "Origin": "https://www.youtube.com",
    }


def simple_timedtext_url(
    video_id: str,
    source_language: str,
    target_language: str,
) -> str:
    params = {
        "v": video_id,
        "lang": source_language or "en",
        "fmt": "json3",
    }

    if target_language and target_language != source_language:
        params["tlang"] = target_language

    return f"https://www.youtube.com/api/timedtext?{urlencode(params)}"
