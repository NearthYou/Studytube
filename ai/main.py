from __future__ import annotations

import copy
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import html as html_lib
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
from threading import Lock, Thread
import time
from typing import Any
from urllib.parse import parse_qsl, quote_plus, urlencode, urlparse, urlunparse
from xml.etree import ElementTree

from embeddings import (
    EMBEDDING_DIMENSIONS,
    EMBEDDING_INPUT_USD_PER_MILLION_TOKENS,
    EMBEDDING_RESPONSE_CACHE,
    EMBEDDING_RESPONSE_CACHE_MAX_SIZE,
    EMBEDDING_RESPONSE_CACHE_TTL_SECONDS,
    RETRIEVAL_EMBEDDING_MODEL,
    EmbeddingProviderUnavailable,
    create_embedding_response,
    read_embedding_response_cache,
    write_embedding_response_cache,
)
from study_generation import (
    AGENT_TOOLS,
    build_study_plan as build_study_plan_with_lookup,
    choose_agent_tool,
    choose_tool_with_llm,
    create_agent_rationale,
    create_playlist_recommendations,
    create_playlist_title,
    suggest_tags,
    tokenize,
    tool_reason,
)
from youtube_runtime import (
    youtube_cookie_file_cookies,
    youtube_httpx_request_kwargs,
)
from youtube_search import (
    best_thumbnail,
    clean_text,
    extract_text,
    extract_video_hint,
    fetch_youtube_oembed,
    iter_video_renderers,
    lookup_youtube,
    parse_yt_initial_data,
    search_youtube,
    search_youtube_data_api,
    search_youtube_page,
    thumbnail_for_video,
    video_metadata,
    youtube_lookup_response,
    youtube_search_url,
)
from app_factory import (
    FeatureHandlers,
    JSONResponse,
    Request,
    create_application,
    is_mcp_protocol_path,
    require_production_internal_key,
)
from runtime_environment import load_runtime_environment

try:
    from dotenv import load_dotenv
except ModuleNotFoundError:  # pragma: no cover - local test fallback
    def load_dotenv(*_args: Any, **_kwargs: Any) -> None:
        return None

try:
    import httpx
except ModuleNotFoundError:  # pragma: no cover - local test fallback
    httpx = None

try:
    import imageio_ffmpeg
except ModuleNotFoundError:  # pragma: no cover - optional ffmpeg fallback
    imageio_ffmpeg = None

try:
    from openai import OpenAI
except ModuleNotFoundError:  # pragma: no cover - local test fallback
    OpenAI = None

try:
    from youtube_transcript_api import YouTubeTranscriptApi
except ModuleNotFoundError:  # pragma: no cover - optional transcript fallback
    YouTubeTranscriptApi = None


AI_DIR = Path(__file__).resolve().parent
ROOT_DIR = AI_DIR.parent

load_runtime_environment(load_dotenv, ai_dir=AI_DIR, root_dir=ROOT_DIR)

DEFAULT_DATABASE_URL = "postgresql://app:app@localhost:5432/app_dev"
DEFAULT_FALLBACK_CAPTION_DURATION_SECONDS = 600
CAPTION_TRANSLATION_BATCH_SIZE = 32
CAPTION_TRANSLATION_MAX_WORKERS = 8
CAPTION_TRANSLATION_COMPACT_THRESHOLD = 240
CAPTION_TRANSLATION_COMPACT_MAX_DURATION_SECONDS = 8.0
CAPTION_TRANSLATION_COMPACT_MAX_CHARS = 220
CAPTION_TRANSLATION_TARGET_SEGMENTS = 720
CAPTION_TRANSLATION_INLINE_MAX_SEGMENTS = 96
CAPTION_TRANSLATION_MAX_WINDOW_SECONDS = 240
CAPTION_TRANSLATION_REQUEST_TIMEOUT_SECONDS = 45
CAPTION_CACHE_POLICY_VERSION = "translation-window-v3"
CAPTION_RESPONSE_CACHE_TTL_SECONDS = 10 * 60
CAPTION_RESPONSE_CACHE_MAX_SIZE = 64
CAPTION_RESPONSE_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
SUMMARY_CACHE_POLICY_VERSION = "transcript-summary-v1"
SUMMARY_RESPONSE_CACHE_TTL_SECONDS = 30 * 60
SUMMARY_RESPONSE_CACHE_MAX_SIZE = 64
SUMMARY_RESPONSE_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
YOUTUBE_SUBTITLE_PO_TOKEN_CACHE_TTL_SECONDS = 5 * 60 * 60
YOUTUBE_SUBTITLE_PO_TOKEN_CACHE: dict[str, tuple[float, tuple[str, str]]] = {}
CAPTION_TRANSLATION_JOBS: set[str] = set()
CAPTION_TRANSLATION_JOB_LOCK = Lock()

def youtube_caption_runtime_health() -> dict[str, bool]:
    return {
        "ytDlpAvailable": bool(yt_dlp_commands()),
        "poTokenConfigured": explicit_youtube_subtitle_po_token() is not None,
        "autoPoTokenEnabled": truthy_env_default("YOUTUBE_AUTO_SUBTITLE_PO_TOKEN", True),
        "bgutilConfigured": bool(youtube_bgutil_server_home()),
        "proxyConfigured": bool(os.getenv("YOUTUBE_PROXY_URL", "").strip()),
        "cookiesConfigured": bool(
            os.getenv("YOUTUBE_COOKIES_FILE", "").strip()
            or os.getenv("YOUTUBE_COOKIES_FROM_BROWSER", "").strip()
        ),
    }


def handle_mcp_request(payload: dict[str, Any]) -> dict[str, Any]:
    request_id = payload.get("id")
    method = payload.get("method")
    params = payload.get("params") or {}

    if payload.get("jsonrpc") != "2.0":
        return json_rpc_error(request_id, -32600, "Invalid JSON-RPC version")

    if method == "youtube.lookup":
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": lookup_youtube(params),
        }

    return json_rpc_error(request_id, -32601, f"Unknown MCP method: {method}")


def build_study_plan(payload: dict[str, Any]) -> dict[str, Any]:
    return build_study_plan_with_lookup(payload, lookup_youtube)


