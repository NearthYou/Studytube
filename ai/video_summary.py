from __future__ import annotations

import copy
from dataclasses import dataclass
import hashlib
import json
import math
import os
import re
import time
from typing import Any, Callable

from caption_utils import (
    caption_segments_match_language,
    normalize_caption_segments,
)
from youtube_search import clean_text


SUMMARY_CACHE_POLICY_VERSION = "transcript-summary-v1"
SUMMARY_RESPONSE_CACHE_TTL_SECONDS = 30 * 60
SUMMARY_RESPONSE_CACHE_MAX_SIZE = 64
SUMMARY_RESPONSE_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}


@dataclass(frozen=True)
class VideoSummaryRuntime:
    caption_loader: Callable[[dict[str, Any]], dict[str, Any]]
    translate_segments: Callable[[list[dict[str, Any]], str], list[dict[str, Any]]]
    openai_client: Callable[[], Any | None]


_runtime: VideoSummaryRuntime | None = None


def configure_video_summary_runtime(runtime: VideoSummaryRuntime) -> None:
    global _runtime
    _runtime = runtime


def summary_runtime() -> VideoSummaryRuntime:
    if _runtime is None:
        raise RuntimeError("Video summary runtime is not configured")
    return _runtime

def build_youtube_summary(payload: dict[str, Any]) -> dict[str, Any]:
    response_shape = str(payload.get("responseShape") or "").strip()

    if response_shape == "learning-overview":
        return build_learning_overview(payload)

    if response_shape == "segment-explanation":
        return build_segment_explanation(payload)

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

    if summary_runtime().openai_client() is not None and transcript:
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


def build_learning_overview(payload: dict[str, Any]) -> dict[str, Any]:
    segments = normalize_caption_segments(
        payload.get("segments") if isinstance(payload.get("segments"), list) else []
    )
    coverage = normalize_summary_coverage(payload.get("coverage"), segments)
    client = summary_runtime().openai_client()

    if client is None or len(segments) < 3 or coverage is None:
        return {"status": "failed", "errorCode": "SUMMARY_UNAVAILABLE"}

    try:  # pragma: no cover - live credentials are optional in local tests
        response = client.chat.completions.create(
            model=os.getenv("LLM_MODEL", "gpt-4o-mini"),
            temperature=0.2,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "주어진 자막 범위만 사용해 한국어 학습 정리를 만든다. "
                        "홍보 문구, 채널 정보, 엔딩 인사를 핵심으로 고르지 않는다. "
                        "JSON만 반환하고 overview, chapters, takeaways 키를 사용한다. "
                        "chapters는 시간 순서대로 3개에서 5개이며 각 항목은 "
                        "startSeconds, endSeconds, title, body를 가진다. "
                        "takeaways는 최대 3개다."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "coverage": coverage,
                            "transcript": segments,
                            "writing": (
                                "개요는 2~3문장으로 쓰고, 자막에 없는 내용을 만들지 마세요. "
                                "제목과 본문은 짧고 자연스러운 한국어로 작성하세요."
                            ),
                        },
                        ensure_ascii=False,
                    ),
                },
            ],
        )
        content = getattr(response.choices[0].message, "content", "") or ""
        parsed = parse_learning_overview(content, coverage)
        if parsed:
            return {
                "status": "ready",
                "provider": "openai-transcript-summary",
                "summary": parsed,
            }
    except Exception:
        pass

    return {"status": "failed", "errorCode": "SUMMARY_UNAVAILABLE"}


def build_segment_explanation(payload: dict[str, Any]) -> dict[str, Any]:
    source = clean_text(str(payload.get("source") or "")).strip()
    korean = clean_text(str(payload.get("korean") or "")).strip()
    client = summary_runtime().openai_client()

    if client is None or not source:
        return {"status": "failed", "errorCode": "EXPLANATION_UNAVAILABLE"}

    try:  # pragma: no cover - live credentials are optional in local tests
        response = client.chat.completions.create(
            model=os.getenv("LLM_MODEL", "gpt-4o-mini"),
            temperature=0.15,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "외국어 영상의 한 문장을 한국어로 짧게 설명한다. "
                        "JSON만 반환하고 plainMeaning, keyExpressions, contextNote를 사용한다. "
                        "keyExpressions는 최대 4개이며 각 항목은 text와 meaning을 가진다. "
                        "자막에 없는 상황을 지어내지 않는다."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {"source": source, "korean": korean},
                        ensure_ascii=False,
                    ),
                },
            ],
        )
        content = getattr(response.choices[0].message, "content", "") or ""
        parsed = parse_segment_explanation(content)
        if parsed:
            return parsed
    except Exception:
        pass

    return {"status": "failed", "errorCode": "EXPLANATION_UNAVAILABLE"}


