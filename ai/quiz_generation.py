from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Any, Callable
from urllib.parse import urlparse

from caption_utils import normalize_caption_segments
from youtube_search import clean_text


DEFAULT_FALLBACK_CAPTION_DURATION_SECONDS = 600


@dataclass(frozen=True)
class QuizGenerationRuntime:
    caption_loader: Callable[[dict[str, Any]], dict[str, Any]]


_runtime: QuizGenerationRuntime | None = None


def configure_quiz_generation_runtime(runtime: QuizGenerationRuntime) -> None:
    global _runtime
    _runtime = runtime


def quiz_generation_runtime() -> QuizGenerationRuntime:
    if _runtime is None:
        raise RuntimeError("Quiz generation runtime is not configured")
    return _runtime

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
    caption_response = quiz_generation_runtime().caption_loader(
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