def build_quiz_response(payload: dict[str, Any]) -> dict[str, Any]:
    title = clean_text(str(payload.get("title") or "")).strip()
    source_url = str(payload.get("sourceUrl") or "").strip()
    parsed_source = urlparse(source_url)
    allowed_hosts = {
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "youtu.be",
        "www.youtu.be",
    }
    if not title or len(title) > 500:
        raise ValueError("Quiz title is required")
    if (
        parsed_source.scheme != "https"
        or (parsed_source.hostname or "").lower() not in allowed_hosts
    ):
        raise ValueError("Quiz source must be an allowed YouTube URL")

    timestamp_seconds = int(payload.get("timestampSeconds") or 0)
    duration_seconds = int(
        payload.get("durationSeconds") or DEFAULT_FALLBACK_CAPTION_DURATION_SECONDS
    )
    if timestamp_seconds < 0 or duration_seconds <= 0:
        raise ValueError("Quiz citation range is invalid")

    window_start = max(0, timestamp_seconds - 15)
    window_end = min(duration_seconds, timestamp_seconds + 240)
    if window_end <= window_start:
        window_end = window_start + 1
    caption_response = load_translated_captions(
        {
            "sourceUrl": source_url,
            "targetLanguage": "ko",
            "allowFallback": False,
            "translateFallback": True,
            "durationSeconds": duration_seconds,
            "startSeconds": window_start,
            "endSeconds": window_end,
        }
    )
    segments = normalize_caption_segments(
        caption_response.get("segments")
        if isinstance(caption_response.get("segments"), list)
        else []
    )
    cited = [
        segment
        for segment in segments
        if segment["end"] > window_start and segment["start"] < window_end
    ]
    if len(cited) < 5:
        raise ValueError("Quiz generation requires at least five cited captions")

    anchors = [
        cited[round(index * (len(cited) - 1) / 4)] for index in range(5)
    ]
    questions = []
    for index, anchor in enumerate(anchors):
        correct = clean_text(str(anchor["text"])).strip()[:220]
        distractors = []
        for candidate in anchors[index + 1 :] + anchors[:index]:
            text = clean_text(str(candidate["text"])).strip()[:220]
            if text and text != correct and text not in distractors:
                distractors.append(text)
            if len(distractors) == 3:
                break
        while len(distractors) < 3:
            distractors.append(f"근거 구간에 없는 설명 {len(distractors) + 1}")
        correct_index = index % 4
        choices = distractors[:]
        choices.insert(correct_index, correct)
        source_start = max(0, int(math.floor(float(anchor["start"]))))
        source_end = max(
            source_start + 1,
            int(math.ceil(float(anchor["end"]))),
        )
        questions.append(
            {
                "prompt": (
                    f"'{title}'의 {source_start}초 근거 구간에서 설명한 내용은 "
                    "무엇인가요?"
                ),
                "choices": choices,
                "correctChoiceIndex": correct_index,
                "explanation": (
                    f"{source_start}초부터 {source_end}초까지의 자막에 "
                    f"'{correct}'라고 제시되어 있습니다."
                ),
                "sourceUrl": source_url,
                "sourceStartSeconds": source_start,
                "sourceEndSeconds": source_end,
            }
        )

    return {
        "schemaVersion": 1,
        "generatorVersion": "caption-grounded-v1",
        "questions": questions,
        "usage": {
            "model": "deterministic-caption-grounded",
            "totalTokens": 0,
            "estimatedCostUsd": 0,
        },
    }


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

    if httpx is None:
        transcript_segments, transcript_source_language, transcript_translated = (
            fetch_transcript_api_segments(video_id, target_language)
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
            tracks = fetch_youtube_caption_tracks(video_id)
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
                fetch_transcript_api_segments(video_id, target_language)
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
                fetch_yt_dlp_caption_segments(video_id, target_language)
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
        segments, last_error = fetch_caption_segments_from_urls(
            caption_urls,
            video_id,
        )

        if not segments:
            transcript_segments, transcript_source_language, transcript_translated = (
                fetch_transcript_api_segments(video_id, target_language)
            )

            if transcript_segments:
                return transcript_api_caption_response(
                    video_id,
                    target_language,
                    transcript_source_language or source_language,
                    transcript_translated,
                    transcript_segments,
                )

            source_segments, source_error = fetch_caption_segments_from_urls(
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
                fetch_yt_dlp_caption_segments(video_id, target_language)
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
    openai_enabled = OpenAI is not None and bool(os.getenv("OPENAI_API_KEY"))
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
        and OpenAI is not None
        and os.getenv("OPENAI_API_KEY")
    ):
        CAPTION_RESPONSE_CACHE.pop(cache_key, None)
        return None

    return copy.deepcopy(response)


STT_MODEL_SNAPSHOT = "gpt-4o-mini-transcribe-2025-12-15"


def production_transcription_adapter(
    request: dict[str, Any],
    *,
    downloader: Any | None = None,
    client: Any | None = None,
) -> dict[str, Any]:
    start_seconds = normalize_transcription_start(request.get("startSeconds"))
    duration_seconds = normalize_transcription_duration(
        request.get("durationSeconds")
    )
    if not duration_seconds:
        raise RuntimeError("TRANSCRIPTION_PROVIDER_UNAVAILABLE")
    with tempfile.TemporaryDirectory(prefix="studytube-transcription-") as temp_dir:
        audio_path, media_duration = (downloader or download_youtube_audio_window)(
            request,
            Path(temp_dir),
        )
        window_duration = min(
            duration_seconds,
            max(float(media_duration) - start_seconds, 0),
        )
        if window_duration <= 0:
            raise RuntimeError("TRANSCRIPTION_PROVIDER_UNAVAILABLE")
        active_client = client or (
            OpenAI(timeout=90.0, max_retries=2) if OpenAI is not None else None
        )
        if active_client is None:
            raise RuntimeError("TRANSCRIPTION_PROVIDER_UNAVAILABLE")
        with audio_path.open("rb") as audio_file:
            response = active_client.audio.transcriptions.create(
                model=str(request.get("model") or STT_MODEL_SNAPSHOT),
                file=audio_file,
            )
        text = clean_caption_text(str(getattr(response, "text", "") or ""))
        if not text:
            raise RuntimeError("TRANSCRIPTION_PROVIDER_UNAVAILABLE")
        segments = fallback_caption_segments(text, window_duration)
        for segment in segments:
            segment["start"] = round(segment["start"] + start_seconds, 3)
            segment["end"] = round(segment["end"] + start_seconds, 3)
        return {
            "provider": "openai-audio-transcription",
            "sourceLanguage": "und",
            "segments": segments,
            "translatedSegments": [],
            "mediaDurationSeconds": media_duration,
        }


def download_youtube_audio_window(
    request: dict[str, Any],
    directory: Path,
) -> tuple[Path, float]:
    video_id = str(request.get("videoId") or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
        raise RuntimeError("TRANSCRIPTION_PROVIDER_UNAVAILABLE")
    start_seconds = normalize_transcription_start(request.get("startSeconds"))
    requested_duration = normalize_transcription_duration(
        request.get("durationSeconds")
    )
    if not requested_duration:
        raise RuntimeError("TRANSCRIPTION_PROVIDER_UNAVAILABLE")
    metadata, _metadata_error = fetch_yt_dlp_metadata(video_id)
    media_duration = normalize_transcription_duration(
        metadata.get("duration") if isinstance(metadata, dict) else None
    ) or (start_seconds + requested_duration)
    if (
        start_seconds != 0
        or start_seconds >= media_duration
        or media_duration > requested_duration
    ):
        raise RuntimeError("TRANSCRIPTION_PROVIDER_UNAVAILABLE")
    output_template = str(directory / "window.%(ext)s")
    with yt_dlp_secret_config_args() as secret_config_args:
        for command in yt_dlp_commands():
            completed = subprocess.run(
                [
                    *command,
                    *yt_dlp_recovery_args(),
                    *secret_config_args,
                    "--no-playlist",
                    "--quiet",
                    "--no-warnings",
                    "--format",
                    "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best",
                    "--output",
                    output_template,
                    f"https://www.youtube.com/watch?v={video_id}",
                ],
                capture_output=True,
                text=True,
                timeout=max(60, min(180, int(requested_duration * 3))),
                check=False,
                env=youtube_subprocess_environment(),
            )
            if completed.returncode != 0:
                continue
            candidates = [
                path
                for path in directory.iterdir()
                if path.is_file()
                and path.suffix.lower()
                in {".mp3", ".m4a", ".mp4", ".ogg", ".wav", ".webm"}
            ]
            if candidates:
                return max(candidates, key=lambda path: path.stat().st_size), float(
                    media_duration
                )
    raise RuntimeError("TRANSCRIPTION_PROVIDER_UNAVAILABLE")


def transcribe_youtube_audio(
    payload: dict[str, Any],
    *,
    adapter: Any | None = None,
) -> dict[str, Any]:
    """Run only an explicitly enabled, approved adapter.

    Production intentionally supplies no adapter until the separate cost approval
    is deployed. Tests inject a fake adapter; this function never acquires media or
    uploads audio itself.
    """
    video_id = str(payload.get("videoId") or "").strip()
    model = str(payload.get("model") or "").strip()
    duration_seconds = normalize_transcription_duration(
        payload.get("durationSeconds")
    )
    capability = payload.get("mediaCapability")
    capability = capability if isinstance(capability, dict) else {}

    capability_error = transcription_capability_error(
        capability,
        duration_seconds,
    )
    if capability_error:
        return transcription_failure(capability_error)
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
        return transcription_failure("TRANSCRIPTION_PROVIDER_UNAVAILABLE")
    if model != STT_MODEL_SNAPSHOT:
        return transcription_failure("STT_DISABLED")
    selected_adapter = adapter or production_transcription_adapter
    if (
        os.getenv("STT_PROVIDER_ENABLED", "").strip().casefold() != "true"
        or not os.getenv("STT_COST_APPROVAL_ID", "").strip()
    ):
        return transcription_failure("STT_DISABLED")

    adapter_request = {
        "videoId": video_id,
        "durationSeconds": int(duration_seconds or 0),
        "model": STT_MODEL_SNAPSHOT,
    }
    start_seconds = normalize_transcription_start(payload.get("startSeconds"))
    if start_seconds > 0:
        adapter_request["startSeconds"] = start_seconds
    try:
        raw = selected_adapter(adapter_request)
        value = raw if isinstance(raw, dict) else {}
        raw_segments = value.get("segments")
        segments = normalize_caption_segments(
            raw_segments if isinstance(raw_segments, list) else []
        )
        if not segments:
            return transcription_failure("TRANSCRIPTION_PROVIDER_UNAVAILABLE")
        translated_segments = normalize_caption_segments(
            value.get("translatedSegments")
            if isinstance(value.get("translatedSegments"), list)
            else []
        )
        target_language = normalize_language(
            str(payload.get("targetLanguage") or "ko")
        ) or "ko"
        source_language = normalize_language(
            str(value.get("sourceLanguage") or "")
        ) or "und"
        if (
            adapter is None
            and not translated_segments
            and source_language != target_language
        ):
            translated_segments = translate_caption_segments(
                segments,
                target_language,
            )
        response = {
            "provider": str(
                value.get("provider")
                or (
                    "fake-transcription"
                    if adapter is not None
                    else "openai-audio-transcription"
                )
            ),
            "status": "ready",
            "sourceLanguage": source_language,
            "segments": segments,
            "translatedSegments": translated_segments,
            "errorCode": "",
        }
        media_duration = normalize_transcription_duration(
            value.get("mediaDurationSeconds")
        )
        if media_duration:
            response["mediaDurationSeconds"] = media_duration
        return response
    except Exception:
        return transcription_failure("TRANSCRIPTION_PROVIDER_UNAVAILABLE")


def transcription_capability_error(
    capability: dict[str, Any],
    duration_seconds: float | None,
) -> str:
    if capability.get("isLive") is True:
        return "VIDEO_LIVE_UNSUPPORTED"
    if str(capability.get("restriction") or "").strip():
        return "VIDEO_RESTRICTED"
    if capability.get("authenticationRequired") is True:
        return "VIDEO_AUTH_REQUIRED"
    capability_duration_value = capability.get("durationSeconds")
    if capability_duration_value is not None and not normalize_transcription_duration(
        capability_duration_value
    ):
        return "VIDEO_TOO_LONG"
    capability_duration = normalize_transcription_duration(capability_duration_value)
    effective_duration = capability_duration or duration_seconds
    if not effective_duration or effective_duration > 14_400:
        return "VIDEO_TOO_LONG"
    return ""


def normalize_transcription_duration(value: Any) -> float | None:
    try:
        duration = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(duration) or duration <= 0 or duration > 14_400:
        return None
    return round(duration, 3)


def normalize_transcription_start(value: Any) -> float:
    try:
        start = float(value or 0)
    except (TypeError, ValueError):
        return 0
    return round(start, 3) if math.isfinite(start) and start >= 0 else 0


def transcription_failure(error_code: str) -> dict[str, Any]:
    return {
        "provider": "stt-disabled"
        if error_code in ("STT_DISABLED", "STT_NOT_APPROVED")
        else "transcription-unavailable",
        "status": "disabled"
        if error_code in ("STT_DISABLED", "STT_NOT_APPROVED")
        else "failed",
        "sourceLanguage": "",
        "segments": [],
        "translatedSegments": [],
        "errorCode": error_code,
    }


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
    return OpenAI is not None and bool(os.getenv("OPENAI_API_KEY"))


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
        or OpenAI is None
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


def build_youtube_summary(payload: dict[str, Any]) -> dict[str, Any]:
    video_id = str(payload.get("videoId") or "").strip()
    title = clean_text(str(payload.get("title") or "")).strip()
    channel_name = clean_text(str(payload.get("channelName") or "")).strip()
    target_language = "ko"
    stored_summary = clean_text(str(payload.get("summary") or "")).strip()
    stored_notes = clean_text(str(payload.get("translatedNotes") or "")).strip()
    segments = summary_caption_segments(payload, video_id, target_language)
    transcript = transcript_text_from_segments(segments)
    summary_cache_key = summary_response_cache_key(
        video_id=video_id,
        title=title,
        channel_name=channel_name,
        target_language=target_language,
        transcript=transcript,
    )
    cached_summary = read_summary_response_cache(summary_cache_key)

    if cached_summary:
        return cached_summary

    if OpenAI is not None and os.getenv("OPENAI_API_KEY") and transcript:
        sections = summarize_video_with_openai(
            title=title,
            channel_name=channel_name,
            transcript=transcript,
            target_language=target_language,
        )

        if sections:
            response = {
                "mode": "youtube-summary",
                "provider": "openai-transcript-summary",
                "videoId": video_id,
                "language": target_language,
                "sections": append_transcript_section(sections, segments),
                "message": "Caption transcript summarized into detailed study notes.",
            }
            write_summary_response_cache(summary_cache_key, response)

            return response

    return {
        "mode": "youtube-summary",
        "provider": "local-transcript-summary",
        "videoId": video_id,
        "language": target_language,
        "sections": append_transcript_section(
            korean_fallback_video_summary_sections(
                title=title,
                channel_name=channel_name,
                stored_summary=stored_summary,
                stored_notes=stored_notes,
                segments=segments,
            ),
            segments,
        ),
        "message": "Detailed AI summary unavailable; generated structured notes locally.",
    }


def summary_response_cache_key(
    *,
    video_id: str,
    title: str,
    channel_name: str,
    target_language: str,
    transcript: str,
) -> str:
    if not video_id or not transcript:
        return ""

    cache_parts = {
        "videoId": video_id,
        "title": title,
        "channelName": channel_name,
        "targetLanguage": target_language,
        "transcriptHash": hashlib.sha256(transcript.encode("utf-8")).hexdigest(),
        "model": os.getenv("LLM_MODEL", "gpt-4o-mini"),
        "policyVersion": SUMMARY_CACHE_POLICY_VERSION,
    }

    return json.dumps(cache_parts, sort_keys=True)


def read_summary_response_cache(cache_key: str) -> dict[str, Any] | None:
    if not cache_key:
        return None

    cached = SUMMARY_RESPONSE_CACHE.get(cache_key)

    if not cached:
        return None

    created_at, response = cached

    if time.time() - created_at > SUMMARY_RESPONSE_CACHE_TTL_SECONDS:
        SUMMARY_RESPONSE_CACHE.pop(cache_key, None)
        return None

    return copy.deepcopy(response)


def write_summary_response_cache(
    cache_key: str,
    response: dict[str, Any],
) -> None:
    if (
        not cache_key
        or response.get("provider") != "openai-transcript-summary"
        or not response.get("sections")
    ):
        return

    while len(SUMMARY_RESPONSE_CACHE) >= SUMMARY_RESPONSE_CACHE_MAX_SIZE:
        oldest_key = min(
            SUMMARY_RESPONSE_CACHE,
            key=lambda key: SUMMARY_RESPONSE_CACHE[key][0],
        )
        SUMMARY_RESPONSE_CACHE.pop(oldest_key, None)

    SUMMARY_RESPONSE_CACHE[cache_key] = (time.time(), copy.deepcopy(response))


def summary_caption_segments(
    payload: dict[str, Any],
    video_id: str,
    target_language: str,
) -> list[dict[str, Any]]:
    raw_segments = payload.get("segments")
    segments = normalize_caption_segments(
        raw_segments if isinstance(raw_segments, list) else []
    )

    if segments or not video_id:
        return segments

    caption_payload: dict[str, Any] = {
        "videoId": video_id,
        "targetLanguage": target_language,
        "allowFallback": False,
        "translateFallback": False,
    }

    for key in ["videoUrl", "url", "sourceUrl", "durationSeconds", "duration"]:
        if payload.get(key) is not None:
            caption_payload[key] = payload[key]

    try:
        caption_response = load_translated_captions(caption_payload)
    except Exception:
        return []

    response_segments = caption_response.get("segments")
    return normalize_caption_segments(
        response_segments if isinstance(response_segments, list) else []
    )


def summarize_video_with_openai(
    title: str,
    channel_name: str,
    transcript: str,
    target_language: str,
) -> list[dict[str, str]]:
    try:  # pragma: no cover - live credentials are optional in local tests
        client = OpenAI()
        response = client.chat.completions.create(
            model=os.getenv("LLM_MODEL", "gpt-4o-mini"),
            temperature=0.2,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You create detailed study notes from YouTube transcripts. "
                        "Always write in Korean, regardless of the transcript language or caption UI language. "
                        "Be specific, practical, and useful "
                        "for someone studying while watching the video. If the transcript is noisy, "
                        "infer cautiously from repeated context and avoid pretending uncertain details are exact. "
                        "Return only JSON with a sections array. Each section must have label and body."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "targetLanguage": target_language,
                            "title": title,
                            "channelName": channel_name,
                            "requiredSections": [
                                "핵심 요약",
                                "구간별 흐름",
                                "중요 표현/개념",
                                "학습 포인트",
                                "복습 질문",
                            ],
                            "style": (
                                "각 섹션은 2~5문장으로 자세히 작성하고, "
                                "단순 홍보문이나 한 줄 설명이 아니라 영상 내용을 학습 노트처럼 정리하세요."
                            ),
                            "transcript": transcript,
                        },
                        ensure_ascii=False,
                    ),
                },
            ],
        )
        content = getattr(response.choices[0].message, "content", "") or ""

        return parse_summary_sections(content)
    except Exception:
        return []