def normalize_summary_coverage(
    value: Any,
    segments: list[dict[str, Any]],
) -> dict[str, Any] | None:
    raw = value if isinstance(value, dict) else {}
    try:
        start = float(raw.get("startSeconds", segments[0]["start"] if segments else 0))
        end = float(raw.get("endSeconds", segments[-1]["end"] if segments else 0))
    except (TypeError, ValueError, KeyError):
        return None
    scope = raw.get("scope")
    if scope not in {"full_video", "study_range"} or start < 0 or end <= start:
        return None
    return {"scope": scope, "startSeconds": start, "endSeconds": end}


def parse_learning_overview(
    content: str,
    coverage: dict[str, Any],
) -> dict[str, Any] | None:
    data = parse_json_content(content)
    if not isinstance(data, dict):
        return None
    overview = clean_text(str(data.get("overview") or "")).strip()
    chapters = data.get("chapters")
    takeaways = data.get("takeaways")
    if (
        len(overview) < 20
        or not isinstance(chapters, list)
        or not 3 <= len(chapters) <= 5
        or not isinstance(takeaways, list)
        or len(takeaways) > 3
    ):
        return None
    parsed_chapters: list[dict[str, Any]] = []
    for chapter in chapters:
        if not isinstance(chapter, dict):
            return None
        try:
            start = float(chapter.get("startSeconds"))
            end = float(chapter.get("endSeconds"))
        except (TypeError, ValueError):
            return None
        title = clean_text(str(chapter.get("title") or "")).strip()
        body = clean_text(str(chapter.get("body") or "")).strip()
        if (
            start < coverage["startSeconds"]
            or end > coverage["endSeconds"]
            or end <= start
            or not title
            or not body
        ):
            return None
        parsed_chapters.append(
            {
                "startSeconds": start,
                "endSeconds": end,
                "title": title[:120],
                "body": body[:2000],
            }
        )
    parsed_takeaways = [
        clean_text(str(item)).strip()[:1000]
        for item in takeaways
        if clean_text(str(item)).strip()
    ]
    if len(parsed_takeaways) != len(takeaways):
        return None
    return {
        "overview": overview[:4000],
        "chapters": parsed_chapters,
        "takeaways": parsed_takeaways,
    }


def parse_segment_explanation(content: str) -> dict[str, Any] | None:
    data = parse_json_content(content)
    if not isinstance(data, dict):
        return None
    plain_meaning = clean_text(str(data.get("plainMeaning") or "")).strip()
    context_note = clean_text(str(data.get("contextNote") or "")).strip()
    expressions = data.get("keyExpressions")
    if not plain_meaning or not isinstance(expressions, list) or len(expressions) > 4:
        return None
    parsed_expressions = []
    for expression in expressions:
        if not isinstance(expression, dict):
            return None
        text = clean_text(str(expression.get("text") or "")).strip()
        meaning = clean_text(str(expression.get("meaning") or "")).strip()
        if not text or not meaning:
            return None
        parsed_expressions.append({"text": text[:200], "meaning": meaning[:500]})
    return {
        "plainMeaning": plain_meaning[:2000],
        "keyExpressions": parsed_expressions,
        "contextNote": context_note[:2000],
    }


def parse_json_content(content: str) -> Any:
    normalized = content.strip()
    match = re.search(r"(\{.*\}|\[.*\])", normalized, re.S)
    if match:
        normalized = match.group(1)
    try:
        return json.loads(normalized)
    except json.JSONDecodeError:
        return None


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
        caption_response = summary_runtime().caption_loader(caption_payload)
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
        client = summary_runtime().openai_client()
        if client is None:
            return []
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

    translated_segments = summary_runtime().translate_segments(segments, "ko")

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
