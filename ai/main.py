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
import youtube_caption_tracks as caption_tracks_module
from youtube_caption_tracks import (
    CaptionTrackRuntime,
    build_caption_url,
    caption_candidate_urls,
    caption_request_headers,
    choose_caption_track,
    configure_caption_track_runtime,
    fetch_caption_segments_from_urls,
    fetch_youtube_caption_tracks,
    parse_json_assignment,
    parse_yt_initial_player_response,
    simple_timedtext_url,
    source_caption_candidate_urls,
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
from caption_utils import (
    DEFAULT_FALLBACK_CAPTION_DURATION_SECONDS,
    align_caption_text_to_timing,
    caption_segments_match_language,
    chunk_text_for_captions,
    clean_caption_text,
    fallback_caption_response,
    fallback_caption_segments,
    normalize_caption_duration,
    normalize_caption_segments,
    normalize_language,
    parse_json3_timedtext,
    parse_timedtext_response,
    parse_vtt_timestamp,
    parse_webvtt_timedtext,
    parse_xml_timedtext,
    split_caption_sentences,
)
import caption_translation as caption_translation_module
from caption_translation import (
    CAPTION_TRANSLATION_BATCH_SIZE,
    CAPTION_TRANSLATION_COMPACT_MAX_CHARS,
    CAPTION_TRANSLATION_COMPACT_MAX_DURATION_SECONDS,
    CAPTION_TRANSLATION_COMPACT_THRESHOLD,
    CAPTION_TRANSLATION_INLINE_MAX_SEGMENTS,
    CAPTION_TRANSLATION_MAX_WORKERS,
    CAPTION_TRANSLATION_REQUEST_TIMEOUT_SECONDS,
    CAPTION_TRANSLATION_TARGET_SEGMENTS,
    CaptionTranslationRuntime,
    caption_translation_language_name,
    caption_translation_length_guidance,
    caption_translation_unavailable_reason,
    compact_caption_segments_for_translation,
    compact_caption_segments_to_budget,
    configure_caption_translation_runtime,
    parse_caption_translations,
    request_caption_translations,
    translate_caption_batch,
    translate_caption_segments,
    translate_fallback_text,
)
import caption_results as caption_results_module
from caption_results import (
    CaptionResultRuntime,
    caption_rate_limited_response,
    configure_caption_result_runtime,
    fetch_transcript_api_segments,
    list_youtube_transcripts,
    native_caption_response,
    parse_transcript_api_rows,
    read_transcript_field,
    source_caption_response,
    transcript_api_caption_response,
    yt_dlp_caption_response,
)
import transcription as transcription_module
from transcription import (
    STT_MODEL_SNAPSHOT,
    TranscriptionRuntime,
    configure_transcription_runtime,
    download_youtube_audio_window,
    normalize_transcription_duration,
    normalize_transcription_start,
    production_transcription_adapter,
    transcribe_youtube_audio,
    transcription_capability_error,
    transcription_failure,
)
import video_summary as video_summary_module
from video_summary import (
    SUMMARY_CACHE_POLICY_VERSION,
    SUMMARY_RESPONSE_CACHE,
    SUMMARY_RESPONSE_CACHE_MAX_SIZE,
    SUMMARY_RESPONSE_CACHE_TTL_SECONDS,
    VideoSummaryRuntime,
    append_transcript_section,
    best_key_transcript_candidate_per_bucket,
    build_youtube_summary,
    configure_video_summary_runtime,
    fallback_video_summary_sections,
    format_caption_time,
    key_transcript_score,
    key_transcript_segments,
    key_transcript_target_count,
    korean_fallback_video_summary_sections,
    parse_summary_sections,
    read_summary_response_cache,
    sample_summary_segments,
    spaced_key_transcript_candidates,
    summarize_video_with_openai,
    summary_caption_segments,
    summary_response_cache_key,
    summary_transcript_segments,
    text_looks_korean,
    timestamped_transcript_body,
    transcript_review_candidates,
    transcript_text_from_segments,
    write_summary_response_cache,
)
import ytdlp_captions as ytdlp_captions_module
from ytdlp_captions import (
    YOUTUBE_SUBTITLE_PO_TOKEN_CACHE,
    YOUTUBE_SUBTITLE_PO_TOKEN_CACHE_TTL_SECONDS,
    YtDlpRuntime,
    append_query_params,
    caption_url_query_language,
    caption_url_requests_translation,
    caption_url_with_recovery_params,
    choose_yt_dlp_caption_candidate,
    choose_yt_dlp_caption_entry,
    cleanup_temp_caption_files,
    configure_ytdlp_runtime,
    explicit_youtube_subtitle_po_token,
    fetch_yt_dlp_caption_file_segments,
    fetch_yt_dlp_caption_segments,
    fetch_yt_dlp_metadata,
    ffmpeg_location_args,
    find_yt_dlp_caption_candidate,
    generate_bgutil_subtitle_po_token,
    generated_youtube_subtitle_po_token,
    infer_yt_dlp_subtitle_language,
    parse_best_yt_dlp_subtitle_file,
    parse_yt_dlp_subtitle_file,
    sanitized_caption_exception,
    split_env_values,
    truthy_env,
    truthy_env_default,
    youtube_bgutil_server_home,
    youtube_node_runtime_path,
    youtube_subprocess_environment,
    youtube_subtitle_po_token,
    yt_dlp_caption_source_language,
    yt_dlp_commands,
    yt_dlp_language_has_untranslated_entry,
    yt_dlp_recovery_args,
    yt_dlp_secret_config_args,
    yt_dlp_sensitive_recovery_args,
    yt_dlp_subtitle_language_attempts,
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
CAPTION_TRANSLATION_MAX_WINDOW_SECONDS = 240
CAPTION_CACHE_POLICY_VERSION = "translation-window-v3"
CAPTION_RESPONSE_CACHE_TTL_SECONDS = 10 * 60
CAPTION_RESPONSE_CACHE_MAX_SIZE = 64
CAPTION_RESPONSE_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
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





def json_rpc_error(request_id: Any, code: int, message: str) -> dict[str, Any]:
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "error": {
            "code": code,
            "message": message,
        },
    }


configure_caption_translation_runtime(
    CaptionTranslationRuntime(
        openai_client=lambda: (
            OpenAI() if OpenAI is not None and os.getenv("OPENAI_API_KEY") else None
        ),
        openai_available=lambda: OpenAI is not None,
    )
)


configure_caption_result_runtime(
    CaptionResultRuntime(
        transcript_api=lambda: YouTubeTranscriptApi,
        translate_segments=lambda segments, language: translate_caption_segments(
            segments,
            language,
        ),
        should_translate_inline=lambda segments: should_translate_caption_segments_inline(
            segments
        ),
        segments_in_window=lambda segments, window: caption_segments_in_window(
            segments,
            window,
        ),
        schedule_translation=lambda cache_key, video_id, target_language, source_language, segments: schedule_caption_translation(
            cache_key,
            video_id,
            target_language,
            source_language,
            segments,
        ),
    )
)


configure_caption_track_runtime(
    CaptionTrackRuntime(
        http_client=lambda: httpx,
        recovery_url=lambda url, video_id: caption_url_with_recovery_params(
            url,
            video_id,
        ),
    )
)


configure_ytdlp_runtime(
    YtDlpRuntime(
        http_available=lambda: httpx is not None,
        can_translate=lambda: can_translate_captions_with_openai(),
        fetch_segments_from_urls=lambda urls, video_id: fetch_caption_segments_from_urls(
            urls,
            video_id,
        ),
        fetch_metadata=lambda video_id: fetch_yt_dlp_metadata(video_id),
        fetch_caption_file=lambda video_id, language, target_language: fetch_yt_dlp_caption_file_segments(
            video_id,
            language,
            target_language,
        ),
        commands=lambda: yt_dlp_commands(),
    )
)


configure_transcription_runtime(
    TranscriptionRuntime(
        openai_client=lambda: (
            OpenAI(timeout=90.0, max_retries=2) if OpenAI is not None else None
        ),
        fetch_metadata=lambda video_id: fetch_yt_dlp_metadata(video_id),
        secret_config_args=lambda: yt_dlp_secret_config_args(),
        yt_dlp_commands=lambda: yt_dlp_commands(),
        yt_dlp_recovery_args=lambda: yt_dlp_recovery_args(),
        subprocess_environment=lambda: youtube_subprocess_environment(),
        translate_segments=lambda segments, language: translate_caption_segments(
            segments,
            language,
        ),
        default_adapter=lambda request: production_transcription_adapter(request),
    )
)


configure_video_summary_runtime(
    VideoSummaryRuntime(
        caption_loader=lambda payload: load_translated_captions(payload),
        translate_segments=lambda segments, language: translate_caption_segments(
            segments,
            language,
        ),
        openai_client=lambda: (
            OpenAI() if OpenAI is not None and os.getenv("OPENAI_API_KEY") else None
        ),
    )
)


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
