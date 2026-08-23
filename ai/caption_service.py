from __future__ import annotations

import copy
from dataclasses import dataclass
import hashlib
import json
import math
import os
from threading import Lock, Thread
import time
from typing import Any

from caption_results import (
    caption_rate_limited_response,
    native_caption_response,
    source_caption_response,
    transcript_api_caption_response,
    yt_dlp_caption_response,
)
from caption_translation import (
    CAPTION_TRANSLATION_INLINE_MAX_SEGMENTS,
    caption_translation_unavailable_reason,
    compact_caption_segments_for_translation,
    translate_caption_segments,
)
from caption_utils import (
    caption_segments_match_language,
    fallback_caption_response,
    normalize_caption_duration,
    normalize_caption_segments,
    normalize_language,
)
from youtube_caption_tracks import (
    caption_candidate_urls,
    choose_caption_track,
    simple_timedtext_url,
    source_caption_candidate_urls,
)
from youtube_search import extract_video_hint
from ytdlp_captions import sanitized_caption_exception


CAPTION_TRANSLATION_MAX_WINDOW_SECONDS = 240
CAPTION_CACHE_POLICY_VERSION = "translation-window-v3"
CAPTION_RESPONSE_CACHE_TTL_SECONDS = 10 * 60
CAPTION_RESPONSE_CACHE_MAX_SIZE = 64
CAPTION_RESPONSE_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
CAPTION_TRANSLATION_JOBS: set[str] = set()
CAPTION_TRANSLATION_JOB_LOCK = Lock()


@dataclass(frozen=True)
class CaptionServiceRuntime:
    namespace: Any


_runtime: CaptionServiceRuntime | None = None


def configure_caption_service_runtime(runtime: CaptionServiceRuntime) -> None:
    global _runtime
    _runtime = runtime


def caption_service_runtime() -> CaptionServiceRuntime:
    if _runtime is None:
        raise RuntimeError("Caption service runtime is not configured")
    return _runtime


def _dependency(name: str) -> Any:
    return getattr(caption_service_runtime().namespace, name)

def load_translated_captions(payload: dict[str, Any]) -> dict[str, Any]:
    cache_key = caption_response_cache_key(payload)
    cached_response = read_caption_response_cache(cache_key)

    if cached_response:
        return cached_response

    response = load_translated_captions_uncached(payload, cache_key)
    write_caption_response_cache(cache_key, response)

    return response


