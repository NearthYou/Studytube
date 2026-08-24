from __future__ import annotations

import base64
from dataclasses import dataclass
import math
import os
from pathlib import Path
import re
import subprocess
import tempfile
from typing import Any, Callable

from caption_utils import (
    clean_caption_text,
    fallback_caption_segments,
    normalize_caption_segments,
    normalize_language,
)


STT_MODEL_SNAPSHOT = "gpt-4o-mini-transcribe-2025-12-15"
LIVE_AUDIO_TYPES = {
    "audio/webm": "webm",
    "audio/webm;codecs=opus": "webm",
    "audio/ogg": "ogg",
    "audio/ogg;codecs=opus": "ogg",
}


@dataclass(frozen=True)
class TranscriptionRuntime:
    openai_client: Callable[[], Any | None]
    live_openai_client: Callable[[], Any | None]
    fetch_metadata: Callable[[str], tuple[dict[str, Any] | None, Exception | None]]
    secret_config_args: Callable[[], Any]
    yt_dlp_commands: Callable[[], list[list[str]]]
    yt_dlp_recovery_args: Callable[[], list[str]]
    ffmpeg_location_args: Callable[[], list[str]]
    subprocess_environment: Callable[[], dict[str, str]]
    translate_segments: Callable[[list[dict[str, Any]], str], list[dict[str, Any]]]
    default_adapter: Callable[[dict[str, Any]], dict[str, Any]]


_runtime: TranscriptionRuntime | None = None


def configure_transcription_runtime(runtime: TranscriptionRuntime) -> None:
    global _runtime
    _runtime = runtime


def transcription_runtime() -> TranscriptionRuntime:
    if _runtime is None:
        raise RuntimeError("Transcription runtime is not configured")
    return _runtime


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

        active_client = client or transcription_runtime().openai_client()
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


def transcribe_browser_audio_chunk(
    payload: dict[str, Any],
    *,
    client: Any | None = None,
    translator: Callable[
        [list[dict[str, Any]], str], list[dict[str, Any]]
    ]
    | None = None,
) -> dict[str, Any]:
    if client is None and os.getenv("BROWSER_STT_ENABLED", "").casefold() != "true":
        return transcription_failure("STT_DISABLED")
    model = str(payload.get("model") or "").strip()
    mime_type = str(payload.get("mimeType") or "").strip().casefold()
    duration = normalize_transcription_duration(payload.get("durationSeconds"))
    encoded = str(payload.get("audioBase64") or "").strip()
    if (
        model != STT_MODEL_SNAPSHOT
        or mime_type not in LIVE_AUDIO_TYPES
        or not duration
        or duration > 12
        or len(encoded) > 400_000
    ):
        return transcription_failure("TRANSCRIPTION_PROVIDER_UNAVAILABLE")
    try:
        audio = base64.b64decode(encoded, validate=True)
    except (ValueError, TypeError):
        return transcription_failure("TRANSCRIPTION_PROVIDER_UNAVAILABLE")
    if not audio or len(audio) > 300_000:
        return transcription_failure("TRANSCRIPTION_PROVIDER_UNAVAILABLE")
    active_client = client or transcription_runtime().live_openai_client()
    if active_client is None:
        return transcription_failure("TRANSCRIPTION_PROVIDER_UNAVAILABLE")
    try:
        response = active_client.audio.transcriptions.create(
            model=STT_MODEL_SNAPSHOT,
            file=(
                f"caption.{LIVE_AUDIO_TYPES[mime_type]}",
                audio,
                f"audio/{LIVE_AUDIO_TYPES[mime_type]}",
            ),
        )
        source = clean_caption_text(str(getattr(response, "text", "") or ""))
        if not source:
            return transcription_failure("TRANSCRIPTION_PROVIDER_UNAVAILABLE")
        source_language = normalize_language(
            str(getattr(response, "language", "") or "")
        ) or "und"
        segments = fallback_caption_segments(source, duration)
        translate = translator or transcription_runtime().translate_segments
        translated = translate(segments, "ko")
        korean = " ".join(
            clean_caption_text(str(segment.get("text") or ""))
            for segment in translated
            if isinstance(segment, dict)
        ).strip()
        return {
            "provider": "openai-audio-transcription",
            "status": "ready",
            "sourceLanguage": source_language,
            "source": source,
            "korean": korean,
            "errorCode": "",
        }
    except Exception:
        return transcription_failure("TRANSCRIPTION_PROVIDER_UNAVAILABLE")


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

    runtime = transcription_runtime()
    metadata, _metadata_error = runtime.fetch_metadata(video_id)
    media_duration = normalize_transcription_duration(
        metadata.get("duration") if isinstance(metadata, dict) else None
    ) or (start_seconds + requested_duration)
    if start_seconds >= media_duration:
        raise RuntimeError("TRANSCRIPTION_PROVIDER_UNAVAILABLE")

    window_end = min(start_seconds + requested_duration, media_duration)
    needs_bounded_download = start_seconds > 0 or window_end < media_duration
    section_args = (
        [
            *runtime.ffmpeg_location_args(),
            "--download-sections",
            f"*{start_seconds:g}-{window_end:g}",
            "--force-keyframes-at-cuts",
        ]
        if needs_bounded_download
        else []
    )

    output_template = str(directory / "window.%(ext)s")
    with runtime.secret_config_args() as secret_config_args:
        for command in runtime.yt_dlp_commands():
            completed = subprocess.run(
                [
                    *command,
                    *runtime.yt_dlp_recovery_args(),
                    *secret_config_args,
                    *section_args,
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
                env=runtime.subprocess_environment(),
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
    video_id = str(payload.get("videoId") or "").strip()
    model = str(payload.get("model") or "").strip()
    duration_seconds = normalize_transcription_duration(
        payload.get("durationSeconds")
    )
    capability = payload.get("mediaCapability")
    capability = capability if isinstance(capability, dict) else {}

    capability_error = transcription_capability_error(capability, duration_seconds)
    if capability_error:
        return transcription_failure(capability_error)
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
        return transcription_failure("TRANSCRIPTION_PROVIDER_UNAVAILABLE")
    if model != STT_MODEL_SNAPSHOT:
        return transcription_failure("STT_DISABLED")
    selected_adapter = adapter or transcription_runtime().default_adapter
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
        if adapter is None and not translated_segments and source_language != target_language:
            translated_segments = transcription_runtime().translate_segments(
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
    disabled = error_code in ("STT_DISABLED", "STT_NOT_APPROVED")
    return {
        "provider": "stt-disabled" if disabled else "transcription-unavailable",
        "status": "disabled" if disabled else "failed",
        "sourceLanguage": "",
        "segments": [],
        "translatedSegments": [],
        "errorCode": error_code,
    }