def parse_summary_sections(content: str) -> list[dict[str, str]]:
    normalized = content.strip()
    match = re.search(r"(\{.*\}|\[.*\])", normalized, re.S)

    if match:
        normalized = match.group(1)

    try:
        data = json.loads(normalized)
    except json.JSONDecodeError:
        return []

    sections = data.get("sections") if isinstance(data, dict) else data

    if not isinstance(sections, list):
        return []

    parsed: list[dict[str, str]] = []

    for section in sections:
        if not isinstance(section, dict):
            continue

        label = clean_text(str(section.get("label") or "")).strip()
        body = clean_text(str(section.get("body") or "")).strip()

        if label and body:
            parsed.append({"label": label[:40], "body": body})

    return parsed[:8]


def append_transcript_section(
    sections: list[dict[str, str]],
    segments: list[dict[str, Any]],
) -> list[dict[str, str]]:
    body = timestamped_transcript_body(summary_transcript_segments(segments))

    if not body:
        return sections

    without_existing_transcript = [
        section
        for section in sections
        if section.get("label") != "전체 스크립트 전사문"
    ]

    return [
        *without_existing_transcript,
        {
            "label": "전체 스크립트 전사문",
            "body": body,
        },
    ]


def summary_transcript_segments(
    segments: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if not segments or caption_segments_match_language(segments, "ko"):
        return segments

    translated_segments = translate_caption_segments(segments, "ko")

    return translated_segments


KEY_TRANSCRIPT_MAX_SEGMENTS = 8
KEY_TRANSCRIPT_MIN_REVIEW_INTERVAL_SECONDS = 45
KEY_TRANSCRIPT_MIN_TEXT_CHARS = 3
FULL_TRANSCRIPT_INTERVAL_SECONDS = 60
KEY_TRANSCRIPT_CUE_WORDS = (
    "핵심",
    "중요",
    "정리",
    "요약",
    "예를",
    "예시",
    "실습",
    "주의",
    "문제",
    "비교",
    "방법",
    "개념",
    "원리",
    "이유",
    "전략",
    "다시",
    "remember",
    "important",
    "key",
    "example",
    "practice",
    "warning",
    "summary",
    "because",
)


def key_transcript_segments(
    segments: list[dict[str, Any]],
    max_segments: int = KEY_TRANSCRIPT_MAX_SEGMENTS,
) -> list[dict[str, Any]]:
    candidates = transcript_review_candidates(segments)

    if len(candidates) <= 2:
        return [candidate["segment"] for candidate in candidates]

    starts = [candidate["start"] for candidate in candidates]
    duration = max(starts) - min(starts)
    target_count = key_transcript_target_count(duration, len(candidates), max_segments)
    bucketed = best_key_transcript_candidate_per_bucket(
        candidates,
        target_count,
        min(starts),
        max(starts),
    )
    selected = spaced_key_transcript_candidates(bucketed, target_count)

    if len(selected) < target_count:
        selected = spaced_key_transcript_candidates(
            [*selected, *sorted(candidates, key=lambda item: item["score"], reverse=True)],
            target_count,
        )

    return [
        candidate["segment"]
        for candidate in sorted(selected, key=lambda item: item["start"])
    ]


def transcript_review_candidates(
    segments: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []

    for index, segment in enumerate(segments):
        text = clean_text(str(segment.get("text") or "")).strip()

        if len(text.replace(" ", "")) < KEY_TRANSCRIPT_MIN_TEXT_CHARS:
            continue

        try:
            start = float(segment.get("start") or 0)
        except (TypeError, ValueError):
            start = 0.0

        candidates.append(
            {
                "segment": {**segment, "text": text, "start": start},
                "start": start,
                "score": key_transcript_score(text, index, len(segments)),
            }
        )

    return candidates


def key_transcript_target_count(
    duration_seconds: float,
    candidate_count: int,
    max_segments: int,
) -> int:
    if candidate_count <= 2:
        return candidate_count

    duration_count = max(3, min(max_segments, math.ceil(duration_seconds / 120)))
    return min(max_segments, candidate_count, duration_count)


def best_key_transcript_candidate_per_bucket(
    candidates: list[dict[str, Any]],
    target_count: int,
    first_start: float,
    last_start: float,
) -> list[dict[str, Any]]:
    if target_count <= 1 or first_start >= last_start:
        return candidates[:target_count]

    buckets: list[dict[str, Any] | None] = [None] * target_count
    duration = max(1.0, last_start - first_start)

    for candidate in candidates:
        bucket_index = min(
            target_count - 1,
            int(((candidate["start"] - first_start) / duration) * target_count),
        )
        current = buckets[bucket_index]

        if current is None or candidate["score"] > current["score"]:
            buckets[bucket_index] = candidate

    return [candidate for candidate in buckets if candidate is not None]


def spaced_key_transcript_candidates(
    candidates: list[dict[str, Any]],
    target_count: int,
) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    seen_starts: set[float] = set()

    for candidate in sorted(candidates, key=lambda item: item["score"], reverse=True):
        start = candidate["start"]

        if start in seen_starts:
            continue

        if any(
            abs(start - chosen["start"]) < KEY_TRANSCRIPT_MIN_REVIEW_INTERVAL_SECONDS
            for chosen in selected
        ):
            continue

        selected.append(candidate)
        seen_starts.add(start)

        if len(selected) >= target_count:
            break

    if len(selected) >= min(target_count, len(candidates)):
        return selected

    for candidate in sorted(candidates, key=lambda item: item["start"]):
        start = candidate["start"]

        if start in seen_starts:
            continue

        selected.append(candidate)
        seen_starts.add(start)

        if len(selected) >= target_count:
            break

    return selected


def key_transcript_score(text: str, index: int, total_count: int) -> float:
    normalized = text.lower()
    cue_score = sum(1 for cue in KEY_TRANSCRIPT_CUE_WORDS if cue in normalized)
    length_score = min(2.0, len(text) / 60)
    position_score = 0.2 if 0 < index < total_count - 1 else 0.0

    return cue_score * 3 + length_score + position_score


def timestamped_transcript_body(segments: list[dict[str, Any]]) -> str:
    buckets: list[dict[str, Any]] = []

    for segment in normalize_caption_segments(segments):
        text = clean_text(str(segment.get("text") or "")).strip()

        if not text:
            continue

        try:
            start = float(segment.get("start") or 0)
        except (TypeError, ValueError):
            start = 0.0

        bucket_start = (
            math.floor(max(0.0, start) / FULL_TRANSCRIPT_INTERVAL_SECONDS)
            * FULL_TRANSCRIPT_INTERVAL_SECONDS
        )
        current_bucket = buckets[-1] if buckets else None

        if not current_bucket or current_bucket["start"] != bucket_start:
            current_bucket = {"start": bucket_start, "texts": []}
            buckets.append(current_bucket)

        current_bucket["texts"].append(text)

    lines = [
        f"{format_caption_time(float(bucket['start']))} {' '.join(bucket['texts'])}"
        for bucket in buckets
        if bucket["texts"]
    ]

    return "\n".join(lines)


def text_looks_korean(value: str) -> bool:
    compact = clean_text(value)
    hangul_count = len(re.findall(r"[\uac00-\ud7a3]", compact))
    latin_count = len(re.findall(r"[A-Za-z]", compact))
    letter_count = hangul_count + latin_count

    return letter_count > 0 and hangul_count >= 5 and hangul_count / letter_count >= 0.2


def transcript_text_from_segments(
    segments: list[dict[str, Any]],
    max_chars: int = 14000,
) -> str:
    lines: list[str] = []
    total_length = 0

    for segment in segments:
        text = clean_text(str(segment.get("text") or "")).strip()

        if not text:
            continue

        start = format_caption_time(float(segment.get("start") or 0))
        line = f"{start} {text}"
        total_length += len(line)

        if total_length > max_chars:
            break

        lines.append(line)

    return "\n".join(lines)


def korean_fallback_video_summary_sections(
    title: str,
    channel_name: str,
    stored_summary: str,
    stored_notes: str,
    segments: list[dict[str, Any]],
) -> list[dict[str, str]]:
    sections: list[dict[str, str]] = []
    context = " ".join(
        part for part in [title, channel_name, stored_summary] if part
    ).strip()

    if context:
        sections.append(
            {
                "label": "핵심 요약",
                "body": (
                    "이 영상은 제목, 채널, 저장된 설명을 기준으로 학습 맥락을 정리한 자료입니다. "
                    "외부 AI 요약을 사용할 수 없어도 영상의 핵심 주제와 복습 방향을 한국어로 확인할 수 있습니다."
                ),
            }
        )

    if segments and caption_segments_match_language(segments, "ko"):
        sections.append(
            {
                "label": "구간별 흐름",
                "body": " ".join(
                    f"{format_caption_time(float(segment['start']))} {segment['text']}"
                    for segment in sample_summary_segments(segments)
                ),
            }
        )
        sections.append(
            {
                "label": "학습 포인트",
                "body": (
                    "타임스탬프가 있는 전사문을 보면서 반복되는 표현, 예시, 정의를 표시하세요. "
                    "이해가 흔들리는 구간은 마크 기능으로 저장한 뒤 다시 확인하면 복습 흐름을 만들 수 있습니다."
                ),
            }
        )

    if (
        stored_notes
        and stored_notes != stored_summary
        and text_looks_korean(stored_notes)
    ):
        sections.append({"label": "저장된 노트", "body": stored_notes[:900]})

    sections.append(
        {
            "label": "복습 질문",
            "body": (
                "이 영상의 핵심 주제는 무엇이었나요? 새로 배운 표현이나 개념은 무엇인가요? "
                "바로 적용할 수 있는 예시는 무엇인지 스스로 답해보세요."
            ),
        }
    )

    return sections[:6] or [
        {
            "label": "요약 준비 중",
            "body": "자막이나 영상 분석 데이터를 불러오면 이 영역에 한국어 학습 정리가 표시됩니다.",
        }
    ]


def fallback_video_summary_sections(
    title: str,
    channel_name: str,
    stored_summary: str,
    stored_notes: str,
    segments: list[dict[str, Any]],
) -> list[dict[str, str]]:
    sections: list[dict[str, str]] = []
    context = " ".join(
        part for part in [title, channel_name, stored_summary] if part
    ).strip()

    if context:
        sections.append(
            {
                "label": "핵심 요약",
                "body": (
                    f"{context} 이 영상은 위 주제를 학습하기 위한 자료입니다. "
                    "자동 상세 요약을 만들 수 없는 경우라 저장된 설명과 영상 분석 요약 일부를 기준으로 정리했습니다."
                ),
            }
        )

    if segments:
        sections.append(
            {
                "label": "구간별 흐름",
                "body": " ".join(
                    f"{format_caption_time(float(segment['start']))} {segment['text']}"
                    for segment in sample_summary_segments(segments)
                ),
            }
        )

        sections.append(
            {
                "label": "학습 포인트",
                "body": (
                    "자막에서 반복되는 표현과 예시를 중심으로 들으며, 이해가 안 되는 구간은 "
                    "마킹 기능으로 저장해 다시 확인하세요. 특히 영상 초반의 문제 제기, 중반의 예시, "
                    "후반의 정리 문장을 나누어 복습하면 흐름을 잡기 쉽습니다."
                ),
            }
        )

    if stored_notes and stored_notes != stored_summary:
        sections.append({"label": "저장된 노트", "body": stored_notes[:900]})

    sections.append(
        {
            "label": "복습 질문",
            "body": (
                "영상의 핵심 주제는 무엇이었는지, 새롭게 배운 표현이나 개념은 무엇인지, "
                "바로 적용해볼 수 있는 예시는 무엇인지 스스로 답해보세요."
            ),
        }
    )

    return sections[:6] or [
        {
            "label": "요약 준비 중",
            "body": "자막이나 영상 분석 데이터를 불러오면 이 영역에 자세한 학습 정리가 표시됩니다.",
        }
    ]


def sample_summary_segments(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if len(segments) <= 8:
        return segments

    step = max(1, len(segments) // 8)
    sampled = [segments[index] for index in range(0, len(segments), step)]

    return sampled[:8]


def format_caption_time(total_seconds: float) -> str:
    minutes = int(max(0, total_seconds) // 60)
    seconds = int(max(0, total_seconds) % 60)

    return f"{minutes:02d}:{seconds:02d}"


def fetch_youtube_caption_tracks(video_id: str) -> list[dict[str, Any]]:
    if httpx is None:
        return []

    response = httpx.get(
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
    if httpx is None:
        return [], None

    last_error: Exception | None = None

    for caption_url in urls:
        try:
            request_url = caption_url_with_recovery_params(caption_url, video_id)
            response = httpx.get(
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


def fetch_yt_dlp_caption_segments(
    video_id: str,
    target_language: str,
) -> tuple[list[dict[str, Any]], str, bool, Exception | None]:
    if httpx is None:
        return [], "", False, RuntimeError("http-client-unavailable")

    metadata, metadata_error = fetch_yt_dlp_metadata(video_id)

    if not metadata:
        return [], "", False, metadata_error

    prefer_source_captions = can_translate_captions_with_openai()
    candidate = choose_yt_dlp_caption_candidate(
        metadata,
        target_language,
        prefer_source_captions=prefer_source_captions,
    )

    if not candidate:
        return [], "", False, RuntimeError("yt-dlp-caption-track-unavailable")

    segments, segment_error = fetch_caption_segments_from_urls(
        [candidate["url"]],
        video_id,
    )

    if not segments:
        fallback_language = (
            candidate["sourceLanguage"] if prefer_source_captions else target_language
        )
        file_segments, file_language, file_translated, file_error = (
            fetch_yt_dlp_caption_file_segments(
                video_id,
                fallback_language,
                target_language,
            )
        )

        if file_segments:
            return file_segments, file_language, file_translated, None

        segment_error = file_error or segment_error

    return (
        segments,
        candidate["sourceLanguage"],
        bool(candidate["translated"]),
        segment_error,
    )


def fetch_yt_dlp_metadata(video_id: str) -> tuple[dict[str, Any] | None, Exception | None]:
    last_error: Exception | None = None
    url = f"https://www.youtube.com/watch?v={video_id}"

    with yt_dlp_secret_config_args() as secret_config_args:
        for command in yt_dlp_commands():
            try:
                result = subprocess.run(
                    [
                        *command,
                        *yt_dlp_recovery_args(),
                        *secret_config_args,
                        *ffmpeg_location_args(),
                        "--dump-json",
                        "--skip-download",
                        "--ignore-no-formats",
                        "--no-warnings",
                        "--no-playlist",
                        url,
                    ],
                    capture_output=True,
                    check=False,
                    env=youtube_subprocess_environment(),
                    text=True,
                    timeout=25,
                )

                if result.returncode != 0:
                    last_error = sanitized_caption_exception(
                        RuntimeError(result.stderr or "yt-dlp failed")
                    )
                    continue

                data = json.loads(result.stdout)

                if isinstance(data, dict):
                    return data, None
            except Exception as exc:
                last_error = sanitized_caption_exception(exc)

    return None, last_error or RuntimeError("yt-dlp is not installed")


def fetch_yt_dlp_caption_file_segments(
    video_id: str,
    subtitle_language: str,
    target_language: str | None = None,
) -> tuple[list[dict[str, Any]], str, bool, Exception | None]:
    last_error: Exception | None = None
    url = f"https://www.youtube.com/watch?v={video_id}"

    with tempfile.TemporaryDirectory(prefix="studytube-captions-") as temp_dir:
        temp_path = Path(temp_dir)
        output_template = str(temp_path / "%(id)s.%(ext)s")

        with yt_dlp_secret_config_args() as secret_config_args:
            for command in yt_dlp_commands():
                for languages in yt_dlp_subtitle_language_attempts(subtitle_language):
                    try:
                        cleanup_temp_caption_files(temp_path)
                        result = subprocess.run(
                            [
                                *command,
                                *yt_dlp_recovery_args(),
                                *secret_config_args,
                                *ffmpeg_location_args(),
                                "--skip-download",
                                "--ignore-no-formats",
                                "--write-subs",
                                "--write-auto-subs",
                                "--sub-langs",
                                languages,
                                "--sub-format",
                                "json3/vtt/srv3/best",
                                "--no-warnings",
                                "--no-playlist",
                                "-o",
                                output_template,
                                url,
                            ],
                            capture_output=True,
                            check=False,
                            env=youtube_subprocess_environment(),
                            text=True,
                            timeout=45,
                        )

                        if result.returncode != 0:
                            last_error = sanitized_caption_exception(
                                RuntimeError(
                                    result.stderr or "yt-dlp subtitle download failed"
                                )
                            )
                            continue

                        parsed = parse_best_yt_dlp_subtitle_file(
                            temp_path,
                            subtitle_language,
                        )

                        if parsed:
                            segments, language = parsed
                            translated_target = target_language or subtitle_language

                            return (
                                segments,
                                language,
                                normalize_language(language) != translated_target,
                                None,
                            )
                    except Exception as exc:
                        last_error = sanitized_caption_exception(exc)

    return [], "", False, last_error or RuntimeError("yt-dlp subtitle download failed")


def yt_dlp_subtitle_language_attempts(target_language: str) -> list[str]:
    attempts = [
        ",".join(dict.fromkeys([target_language, "en", "ko"])),
    ]
    source_languages = ["en", "ko"]

    for language in source_languages:
        if language != target_language and language not in attempts:
            attempts.append(language)

    return attempts


def cleanup_temp_caption_files(directory: Path) -> None:
    for path in directory.iterdir():
        if path.is_file():
            try:
                path.unlink()
            except OSError:
                pass


def parse_best_yt_dlp_subtitle_file(
    directory: Path,
    target_language: str,
) -> tuple[list[dict[str, Any]], str] | None:
    files = [
        path
        for path in directory.iterdir()
        if path.is_file() and path.suffix.lower() in {".json3", ".vtt", ".srv3", ".ttml"}
    ]

    def rank(path: Path) -> tuple[int, int]:
        language = infer_yt_dlp_subtitle_language(path)
        extension_rank = {".json3": 0, ".srv3": 1, ".ttml": 2, ".vtt": 3}.get(
            path.suffix.lower(),
            9,
        )

        return (0 if language == target_language else 1, extension_rank)

    for path in sorted(files, key=rank):
        segments = parse_yt_dlp_subtitle_file(path)

        if segments:
            return segments, infer_yt_dlp_subtitle_language(path) or target_language

    return None


def infer_yt_dlp_subtitle_language(path: Path) -> str:
    parts = path.name.split(".")

    if len(parts) >= 3:
        return normalize_language(parts[-2])

    return ""


def parse_yt_dlp_subtitle_file(path: Path) -> list[dict[str, Any]]:
    raw_text = path.read_text(encoding="utf-8", errors="ignore")
    suffix = path.suffix.lower()

    if suffix == ".json3":
        try:
            data = json.loads(raw_text)
        except json.JSONDecodeError:
            return []

        return parse_json3_timedtext(data) if isinstance(data, dict) else []

    if suffix == ".vtt":
        return parse_webvtt_timedtext(raw_text)

    return parse_xml_timedtext(raw_text)


def yt_dlp_commands() -> list[list[str]]:
    configured = os.getenv("YT_DLP_PATH")
    commands: list[list[str]] = []

    if configured:
        commands.append([configured])

    executable = shutil.which("yt-dlp")

    if executable:
        commands.append([executable])

    if importlib.util.find_spec("yt_dlp") is not None:
        commands.append([sys.executable, "-m", "yt_dlp"])

    return commands


def yt_dlp_recovery_args() -> list[str]:
    args: list[str] = []
    js_runtime = os.getenv("YT_DLP_JS_RUNTIME", "").strip()
    if js_runtime:
        args.extend(["--js-runtimes", js_runtime])

    if truthy_env("YT_DLP_ALLOW_REMOTE_COMPONENTS"):
        args.extend(["--remote-components", "ejs:github"])

    bgutil_server_home = youtube_bgutil_server_home()
    if bgutil_server_home:
        args.extend(
            [
                "--extractor-args",
                f"youtubepot-bgutilscript:server_home={bgutil_server_home}",
            ]
        )

    cookies_file = os.getenv("YOUTUBE_COOKIES_FILE", "").strip()
    if cookies_file:
        args.extend(["--cookies", cookies_file])

    cookies_browser = os.getenv("YOUTUBE_COOKIES_FROM_BROWSER", "").strip()
    if cookies_browser:
        args.extend(["--cookies-from-browser", cookies_browser])

    return args


def yt_dlp_sensitive_recovery_args() -> list[str]:
    args: list[str] = []
    extractor_settings: list[str] = []
    for po_token in split_env_values(os.getenv("YOUTUBE_PO_TOKEN")):
        extractor_settings.append(f"po_token={po_token}")

    visitor_data = os.getenv("YOUTUBE_VISITOR_DATA", "").strip()
    if visitor_data:
        extractor_settings.append(f"visitor_data={visitor_data}")

    if youtube_bgutil_server_home():
        extractor_settings.append(
            f"fetch_pot={os.getenv('YT_DLP_FETCH_PO_TOKEN', 'always').strip() or 'always'}"
        )

    extra_extractor_args = os.getenv("YT_DLP_YOUTUBE_EXTRACTOR_ARGS", "").strip()
    if extra_extractor_args:
        extractor_settings.append(extra_extractor_args)

    if extractor_settings:
        args.extend(["--extractor-args", f"youtube:{';'.join(extractor_settings)}"])

    proxy_url = os.getenv("YOUTUBE_PROXY_URL", "").strip()
    if proxy_url:
        args.extend(["--proxy", proxy_url])

    return args


@contextmanager
def yt_dlp_secret_config_args():
    sensitive_args = yt_dlp_sensitive_recovery_args()
    if not sensitive_args:
        yield []
        return

    descriptor, config_path = tempfile.mkstemp(
        prefix="studytube-yt-dlp-",
        suffix=".conf",
        text=True,
    )
    try:
        if hasattr(os, "fchmod"):
            os.fchmod(descriptor, 0o600)
        else:
            os.chmod(config_path, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as config_file:
            descriptor = -1
            for index in range(0, len(sensitive_args), 2):
                option = sensitive_args[index]
                value = sensitive_args[index + 1]
                config_file.write(f"{option} {shlex.quote(value)}\n")
            config_file.flush()
            os.fsync(config_file.fileno())
        yield ["--config-locations", config_path]
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        try:
            os.unlink(config_path)
        except FileNotFoundError:
            pass


def youtube_subprocess_environment() -> dict[str, str]:
    allowed_names = (
        "PATH",
        "HOME",
        "XDG_CACHE_HOME",
        "LANG",
        "LC_ALL",
        "TMPDIR",
        "TEMP",
        "TMP",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "REQUESTS_CA_BUNDLE",
        "CURL_CA_BUNDLE",
        "NO_PROXY",
        "no_proxy",
        "SYSTEMROOT",
        "WINDIR",
        "PATHEXT",
        "COMSPEC",
    )
    environment = {
        name: value
        for name in allowed_names
        if (value := os.getenv(name)) is not None
    }
    proxy_url = os.getenv("YOUTUBE_PROXY_URL", "").strip()
    if proxy_url:
        environment["HTTP_PROXY"] = proxy_url
        environment["HTTPS_PROXY"] = proxy_url
        environment["NODE_USE_ENV_PROXY"] = "1"
    return environment


def caption_url_with_recovery_params(caption_url: str, video_id: str = "") -> str:
    subtitle_po_token = youtube_subtitle_po_token(video_id)
    if not subtitle_po_token:
        return caption_url

    parsed = urlparse(caption_url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))

    if query.get("pot"):
        return caption_url

    client, token = subtitle_po_token

    return append_query_params(
        caption_url,
        {
            "c": client,
            "pot": token,
            "potc": "1",
        },
    )


def youtube_subtitle_po_token(video_id: str = "") -> tuple[str, str] | None:
    explicit_token = explicit_youtube_subtitle_po_token()
    if explicit_token:
        return explicit_token

    return generated_youtube_subtitle_po_token(video_id)


def explicit_youtube_subtitle_po_token() -> tuple[str, str] | None:
    for po_token in split_env_values(os.getenv("YOUTUBE_PO_TOKEN")):
        metadata, separator, token = po_token.partition("+")

        if not separator:
            return "WEB", po_token

        if not token:
            continue

        metadata_parts = [part for part in metadata.split(".") if part]
        client = metadata_parts[0] if metadata_parts else "web"
        contexts = {part.lower() for part in metadata_parts[1:]}

        if contexts and "subs" not in contexts:
            continue

        return client.upper(), token

    return None


def generated_youtube_subtitle_po_token(video_id: str) -> tuple[str, str] | None:
    normalized_video_id = str(video_id or "").strip()
    if not normalized_video_id or not truthy_env_default(
        "YOUTUBE_AUTO_SUBTITLE_PO_TOKEN",
        True,
    ):
        return None

    cached = YOUTUBE_SUBTITLE_PO_TOKEN_CACHE.get(normalized_video_id)
    if cached and time.time() - cached[0] < YOUTUBE_SUBTITLE_PO_TOKEN_CACHE_TTL_SECONDS:
        return cached[1]

    token = generate_bgutil_subtitle_po_token(normalized_video_id)
    if not token:
        return None

    response = ("WEB", token)
    YOUTUBE_SUBTITLE_PO_TOKEN_CACHE[normalized_video_id] = (time.time(), response)

    return response


def generate_bgutil_subtitle_po_token(video_id: str) -> str:
    server_home = youtube_bgutil_server_home()
    if not server_home:
        return ""

    node_path = youtube_node_runtime_path()
    script_path = Path(server_home) / "build" / "generate_once.js"
    if not node_path or not script_path.exists():
        return ""

    command = [node_path, str(script_path), "-c", video_id]

    try:
        result = subprocess.run(
            command,
            capture_output=True,
            env=youtube_subprocess_environment(),
            text=True,
            timeout=45,
            check=False,
        )
    except Exception:
        return ""

    if result.returncode:
        return ""

    for line in reversed(result.stdout.splitlines()):
        candidate = line.strip()
        if not candidate.startswith("{"):
            continue

        try:
            data = json.loads(candidate)
        except json.JSONDecodeError:
            continue

        token = data.get("poToken")
        if isinstance(token, str) and token:
            return token

    return ""


def youtube_bgutil_server_home() -> str:
    configured = os.getenv("YOUTUBE_BGUTIL_SERVER_HOME", "").strip()
    candidates = [Path(configured)] if configured else []
    candidates.append(ROOT_DIR / ".tools" / "bgutil-ytdlp-pot-provider" / "server")

    for candidate in candidates:
        if candidate and (candidate / "build" / "generate_once.js").exists():
            return str(candidate)

    return ""


def youtube_node_runtime_path() -> str:
    js_runtime = os.getenv("YT_DLP_JS_RUNTIME", "").strip()
    if js_runtime:
        _runtime, _separator, runtime_path = js_runtime.partition(":")
        if runtime_path:
            return runtime_path

    return shutil.which("node") or ""


def sanitized_caption_exception(exc: Exception) -> Exception:
    message = str(exc)
    if "429" in message or "Too Many Requests" in message:
        return RuntimeError("youtube-caption-http-429")
    if isinstance(exc, subprocess.TimeoutExpired):
        return RuntimeError("youtube-caption-upstream-timeout")
    return RuntimeError("youtube-caption-upstream-failed")


def split_env_values(value: str | None) -> list[str]:
    if not value:
        return []

    return [part.strip() for part in value.replace(",", ";").split(";") if part.strip()]


def truthy_env(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


def truthy_env_default(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default

    return value.strip().lower() in {"1", "true", "yes", "on"}


def ffmpeg_location_args() -> list[str]:
    configured = os.getenv("FFMPEG_PATH")

    if configured:
        return ["--ffmpeg-location", configured]

    executable = shutil.which("ffmpeg")

    if executable:
        return ["--ffmpeg-location", executable]

    if imageio_ffmpeg is not None:
        try:
            return ["--ffmpeg-location", imageio_ffmpeg.get_ffmpeg_exe()]
        except Exception:
            return []

    return []


def choose_yt_dlp_caption_candidate(
    metadata: dict[str, Any],
    target_language: str,
    *,
    prefer_source_captions: bool = False,
) -> dict[str, Any] | None:
    if prefer_source_captions:
        source = find_yt_dlp_caption_candidate(
            metadata,
            target_language,
            allow_any_language=True,
            prefer_untranslated=True,
        )

        if source:
            return source

    exact = find_yt_dlp_caption_candidate(
        metadata,
        target_language,
        allow_any_language=False,
        prefer_untranslated=False,
    )

    if exact:
        return exact

    return find_yt_dlp_caption_candidate(
        metadata,
        target_language,
        allow_any_language=True,
        prefer_untranslated=False,
    )


def find_yt_dlp_caption_candidate(
    metadata: dict[str, Any],
    target_language: str,
    *,
    allow_any_language: bool,
    prefer_untranslated: bool,
) -> dict[str, Any] | None:
    groups = [
        metadata.get("subtitles") if isinstance(metadata.get("subtitles"), dict) else {},
        (
            metadata.get("automatic_captions")
            if isinstance(metadata.get("automatic_captions"), dict)
            else {}
        ),
    ]
    preferred_sources = [
        language
        for language in ["en", "ko", "ja", "zh"]
        if language != target_language
    ]

    for tracks in groups:
        languages = list(tracks.keys())

        if prefer_untranslated:
            ordered_languages = [
                *[
                    language
                    for preferred in preferred_sources
                    for language in languages
                    if normalize_language(language) == preferred
                    and yt_dlp_language_has_untranslated_entry(tracks, language)
                ],
                *[
                    language
                    for language in languages
                    if normalize_language(language) != target_language
                    if yt_dlp_language_has_untranslated_entry(tracks, language)
                ],
                *[
                    language
                    for language in languages
                    if normalize_language(language) == target_language
                    and yt_dlp_language_has_untranslated_entry(tracks, language)
                ],
                *languages,
            ]
        elif allow_any_language:
            ordered_languages = [
                *[
                    language
                    for preferred in preferred_sources
                    for language in languages
                    if normalize_language(language) == preferred
                ],
                *languages,
            ]
        else:
            ordered_languages = [
                language
                for language in languages
                if normalize_language(language) == target_language
            ]

        for language in dict.fromkeys(ordered_languages):
            entries = tracks.get(language)

            if not isinstance(entries, list):
                continue

            entry = choose_yt_dlp_caption_entry(
                entries,
                prefer_untranslated=prefer_untranslated,
            )

            if entry:
                source_language = yt_dlp_caption_source_language(
                    language,
                    entry["url"],
                )

                return {
                    "url": entry["url"],
                    "sourceLanguage": source_language,
                    "translated": caption_url_requests_translation(entry["url"]),
                }

    return None


def yt_dlp_language_has_untranslated_entry(
    tracks: dict[str, Any],
    language: str,
) -> bool:
    entries = tracks.get(language)

    if not isinstance(entries, list):
        return False

    return any(
        isinstance(entry, dict)
        and isinstance(entry.get("url"), str)
        and not caption_url_requests_translation(str(entry["url"]))
        for entry in entries
    )


def choose_yt_dlp_caption_entry(
    entries: list[Any],
    *,
    prefer_untranslated: bool = False,
) -> dict[str, str] | None:
    valid_entries = [
        entry
        for entry in entries
        if isinstance(entry, dict) and isinstance(entry.get("url"), str)
    ]
    if prefer_untranslated:
        untranslated_entries = [
            entry
            for entry in valid_entries
            if not caption_url_requests_translation(str(entry["url"]))
        ]

        if untranslated_entries:
            valid_entries = untranslated_entries

    preferred_extensions = ["json3", "srv3", "ttml", "vtt"]

    for extension in preferred_extensions:
        for entry in valid_entries:
            if str(entry.get("ext") or "").lower() == extension:
                return {"url": str(entry["url"])}

    if valid_entries:
        return {"url": str(valid_entries[0]["url"])}

    return None


def yt_dlp_caption_source_language(language: str, url: str) -> str:
    return (
        caption_url_query_language(url, "lang")
        or normalize_language(language)
        or "youtube"
    )


def caption_url_requests_translation(url: str) -> bool:
    return bool(caption_url_query_language(url, "tlang"))


def caption_url_query_language(url: str, name: str) -> str:
    try:
        parsed = urlparse(url)
        query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    except Exception:
        return ""

    return normalize_language(query.get(name) or "")


def append_query_params(url: str, params: dict[str, str]) -> str:
    parsed = urlparse(url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query.update(params)

    return urlunparse(parsed._replace(query=urlencode(query)))


def translate_caption_segments(
    segments: list[dict[str, Any]],
    target_language: str,
) -> list[dict[str, Any]]:
    if not segments or OpenAI is None or not os.getenv("OPENAI_API_KEY"):
        return []

    source_segments = normalize_caption_segments(segments)
    normalized_segments = compact_caption_segments_for_translation(source_segments)
    use_concise_subtitles = len(normalized_segments) < len(source_segments)
    batches = [
        normalized_segments[index : index + CAPTION_TRANSLATION_BATCH_SIZE]
        for index in range(0, len(normalized_segments), CAPTION_TRANSLATION_BATCH_SIZE)
    ]
    translated_segments: list[dict[str, Any]] = []

    try:  # pragma: no cover - live credentials are optional in local tests
        client = OpenAI()
        max_workers = min(CAPTION_TRANSLATION_MAX_WORKERS, len(batches))

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = [
                executor.submit(
                    translate_caption_batch,
                    client,
                    batch,
                    target_language,
                    use_concise_subtitles,
                )
                for batch in batches
            ]

            batch_translations = [future.result() for future in futures]

        for batch, translations in zip(batches, batch_translations):

            if len(translations) != len(batch):
                return []

            for segment, text in zip(batch, translations):
                translated_segments.append(
                    {
                        "start": segment["start"],
                        "end": segment["end"],
                        "text": clean_caption_text(text) or segment["text"],
                    }
                )

        return translated_segments
    except Exception:
        return []


def compact_caption_segments_for_translation(
    segments: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if len(segments) < CAPTION_TRANSLATION_COMPACT_THRESHOLD:
        if len(segments) <= CAPTION_TRANSLATION_TARGET_SEGMENTS:
            return segments

        return compact_caption_segments_to_budget(
            segments,
            CAPTION_TRANSLATION_TARGET_SEGMENTS,
        )

    compacted: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None

    for segment in segments:
        if current is None:
            current = {
                "start": segment["start"],
                "end": segment["end"],
                "text": segment["text"],
            }
            continue

        next_text = clean_caption_text(f"{current['text']} {segment['text']}")
        next_duration = float(segment["end"]) - float(current["start"])

        if (
            next_duration <= CAPTION_TRANSLATION_COMPACT_MAX_DURATION_SECONDS
            and len(next_text) <= CAPTION_TRANSLATION_COMPACT_MAX_CHARS
        ):
            current["end"] = segment["end"]
            current["text"] = next_text
            continue

        compacted.append(current)
        current = {
            "start": segment["start"],
            "end": segment["end"],
            "text": segment["text"],
        }

    if current is not None:
        compacted.append(current)

    if len(compacted) > CAPTION_TRANSLATION_TARGET_SEGMENTS:
        return compact_caption_segments_to_budget(
            compacted,
            CAPTION_TRANSLATION_TARGET_SEGMENTS,
        )

    return compacted


def compact_caption_segments_to_budget(
    segments: list[dict[str, Any]],
    max_segments: int,
) -> list[dict[str, Any]]:
    if max_segments <= 0 or len(segments) <= max_segments:
        return segments

    compacted: list[dict[str, Any]] = []
    segment_count = len(segments)

    for index in range(max_segments):
        start_index = (index * segment_count) // max_segments
        end_index = ((index + 1) * segment_count) // max_segments

        if end_index <= start_index:
            end_index = start_index + 1

        group = segments[start_index:end_index]
        if not group:
            continue

        text = clean_caption_text(
            " ".join(str(segment.get("text") or "") for segment in group)
        )
        if not text:
            continue

        compacted.append(
            {
                "start": group[0]["start"],
                "end": group[-1]["end"],
                "text": text,
            }
        )

    return compacted


def translate_caption_batch(
    client: Any,
    batch: list[dict[str, Any]],
    target_language: str,
    use_concise_subtitles: bool = False,
) -> list[str]:
    texts = [str(segment.get("text") or "") for segment in batch]
    translations = request_caption_translations(
        client,
        texts,
        target_language,
        use_concise_subtitles,
    )

    if len(translations) == len(texts):
        return translations

    if len(batch) <= 1:
        return []

    midpoint = max(1, len(batch) // 2)
    left = translate_caption_batch(
        client,
        batch[:midpoint],
        target_language,
        use_concise_subtitles,
    )
    right = translate_caption_batch(
        client,
        batch[midpoint:],
        target_language,
        use_concise_subtitles,
    )

    if len(left) + len(right) == len(batch):
        return [*left, *right]

    return []


def request_caption_translations(
    client: Any,
    texts: list[str],
    target_language: str,
    use_concise_subtitles: bool = False,
) -> list[str]:
    target_language_name = caption_translation_language_name(target_language)
    system_prompt = (
        "Translate YouTube caption segments into the requested target language. "
        "Keep the number and order of segments exactly the same. "
        "Return only a JSON object with a translations array of strings. "
        f"The translations array must contain exactly {len(texts)} strings."
    )

    if use_concise_subtitles:
        length_guidance = caption_translation_length_guidance(target_language)
        system_prompt = (
            "Translate each YouTube caption window "
            f"into {target_language_name} for on-screen subtitles. "
            "Keep the same count and order. "
            "Condense each item to one or two natural "
            f"{target_language_name} subtitle sentences, {length_guidance}. "
            "Preserve concrete technical meaning, names, and code terms. "
            "Return only JSON with a translations array containing exactly "
            f"{len(texts)} strings."
        )

    try:
        response = client.chat.completions.create(
            model=os.getenv("LLM_MODEL", "gpt-4o-mini"),
            temperature=0,
            response_format={"type": "json_object"},
            timeout=CAPTION_TRANSLATION_REQUEST_TIMEOUT_SECONDS,
            messages=[
                {
                    "role": "system",
                    "content": system_prompt,
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "targetLanguage": target_language,
                            "requiredCount": len(texts),
                            "segments": texts,
                        },
                        ensure_ascii=False,
                    ),
                },
            ],
        )
        content = getattr(response.choices[0].message, "content", "") or ""

        return parse_caption_translations(content)
    except Exception:
        return []


def caption_translation_language_name(target_language: str) -> str:
    language = normalize_language(target_language)

    if language == "ko":
        return "Korean"

    if language == "en":
        return "English"

    return language or "the requested target language"


def caption_translation_length_guidance(target_language: str) -> str:
    language = normalize_language(target_language)

    if language == "ko":
        return "roughly 160 Korean characters or less"

    if language == "en":
        return "roughly 45 English words or less"

    return "compact enough for on-screen display"


def translate_fallback_text(text: str, target_language: str) -> str:
    source_text = clean_caption_text(text)

    if not source_text or OpenAI is None or not os.getenv("OPENAI_API_KEY"):
        return ""

    try:  # pragma: no cover - live credentials are optional in local tests
        client = OpenAI()
        response = client.chat.completions.create(
            model=os.getenv("LLM_MODEL", "gpt-4o-mini"),
            temperature=0,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Translate the provided YouTube study caption text into "
                        "the requested target language. Preserve meaning and useful "
                        "technical terms. Return only the translated text."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "targetLanguage": target_language,
                            "text": source_text,
                        },
                        ensure_ascii=False,
                    ),
                },
            ],
        )
        content = getattr(response.choices[0].message, "content", "") or ""
        translated = clean_caption_text(content).strip()

        if (
            len(translated) >= 3
            and translated.startswith('"')
            and translated.endswith('"')
        ):
            translated = translated[1:-1].strip()

        return translated
    except Exception:
        return ""


def fetch_transcript_api_segments(
    video_id: str,
    target_language: str,
) -> tuple[list[dict[str, Any]], str, bool]:
    if YouTubeTranscriptApi is None:
        return [], "", False

    try:  # pragma: no cover - live YouTube transcript access varies by network
        transcript_list = list_youtube_transcripts(video_id)
        translated = False
        source_language = target_language

        try:
            transcript = transcript_list.find_transcript([target_language])
        except Exception:
            transcript = transcript_list.find_transcript(
                ["en", "en-US", "en-GB", "ko"]
            )
            source_language = normalize_language(
                getattr(transcript, "language_code", "")
            )

            if source_language != target_language and hasattr(transcript, "translate"):
                transcript = transcript.translate(target_language)
                translated = True

        segments = parse_transcript_api_rows(transcript.fetch())

        return segments, source_language or target_language, translated
    except Exception:
        return [], "", False


def list_youtube_transcripts(video_id: str) -> Any:
    if hasattr(YouTubeTranscriptApi, "list_transcripts"):
        return YouTubeTranscriptApi.list_transcripts(video_id)

    transcript_api = YouTubeTranscriptApi()

    if hasattr(transcript_api, "list"):
        return transcript_api.list(video_id)

    raise RuntimeError("youtube-transcript-api has no transcript listing method")


def transcript_api_caption_response(
    video_id: str,
    target_language: str,
    source_language: str,
    translated: bool,
    segments: list[dict[str, Any]],
) -> dict[str, Any]:
    normalized_segments = normalize_caption_segments(segments)

    if normalized_segments and not caption_segments_match_language(
        normalized_segments,
        target_language,
    ):
        translated_segments = translate_caption_segments(
            normalized_segments,
            target_language,
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
                "message": "YouTube transcript captions translated for live playback.",
            }

    return {
        "mode": "youtube-captions",
        "provider": "youtube-transcript-api",
        "videoId": video_id,
        "language": target_language,
        "sourceLanguage": source_language or "youtube",
        "translated": translated,
        "segments": normalized_segments,
        "sourceSegments": [] if translated else normalized_segments,
        "translatedSegments": normalized_segments if translated else [],
        "message": "YouTube transcript API captions loaded for live playback.",
    }


def yt_dlp_caption_response(
    video_id: str,
    target_language: str,
    source_language: str,
    translated: bool,
    segments: list[dict[str, Any]],
    cache_key: str = "",
    caption_window: tuple[float, float] | None = None,
) -> dict[str, Any]:
    normalized_segments = normalize_caption_segments(segments)
    normalized_source_language = normalize_language(source_language) or "youtube"

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
                "sourceLanguage": normalized_source_language,
                "translated": True,
                "segments": translated_segments,
                "sourceSegments": normalized_segments,
                "translatedSegments": translated_segments,
                "message": "yt-dlp source caption window translated for live playback.",
            }

        response = source_caption_response(
            video_id,
            target_language,
            normalized_source_language,
            normalized_segments,
            "yt-dlp source captions loaded while translation is unavailable.",
        )
        schedule_caption_translation(
            cache_key,
            video_id,
            target_language,
            normalized_source_language,
            translation_segments or normalized_segments,
        )
        return response

    return {
        "mode": "youtube-captions",
        "provider": "yt-dlp-captions",
        "videoId": video_id,
        "language": target_language,
        "sourceLanguage": normalized_source_language,
        "translated": translated,
        "segments": normalized_segments,
        "sourceSegments": [] if translated else normalized_segments,
        "translatedSegments": normalized_segments if translated else [],
        "message": "yt-dlp captions loaded for live playback.",
    }


def source_caption_response(
    video_id: str,
    target_language: str,
    source_language: str,
    segments: list[dict[str, Any]],
    message: str,
) -> dict[str, Any]:
    return {
        "mode": "youtube-captions",
        "provider": "youtube-source-captions",
        "videoId": video_id,
        "language": target_language,
        "sourceLanguage": normalize_language(source_language) or "youtube",
        "translated": False,
        "segments": normalize_caption_segments(segments),
        "sourceSegments": normalize_caption_segments(segments),
        "translatedSegments": [],
        "message": message,
    }


def native_caption_response(
    video_id: str,
    target_language: str,
    source_language: str,
    reason: str,
) -> dict[str, Any]:
    return {
        "mode": "youtube-captions",
        "provider": "youtube-native-captions",
        "videoId": video_id,
        "language": target_language,
        "sourceLanguage": normalize_language(source_language) or "youtube",
        "translated": False,
        "segments": [],
        "message": f"YouTube native captions are available in the player; server timed-text fetch failed: {reason}",
    }


def caption_rate_limited_response(
    video_id: str,
    target_language: str,
    source_language: str,
    reason: str,
) -> dict[str, Any]:
    return {
        "mode": "youtube-captions",
        "provider": "youtube-caption-rate-limited",
        "videoId": video_id,
        "language": target_language,
        "sourceLanguage": normalize_language(source_language) or "youtube",
        "translated": False,
        "segments": [],
        "message": (
            "YouTube timed-text caption download was blocked with HTTP 429. "
            "Configure a yt-dlp subtitle PO token, approved JS challenge solver, "
            f"cookies, or proxy for server-side caption retrieval: {reason}"
        ),
    }


def parse_transcript_api_rows(rows: Any) -> list[dict[str, Any]]:
    segments: list[dict[str, Any]] = []

    for row in rows or []:
        text = clean_caption_text(
            str(read_transcript_field(row, "text") or "")
        )

        if not text:
            continue

        try:
            start = float(read_transcript_field(row, "start") or 0)
            duration = float(read_transcript_field(row, "duration") or 3)
        except (TypeError, ValueError):
            continue

        segments.append(
            {
                "start": round(start, 3),
                "end": round(max(start + duration, start + 0.5), 3),
                "text": text,
            }
        )

    return normalize_caption_segments(segments)


def read_transcript_field(row: Any, field: str) -> Any:
    if isinstance(row, dict):
        return row.get(field)

    return getattr(row, field, None)


def caption_translation_unavailable_reason() -> str:
    if OpenAI is None:
        return "caption-translation-unavailable: OpenAI package is not installed"

    if not os.getenv("OPENAI_API_KEY"):
        return "caption-translation-unavailable: OPENAI_API_KEY is not set"

    return "caption-translation-unavailable: model response did not preserve segments"


def parse_caption_translations(content: str) -> list[str]:
    normalized = content.strip()
    match = re.search(r"(\{.*\}|\[.*\])", normalized, re.S)

    if match:
        normalized = match.group(1)

    try:
        data = json.loads(normalized)
    except json.JSONDecodeError:
        return []

    if isinstance(data, dict):
        translations = data.get("translations") or data.get("segments")
    else:
        translations = data

    if not isinstance(translations, list):
        return []

    return [str(item) for item in translations]


def parse_timedtext_response(response: Any) -> list[dict[str, Any]]:
    try:
        data = response.json()
    except Exception:
        data = None

    if isinstance(data, dict):
        return parse_json3_timedtext(data)

    raw_text = getattr(response, "text", "")

    if "WEBVTT" in raw_text or "-->" in raw_text:
        return parse_webvtt_timedtext(raw_text)

    return parse_xml_timedtext(raw_text)


def parse_webvtt_timedtext(raw_text: str) -> list[dict[str, Any]]:
    segments: list[dict[str, Any]] = []
    lines = raw_text.replace("\ufeff", "").splitlines()
    index = 0

    while index < len(lines):
        line = lines[index].strip()

        if not line or line == "WEBVTT" or line.startswith(("NOTE", "STYLE", "REGION")):
            index += 1
            continue

        if "-->" not in line and index + 1 < len(lines) and "-->" in lines[index + 1]:
            index += 1
            line = lines[index].strip()

        if "-->" not in line:
            index += 1
            continue

        start_raw, end_raw = [part.strip() for part in line.split("-->", 1)]
        text_lines: list[str] = []
        index += 1

        while index < len(lines) and lines[index].strip():
            text_lines.append(lines[index].strip())
            index += 1

        text = clean_caption_text(
            re.sub(r"<[^>]+>", "", " ".join(text_lines))
        )

        if text:
            segments.append(
                {
                    "start": round(parse_vtt_timestamp(start_raw), 3),
                    "end": round(parse_vtt_timestamp(end_raw), 3),
                    "text": text,
                }
            )

        index += 1

    return normalize_caption_segments(segments)


def parse_vtt_timestamp(value: str) -> float:
    timestamp = value.split()[0].replace(",", ".")
    parts = timestamp.split(":")

    try:
        if len(parts) == 3:
            hours = float(parts[0])
            minutes = float(parts[1])
            seconds = float(parts[2])

            return hours * 3600 + minutes * 60 + seconds

        if len(parts) == 2:
            minutes = float(parts[0])
            seconds = float(parts[1])

            return minutes * 60 + seconds
    except ValueError:
        return 0

    return 0


def parse_json3_timedtext(data: dict[str, Any]) -> list[dict[str, Any]]:
    segments: list[dict[str, Any]] = []

    for event in data.get("events") or []:
        if not isinstance(event, dict):
            continue

        text = clean_caption_text(
            "".join(
                str(segment.get("utf8") or "")
                for segment in event.get("segs") or []
                if isinstance(segment, dict)
            )
        )

        if not text:
            continue

        start = round(float(event.get("tStartMs") or 0) / 1000, 3)
        duration = float(event.get("dDurationMs") or 3000) / 1000
        end = round(max(start + duration, start + 0.5), 3)
        segments.append({"start": start, "end": end, "text": text})

    return normalize_caption_segments(segments)


def parse_xml_timedtext(raw_xml: str) -> list[dict[str, Any]]:
    if not raw_xml.strip():
        return []

    try:
        root = ElementTree.fromstring(raw_xml)
    except ElementTree.ParseError:
        return []

    segments: list[dict[str, Any]] = []

    for node in root.findall(".//text"):
        text = clean_caption_text("".join(node.itertext()))

        if not text:
            continue

        try:
            start = float(node.attrib.get("start") or 0)
            duration = float(node.attrib.get("dur") or 3)
        except ValueError:
            continue

        segments.append(
            {
                "start": round(start, 3),
                "end": round(max(start + duration, start + 0.5), 3),
                "text": text,
            }
        )

    return normalize_caption_segments(segments)


def normalize_caption_segments(
    segments: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []

    for segment in segments:
        text = clean_caption_text(str(segment.get("text") or ""))

        if not text:
            continue

        try:
            start = float(segment.get("start") or 0)
            end = float(segment.get("end") or start + 3)
        except (TypeError, ValueError):
            continue

        if not math.isfinite(start) or not math.isfinite(end):
            continue

        start = max(0.0, start)
        end = max(end, start + 0.5)
        normalized.append(
            {
                "start": round(start, 3),
                "end": round(end, 3),
                "text": text,
            }
        )

    normalized.sort(key=lambda item: (item["start"], item["end"]))

    for index, segment in enumerate(normalized[:-1]):
        next_start = normalized[index + 1]["start"]

        if next_start > segment["start"] and segment["end"] > next_start:
            segment["end"] = round(next_start, 3)

        if segment["end"] <= segment["start"]:
            segment["end"] = round(segment["start"] + 0.5, 3)

    return normalized


def caption_segments_match_language(
    segments: list[dict[str, Any]],
    target_language: str,
) -> bool:
    language = normalize_language(target_language)

    if language not in {"ko", "en"}:
        return True

    sample = " ".join(str(segment.get("text") or "") for segment in segments[:30])
    hangul_count = len(re.findall(r"[\uac00-\ud7a3]", sample))
    latin_count = len(re.findall(r"[A-Za-z]", sample))
    letter_count = hangul_count + latin_count

    if letter_count == 0:
        return False

    if language == "ko":
        return hangul_count >= 5 and hangul_count / letter_count >= 0.2

    return latin_count >= 10 and hangul_count / letter_count <= 0.2


def fallback_caption_response(
    video_id: str,
    target_language: str,
    reason: str,
    fallback_text: str,
    allow_fallback: bool = True,
    translate_fallback: bool = False,
    duration_seconds: float | None = None,
) -> dict[str, Any]:
    return {
        "mode": "youtube-captions",
        "provider": "caption-source-unavailable",
        "videoId": video_id,
        "language": target_language,
        "sourceLanguage": "unavailable",
        "translated": False,
        "segments": [],
        "message": reason,
    }


def fallback_caption_segments(
    text: str,
    duration_seconds: float | None = None,
) -> list[dict[str, Any]]:
    chunks = chunk_text_for_captions(
        text
        or "YouTube caption data is unavailable, so saved study notes are shown instead."
        or "이 영상에서 사용할 수 있는 YouTube 자막 트랙을 찾지 못했습니다."
    )

    caption_duration = duration_seconds or DEFAULT_FALLBACK_CAPTION_DURATION_SECONDS
    slot_duration = max(caption_duration / max(len(chunks), 1), 2)
    segments: list[dict[str, Any]] = []

    for index, chunk in enumerate(chunks):
        start = round(index * slot_duration, 3)
        end = (
            round(caption_duration, 3)
            if index == len(chunks) - 1
            else round(max((index + 1) * slot_duration, start + 0.5), 3)
        )
        segments.append({"start": start, "end": end, "text": chunk})

    return segments


def align_caption_text_to_timing(
    text: str,
    timing_segments: list[dict[str, Any]],
    allow_fallback: bool = True,
) -> list[dict[str, Any]]:
    if not allow_fallback:
        return []

    if not timing_segments:
        return fallback_caption_segments(text)

    chunks = chunk_text_for_captions(
        text
        or "원문 자막 타이밍은 확인했지만 표시할 분석 요약이 비어 있습니다."
    )
    count = min(len(chunks), len(timing_segments), 80)

    if count <= 0:
        return fallback_caption_segments(text)

    aligned: list[dict[str, Any]] = []

    for index in range(count):
        start_index = math.floor(index * len(timing_segments) / count)
        end_index = max(
            start_index,
            math.ceil((index + 1) * len(timing_segments) / count) - 1,
        )
        timing = timing_segments[start_index]
        end_timing = timing_segments[min(end_index, len(timing_segments) - 1)]
        start = float(timing.get("start") or 0)
        end = float(end_timing.get("end") or start + 3)

        aligned.append(
            {
                "start": round(start, 3),
                "end": round(max(end, start + 0.5), 3),
                "text": chunks[index],
            }
        )

    return aligned


def chunk_text_for_captions(text: str) -> list[str]:
    sentences = split_caption_sentences(clean_caption_text(text))
    chunks: list[str] = []

    for sentence in sentences:
        words = sentence.split()

        if len(words) >= 4:
            for index in range(0, len(words), 8):
                chunks.append(" ".join(words[index : index + 8]))
        elif len(sentence) <= 38:
            chunks.append(sentence)
        else:
            for index in range(0, len(sentence), 34):
                chunks.append(sentence[index : index + 34])

    return chunks[:20] or [clean_caption_text(text)[:34]]


def split_caption_sentences(text: str) -> list[str]:
    parts = re.split(r"([.!?。]|다\.)\s*", text)
    sentences: list[str] = []
    current = ""

    for part in parts:
        if not part:
            continue

        current += part

        if re.fullmatch(r"[.!?。]|다\.", part):
            sentence = current.strip()

            if sentence:
                sentences.append(sentence)

            current = ""

    tail = current.strip()

    if tail:
        sentences.append(tail)

    return sentences or ([text] if text else [])


def clean_caption_text(text: str) -> str:
    return re.sub(r"\s+", " ", html_lib.unescape(text).replace("\n", " ")).strip()


def normalize_language(value: Any) -> str:
    return str(value or "").strip().lower().split("-")[0]


def normalize_caption_duration(value: Any) -> float | None:
    try:
        duration = float(value)
    except (TypeError, ValueError):
        return None

    if not math.isfinite(duration) or duration < 10:
        return None

    return min(round(duration, 3), 14400)


def json_rpc_error(request_id: Any, code: int, message: str) -> dict[str, Any]:
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "error": {
            "code": code,
            "message": message,
        },
    }


application_runtime = create_application(
    FeatureHandlers(
        embedding=lambda payload: create_embedding_response(payload),
        youtube_lookup=lambda payload: handle_mcp_request(payload),
        youtube_captions=lambda payload: load_translated_captions(payload),
        youtube_transcribe=lambda payload: transcribe_youtube_audio(payload),
        youtube_summary=lambda payload: build_youtube_summary(payload),
        study_plan=lambda payload: build_study_plan(payload),
        quiz_generation=lambda payload: build_quiz_response(payload),
        caption_health=lambda: youtube_caption_runtime_health(),
        openai_configured=lambda: OpenAI is not None
        and bool(os.getenv("OPENAI_API_KEY")),
    )
)
app = application_runtime.app
mcp_server = application_runtime.mcp_server
mcp_application = application_runtime.mcp_application
telemetry_runtime = application_runtime.telemetry_runtime
application_lifespan = application_runtime.application_lifespan
require_internal_service_key = application_runtime.require_internal_service_key
health = application_runtime.health
database_health = application_runtime.database_health
embeddings_endpoint = application_runtime.embeddings_endpoint
youtube_lookup_endpoint = application_runtime.youtube_lookup_endpoint
youtube_captions_endpoint = application_runtime.youtube_captions_endpoint
youtube_transcribe_endpoint = application_runtime.youtube_transcribe_endpoint
youtube_summary_endpoint = application_runtime.youtube_summary_endpoint
study_plan_endpoint = application_runtime.study_plan_endpoint
quiz_generation_endpoint = application_runtime.quiz_generation_endpoint
