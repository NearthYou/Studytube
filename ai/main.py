from __future__ import annotations

import os
from pathlib import Path
import re
import subprocess
import sys
import time
from typing import Any

import app_factory
import caption_results as caption_results_module
import caption_service as caption_service_module
import caption_translation as caption_translation_module
import caption_utils as caption_utils_module
import compatibility_exports
import embeddings as embeddings_module
import quiz_generation as quiz_generation_module
import runtime_environment
import service_bridge as service_bridge_module
import study_generation as study_generation_module
import transcription as transcription_module
import video_summary as video_summary_module
import youtube_caption_tracks as caption_tracks_module
import youtube_runtime as youtube_runtime_module
import youtube_search as youtube_search_module
import ytdlp_captions as ytdlp_captions_module
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


compatibility_exports.install_compatibility_exports(
    globals(),
    [
        app_factory,
        caption_results_module,
        caption_service_module,
        caption_translation_module,
        caption_utils_module,
        embeddings_module,
        quiz_generation_module,
        service_bridge_module,
        study_generation_module,
        transcription_module,
        video_summary_module,
        caption_tracks_module,
        youtube_runtime_module,
        youtube_search_module,
        ytdlp_captions_module,
    ],
)
Request = app_factory.Request
JSONResponse = app_factory.JSONResponse


AI_DIR = Path(__file__).resolve().parent
ROOT_DIR = AI_DIR.parent

runtime_environment.load_runtime_environment(load_dotenv, ai_dir=AI_DIR, root_dir=ROOT_DIR)

DEFAULT_DATABASE_URL = "postgresql://app:app@localhost:5432/app_dev"


configure_service_bridge(
    ServiceBridgeRuntime(namespace=sys.modules[__name__])
)


configure_caption_translation_runtime(
    CaptionTranslationRuntime(
        openai_client=lambda: (
            OpenAI() if OpenAI is not None and os.getenv("OPENAI_API_KEY") else None
        ),
        openai_available=lambda: OpenAI is not None,
    )
)


configure_caption_service_runtime(
    CaptionServiceRuntime(namespace=sys.modules[__name__])
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
        ffmpeg_location_args=lambda: ffmpeg_location_args(),
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


configure_quiz_generation_runtime(
    QuizGenerationRuntime(
        caption_loader=lambda payload: load_translated_captions(payload)
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