def load_translated_captions_uncached(
    payload: dict[str, Any],
    cache_key: str = "",
) -> dict[str, Any]:
    video_id = (
        str(payload.get("videoId") or "").strip()
        or extract_video_hint(
            str(
                payload.get("url")
                or payload.get("videoUrl")
                or payload.get("sourceUrl")
                or ""
            )
        )
        or ""
    )
    target_language = caption_target_language(payload)
    fallback_text = str(payload.get("fallbackText") or "").strip()
    allow_fallback = bool(payload.get("allowFallback", True))
    translate_fallback = bool(payload.get("translateFallback", False))
    duration_seconds = normalize_caption_duration(
        payload.get("durationSeconds") or payload.get("duration")
    )
    caption_window = caption_window_bounds(payload)

    if not video_id:
        return fallback_caption_response(
            video_id="",
            target_language=target_language,
            reason="missing-video-id",
            fallback_text=fallback_text,
            allow_fallback=allow_fallback,
            translate_fallback=translate_fallback,
            duration_seconds=duration_seconds,
        )

    if _dependency("httpx") is None:
        transcript_segments, transcript_source_language, transcript_translated = (
            _dependency("fetch_transcript_api_segments")(video_id, target_language)
        )

        if transcript_segments:
            return transcript_api_caption_response(
                video_id,
                target_language,
                transcript_source_language,
                transcript_translated,
                transcript_segments,
            )

        return fallback_caption_response(
            video_id=video_id,
            target_language=target_language,
            reason="http-client-unavailable",
            fallback_text=fallback_text,
            allow_fallback=allow_fallback,
            translate_fallback=translate_fallback,
            duration_seconds=duration_seconds,
        )

    try:
        track_fetch_error: Exception | None = None

        try:
            tracks = _dependency("fetch_youtube_caption_tracks")(video_id)
        except Exception as exc:
            tracks = []
            track_fetch_error = sanitized_caption_exception(exc)

        track = choose_caption_track(
            tracks,
            target_language,
            prefer_source_captions=can_translate_captions_with_openai(),
        )

        if not track:
            transcript_segments, transcript_source_language, transcript_translated = (
                _dependency("fetch_transcript_api_segments")(video_id, target_language)
            )

            if transcript_segments:
                return transcript_api_caption_response(
                    video_id,
                    target_language,
                    transcript_source_language or "youtube",
                    transcript_translated,
                    transcript_segments,
                )

            yt_dlp_segments, yt_dlp_source_language, yt_dlp_translated, _yt_dlp_error = (
                _dependency("fetch_yt_dlp_caption_segments")(video_id, target_language)
            )

            if yt_dlp_segments:
                return yt_dlp_caption_response(
                    video_id,
                    target_language,
                    yt_dlp_source_language,
                    yt_dlp_translated,
                    yt_dlp_segments,
                    cache_key=cache_key,
                    caption_window=caption_window,
                )

            rate_limit_error = preferred_caption_error(
                track_fetch_error,
                _yt_dlp_error,
            )
            if is_youtube_caption_rate_limited(rate_limit_error):
                rate_limit_source = (
                    "youtube-track-fetch-rate-limited"
                    if rate_limit_error is track_fetch_error
                    else "yt-dlp-caption-rate-limited"
                )
                return caption_rate_limited_response(
                    video_id,
                    target_language,
                    yt_dlp_source_language or "youtube",
                    f"{rate_limit_source}: {rate_limit_error}",
                )

            return native_caption_response(
                video_id,
                target_language,
                yt_dlp_source_language or "youtube",
                "youtube-caption-track-unavailable",
            )

        source_language = normalize_language(track.get("languageCode") or "")
        caption_urls = (
            source_caption_candidate_urls(track, video_id)
            if can_translate_captions_with_openai()
            and source_language
            and source_language != target_language
            else caption_candidate_urls(track, video_id, target_language)
        )
        segments, last_error = _dependency("fetch_caption_segments_from_urls")(
            caption_urls,
            video_id,
        )

        if not segments:
            transcript_segments, transcript_source_language, transcript_translated = (
                _dependency("fetch_transcript_api_segments")(video_id, target_language)
            )

            if transcript_segments:
                return transcript_api_caption_response(
                    video_id,
                    target_language,
                    transcript_source_language or source_language,
                    transcript_translated,
                    transcript_segments,
                )

            source_segments, source_error = _dependency("fetch_caption_segments_from_urls")(
                source_caption_candidate_urls(track, video_id),
                video_id,
            )

            if source_segments and source_language == target_language:
                return {
                    "mode": "youtube-captions",
                    "provider": "youtube-timedtext",
                    "videoId": video_id,
                    "language": target_language,
                    "sourceLanguage": source_language,
                    "translated": False,
                    "segments": source_segments,
                    "sourceSegments": source_segments,
                    "translatedSegments": [],
                    "message": "YouTube source timed-text captions loaded.",
                }

            translation_segments = caption_segments_in_window(
                source_segments,
                caption_window,
            )
            translated_segments = (
                translate_caption_segments(translation_segments, target_language)
                if should_translate_caption_segments_inline(translation_segments)
                else []
            )

            if translated_segments:
                return {
                    "mode": "youtube-captions",
                    "provider": "openai-caption-translation",
                    "videoId": video_id,
                    "language": target_language,
                    "sourceLanguage": source_language,
                    "translated": True,
                    "segments": translated_segments,
                    "sourceSegments": source_segments,
                    "translatedSegments": translated_segments,
                    "message": "YouTube source caption window translated for live playback.",
                }

            if source_segments:
                response = source_caption_response(
                    video_id,
                    target_language,
                    source_language,
                    source_segments,
                    "Source captions loaded while translation is unavailable.",
                )
                schedule_caption_translation(
                    cache_key,
                    video_id,
                    target_language,
                    source_language,
                    translation_segments or source_segments,
                )
                return response

            last_error = source_error or last_error

        if not segments:
            yt_dlp_segments, yt_dlp_source_language, yt_dlp_translated, yt_dlp_error = (
                _dependency("fetch_yt_dlp_caption_segments")(video_id, target_language)
            )

            if yt_dlp_segments:
                return yt_dlp_caption_response(
                    video_id,
                    target_language,
                    yt_dlp_source_language,
                    yt_dlp_translated,
                    yt_dlp_segments,
                    cache_key=cache_key,
                    caption_window=caption_window,
                )

            last_error = preferred_caption_error(last_error, yt_dlp_error)

        if not segments and is_youtube_caption_rate_limited(last_error):
            return caption_rate_limited_response(
                video_id,
                target_language,
                source_language or yt_dlp_source_language or "youtube",
                (
                    f"youtube-caption-rate-limited: {last_error}"
                    if last_error
                    else "youtube-caption-rate-limited"
                ),
            )

        if not segments:
            return native_caption_response(
                video_id,
                target_language,
                source_language or "youtube",
                (
                    f"youtube-caption-segments-empty: {last_error}"
                    if last_error
                    else "youtube-caption-segments-empty"
                ),
            )

        normalized_segments = normalize_caption_segments(segments)

        if normalized_segments and not caption_segments_match_language(
            normalized_segments,
            target_language,
        ):
            translation_segments = caption_segments_in_window(
                normalized_segments,
                caption_window,
            )
            translated_segments = (
                translate_caption_segments(translation_segments, target_language)
                if should_translate_caption_segments_inline(translation_segments)
                else []
            )

            if translated_segments:
                return {
                    "mode": "youtube-captions",
                    "provider": "openai-caption-translation",
                    "videoId": video_id,
                    "language": target_language,
                    "sourceLanguage": source_language or "youtube",
                    "translated": True,
                    "segments": translated_segments,
                    "sourceSegments": normalized_segments,
                    "translatedSegments": translated_segments,
                    "message": "YouTube timed-text caption window translated for live playback.",
                }

            response = source_caption_response(
                video_id,
                target_language,
                source_language or "youtube",
                normalized_segments,
                "Timed-text source captions loaded while translation is unavailable.",
            )
            schedule_caption_translation(
                cache_key,
                video_id,
                target_language,
                source_language or "youtube",
                translation_segments or normalized_segments,
            )
            return response

        return {
            "mode": "youtube-captions",
            "provider": "youtube-timedtext",
            "videoId": video_id,
            "language": target_language,
            "sourceLanguage": source_language,
            "translated": source_language != target_language,
            "segments": normalized_segments,
            "sourceSegments": (
                [] if source_language != target_language else normalized_segments
            ),
            "translatedSegments": (
                normalized_segments if source_language != target_language else []
            ),
            "message": "YouTube timed-text captions loaded for live playback.",
        }
    except Exception as exc:
        return fallback_caption_response(
            video_id=video_id,
            target_language=target_language,
            reason=f"youtube-caption-fetch-failed: {exc}",
            fallback_text=fallback_text,
            allow_fallback=allow_fallback,
            translate_fallback=translate_fallback,
            duration_seconds=duration_seconds,
        )


