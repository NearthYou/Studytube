from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from caption_utils import (
    caption_segments_match_language,
    clean_caption_text,
    normalize_caption_segments,
    normalize_language,
)


@dataclass(frozen=True)
class CaptionResultRuntime:
    transcript_api: Callable[[], Any | None]
    translate_segments: Callable[[list[dict[str, Any]], str], list[dict[str, Any]]]
    should_translate_inline: Callable[[list[dict[str, Any]]], bool]
    segments_in_window: Callable[
        [list[dict[str, Any]], tuple[float, float] | None],
        list[dict[str, Any]],
    ]
    schedule_translation: Callable[
        [str, str, str, str, list[dict[str, Any]]], None
    ]


_runtime: CaptionResultRuntime | None = None


def configure_caption_result_runtime(runtime: CaptionResultRuntime) -> None:
    global _runtime
    _runtime = runtime


def caption_result_runtime() -> CaptionResultRuntime:
    if _runtime is None:
        raise RuntimeError("Caption result runtime is not configured")
    return _runtime

def fetch_transcript_api_segments(
    video_id: str,
    target_language: str,
) -> tuple[list[dict[str, Any]], str, bool]:
    if caption_result_runtime().transcript_api() is None:
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
    api_type = caption_result_runtime().transcript_api()
    if hasattr(api_type, "list_transcripts"):
        return api_type.list_transcripts(video_id)

    transcript_api = api_type()

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
        translated_segments = caption_result_runtime().translate_segments(
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
        translation_segments = caption_result_runtime().segments_in_window(
            normalized_segments,
            caption_window,
        )
        translated_segments = (
            caption_result_runtime().translate_segments(translation_segments, target_language)
            if caption_result_runtime().should_translate_inline(translation_segments)
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
        caption_result_runtime().schedule_translation(
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



