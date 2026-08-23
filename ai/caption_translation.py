from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
import json
import os
import re
from typing import Any, Callable

from caption_utils import clean_caption_text, normalize_caption_segments, normalize_language


CAPTION_TRANSLATION_BATCH_SIZE = 32
CAPTION_TRANSLATION_MAX_WORKERS = 8
CAPTION_TRANSLATION_COMPACT_THRESHOLD = 240
CAPTION_TRANSLATION_COMPACT_MAX_DURATION_SECONDS = 8.0
CAPTION_TRANSLATION_COMPACT_MAX_CHARS = 220
CAPTION_TRANSLATION_TARGET_SEGMENTS = 720
CAPTION_TRANSLATION_INLINE_MAX_SEGMENTS = 96
CAPTION_TRANSLATION_REQUEST_TIMEOUT_SECONDS = 45


@dataclass(frozen=True)
class CaptionTranslationRuntime:
    openai_client: Callable[[], Any | None]
    openai_available: Callable[[], bool]


_runtime: CaptionTranslationRuntime | None = None


def configure_caption_translation_runtime(runtime: CaptionTranslationRuntime) -> None:
    global _runtime
    _runtime = runtime


def caption_translation_runtime() -> CaptionTranslationRuntime:
    if _runtime is None:
        raise RuntimeError("Caption translation runtime is not configured")
    return _runtime

def translate_caption_segments(
    segments: list[dict[str, Any]],
    target_language: str,
) -> list[dict[str, Any]]:
    client = caption_translation_runtime().openai_client()
    if not segments or client is None:
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

    client = caption_translation_runtime().openai_client()
    if not source_text or client is None:
        return ""

    try:  # pragma: no cover - live credentials are optional in local tests
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



def caption_translation_unavailable_reason() -> str:
    if not caption_translation_runtime().openai_available():
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