def caption_response_cache_key(payload: dict[str, Any]) -> str:
    video_id = (
        str(payload.get("videoId") or "").strip()
        or extract_video_hint(
            str(
                payload.get("url")
                or payload.get("videoUrl")
                or payload.get("sourceUrl")
                or ""
            )
        )
        or ""
    )

    if not video_id:
        return ""

    target_language = caption_target_language(payload)
    fallback_text = str(payload.get("fallbackText") or "").strip()
    duration_seconds = normalize_caption_duration(
        payload.get("durationSeconds") or payload.get("duration")
    )
    caption_window = caption_window_bounds(payload)
    openai_enabled = _dependency("OpenAI") is not None and bool(os.getenv("OPENAI_API_KEY"))
    cache_parts = {
        "videoId": video_id,
        "targetLanguage": target_language,
        "allowFallback": bool(payload.get("allowFallback", True)),
        "translateFallback": bool(payload.get("translateFallback", False)),
        "durationSeconds": duration_seconds,
        "window": caption_window,
        "fallbackTextHash": hashlib.sha256(fallback_text.encode("utf-8")).hexdigest(),
        "openaiEnabled": openai_enabled,
        "policyVersion": CAPTION_CACHE_POLICY_VERSION,
    }

    return json.dumps(cache_parts, sort_keys=True)


def caption_target_language(payload: dict[str, Any]) -> str:
    return normalize_language(
        payload.get("targetLanguage") or payload.get("language") or "ko"
    )


def caption_window_bounds(payload: dict[str, Any]) -> tuple[float, float] | None:
    start_value = payload.get("startSeconds", payload.get("start"))
    end_value = payload.get("endSeconds", payload.get("end"))

    if start_value is None or end_value is None:
        return None

    try:
        start_seconds = max(0.0, float(start_value))
        end_seconds = float(end_value)
    except (TypeError, ValueError):
        return None

    if not math.isfinite(start_seconds) or not math.isfinite(end_seconds):
        return None

    end_seconds = max(start_seconds + 1.0, end_seconds)

    if end_seconds - start_seconds > CAPTION_TRANSLATION_MAX_WINDOW_SECONDS:
        end_seconds = start_seconds + CAPTION_TRANSLATION_MAX_WINDOW_SECONDS

    return round(start_seconds, 3), round(end_seconds, 3)


