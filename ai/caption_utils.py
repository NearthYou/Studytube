from __future__ import annotations

import html as html_lib
import math
import re
from typing import Any
from xml.etree import ElementTree


DEFAULT_FALLBACK_CAPTION_DURATION_SECONDS = 600


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

        text = clean_caption_text(re.sub(r"<[^>]+>", "", " ".join(text_lines)))
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
            {"start": round(start, 3), "end": round(end, 3), "text": text}
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
        text or "원문 자막 타이밍은 확인했지만 표시할 분석 요약이 비어 있습니다."
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