def caption_segments_in_window(
    segments: list[dict[str, Any]],
    caption_window: tuple[float, float] | None,
) -> list[dict[str, Any]]:
    normalized_segments = normalize_caption_segments(segments)

    if caption_window is None:
        return normalized_segments

    start_seconds, end_seconds = caption_window

    return [
        segment
        for segment in normalized_segments
        if segment["end"] > start_seconds and segment["start"] < end_seconds
    ]


def read_caption_response_cache(cache_key: str) -> dict[str, Any] | None:
    if not cache_key:
        return None

    cached = CAPTION_RESPONSE_CACHE.get(cache_key)

    if not cached:
        return None

    created_at, response = cached

    if time.time() - created_at > CAPTION_RESPONSE_CACHE_TTL_SECONDS:
        CAPTION_RESPONSE_CACHE.pop(cache_key, None)
        return None

    if (
        response.get("provider") == "youtube-source-captions"
        and response.get("translated") is False
        and _dependency("OpenAI") is not None
        and os.getenv("OPENAI_API_KEY")
    ):
        CAPTION_RESPONSE_CACHE.pop(cache_key, None)
        return None

    return copy.deepcopy(response)



def write_caption_response_cache(
    cache_key: str,
    response: dict[str, Any],
) -> None:
    if not cache_key or not is_cacheable_caption_response(response):
        return

    while len(CAPTION_RESPONSE_CACHE) >= CAPTION_RESPONSE_CACHE_MAX_SIZE:
        oldest_key = min(
            CAPTION_RESPONSE_CACHE,
            key=lambda key: CAPTION_RESPONSE_CACHE[key][0],
        )
        CAPTION_RESPONSE_CACHE.pop(oldest_key, None)

    CAPTION_RESPONSE_CACHE[cache_key] = (time.time(), copy.deepcopy(response))


def is_cacheable_caption_response(response: dict[str, Any]) -> bool:
    return bool(response.get("segments"))


def is_youtube_caption_rate_limited(error: Exception | None) -> bool:
    if error is None:
        return False

    return "429" in str(error) or "Too Many Requests" in str(error)


def preferred_caption_error(
    *errors: Exception | None,
) -> Exception | None:
    for error in errors:
        if is_youtube_caption_rate_limited(error):
            return error

    for error in errors:
        if error is not None:
            return error

    return None


def can_translate_captions_with_openai() -> bool:
    return _dependency("OpenAI") is not None and bool(os.getenv("OPENAI_API_KEY"))


def should_translate_caption_segments_inline(
    segments: list[dict[str, Any]],
) -> bool:
    if not can_translate_captions_with_openai():
        return False

    compacted = compact_caption_segments_for_translation(
        normalize_caption_segments(segments)
    )

    return len(compacted) <= CAPTION_TRANSLATION_INLINE_MAX_SEGMENTS


def schedule_caption_translation(
    cache_key: str,
    video_id: str,
    target_language: str,
    source_language: str,
    segments: list[dict[str, Any]],
) -> None:
    if (
        not cache_key
        or not segments
        or _dependency("OpenAI") is None
        or not os.getenv("OPENAI_API_KEY")
    ):
        return

    with CAPTION_TRANSLATION_JOB_LOCK:
        if cache_key in CAPTION_TRANSLATION_JOBS:
            return

        CAPTION_TRANSLATION_JOBS.add(cache_key)

    Thread(
        target=run_caption_translation_job,
        args=(cache_key, video_id, target_language, source_language, segments),
        daemon=True,
    ).start()


def run_caption_translation_job(
    cache_key: str,
    video_id: str,
    target_language: str,
    source_language: str,
    segments: list[dict[str, Any]],
) -> None:
    try:
        translated_segments = translate_caption_segments(segments, target_language)

        if translated_segments:
            write_caption_response_cache(
                cache_key,
                {
                    "mode": "youtube-captions",
                    "provider": "openai-caption-translation",
                    "videoId": video_id,
                    "language": target_language,
                    "sourceLanguage": normalize_language(source_language) or "youtube",
                    "translated": True,
                    "segments": translated_segments,
                    "sourceSegments": normalize_caption_segments(segments),
                    "translatedSegments": translated_segments,
                    "message": "Source captions translated in the background.",
                },
            )
    finally:
        with CAPTION_TRANSLATION_JOB_LOCK:
            CAPTION_TRANSLATION_JOBS.discard(cache_key)





