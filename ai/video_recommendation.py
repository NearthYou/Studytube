from __future__ import annotations

import math
import re
from datetime import UTC, datetime
from typing import Any, Iterable
from urllib.parse import parse_qs, urlparse


BEGINNER_MARKERS = (
    "입문",
    "기초",
    "초보",
    "처음",
    "beginner",
    "basics",
    "intro",
    "getting started",
)
ADVANCED_MARKERS = ("고급", "심화", "advanced", "expert")
PRACTICE_MARKERS = (
    "실습",
    "연습",
    "예제",
    "따라",
    "practice",
    "exercise",
    "build",
    "project",
)
COURSE_ROLE_ORDER = ("introduction", "concept", "practice", "application")


def rank_video_candidates(
    candidates: Iterable[dict[str, Any]],
    context: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    learner = context or {}
    subject = clean_subject_request(str(learner.get("subject") or ""))
    excluded_ids = {
        str(value).strip()
        for value in learner.get("excludedVideoIds") or []
        if str(value).strip()
    }
    pace = str(learner.get("pace") or "")
    target_minutes = preferred_minutes(pace)
    paced_max_seconds = max(3_600, target_minutes * 4 * 60)
    wants_advanced = contains_marker(
        " ".join(
            [
                str(learner.get("learningGoal") or ""),
                subject,
            ]
        ),
        ADVANCED_MARKERS,
    )
    recent_tokens = recent_learning_tokens(learner.get("recentVideos") or [])
    seen_keys: set[str] = set()
    seen_titles: set[str] = set()
    ranked: list[dict[str, Any]] = []

    for raw in candidates:
        video = dict(raw)
        video_id = str(video.get("videoId") or "").strip()
        source_url = str(video.get("sourceUrl") or "").strip()
        if not is_playable_youtube_url(source_url):
            continue
        dedupe_key = video_id or source_url
        if not dedupe_key or dedupe_key in excluded_ids or dedupe_key in seen_keys:
            continue
        seen_keys.add(dedupe_key)

        duration_seconds = non_negative_int(video.get("durationSeconds"))
        if duration_seconds is not None and (
            duration_seconds < 60 or duration_seconds > 14_400
        ):
            continue
        if (
            duration_seconds is not None
            and has_explicit_pace(pace)
            and duration_seconds > paced_max_seconds
        ):
            continue

        title = str(video.get("title") or "").strip()
        summary = str(video.get("summary") or "").strip()
        relevance = topic_relevance(subject, f"{title} {summary}")
        if subject and relevance < 12:
            continue
        title_key = normalize_text(title)
        if title_key and title_key in seen_titles:
            continue
        if title_key:
            seen_titles.add(title_key)

        difficulty = classify_difficulty(title)
        role = classify_course_role(title)
        score = relevance
        reasons: list[str] = []

        if relevance >= 28:
            reasons.append(f"{display_subject(subject)} 주제와 잘 맞음")

        caption_available = video.get("captionAvailable")
        if caption_available is True:
            score += 20
            reasons.append("원문 자막 제공")
        elif caption_available is False:
            reasons.append("재생 후 학습 자막 준비")
        elif caption_available is None:
            score += 8

        continuity = continuity_score(f"{title} {summary}", recent_tokens)
        score += continuity
        if continuity >= 6:
            reasons.append("최근 학습과 이어짐")

        if wants_advanced:
            score += {"advanced": 15, "concept": 9, "beginner": 4}[difficulty]
        else:
            score += {"beginner": 15, "concept": 9, "advanced": 2}[difficulty]

        duration_score, duration_reason = duration_fit_score(
            duration_seconds,
            target_minutes,
        )
        score += duration_score
        if duration_reason:
            reasons.append(duration_reason)
        if difficulty == "beginner" and not wants_advanced:
            reasons.append("처음 배우기 좋은 난이도")

        score += popularity_score(video.get("viewCount"))
        score += freshness_score(video.get("publishedAt"))

        video["difficulty"] = difficulty
        video["courseRole"] = role
        video["recommendationScore"] = round(score, 2)
        video["recommendationReasons"] = reasons[:4]
        ranked.append(video)

    return sorted(
        ranked,
        key=lambda video: -float(video["recommendationScore"]),
    )


def select_course_sequence(
    ranked: Iterable[dict[str, Any]],
    limit: int = 4,
) -> list[dict[str, Any]]:
    maximum = max(1, min(int(limit), 4))
    candidates = [dict(video) for video in ranked]
    selected: list[dict[str, Any]] = []
    selected_ids: set[str] = set()
    channel_counts: dict[str, int] = {}

    def can_select(video: dict[str, Any]) -> bool:
        video_id = str(video.get("videoId") or video.get("sourceUrl") or "")
        channel = normalized_channel(video)
        return bool(video_id) and video_id not in selected_ids and channel_counts.get(
            channel, 0
        ) < 2

    def append(video: dict[str, Any]) -> None:
        video_id = str(video.get("videoId") or video.get("sourceUrl") or "")
        channel = normalized_channel(video)
        selected.append(video)
        selected_ids.add(video_id)
        channel_counts[channel] = channel_counts.get(channel, 0) + 1

    for video in candidates:
        if can_select(video):
            append(video)
        if len(selected) >= maximum:
            break
    role_index = {role: index for index, role in enumerate(COURSE_ROLE_ORDER)}
    return sorted(
        selected,
        key=lambda video: (
            role_index.get(str(video.get("courseRole") or "concept"), 1),
            -float(video.get("recommendationScore") or 0),
        ),
    )


def topic_relevance(subject: str, text: str) -> float:
    normalized_subject = normalize_text(subject)
    normalized_text = normalize_text(text)
    if not normalized_subject:
        return 20
    if normalized_subject in normalized_text:
        return 35
    terms = [term for term in normalized_subject.split() if len(term) >= 2]
    if not terms:
        return 0
    matches = sum(term in normalized_text for term in terms)
    return round(35 * matches / len(terms), 2)


def clean_subject_request(value: str) -> str:
    subject = value.strip()
    for line in value.splitlines():
        label, separator, content = line.partition(":")
        if separator and label.strip() in {"배울 내용", "주제", "관심사"}:
            subject = content.strip()
            break
    subject = re.sub(
        r"\s*(?:배우고|공부하고|익히고|연습하고)\s*싶(?:어|어요|습니다).*$",
        "",
        subject,
    ).strip()
    return subject or value.strip()


def preferred_minutes(pace: str) -> int:
    match = re.search(r"(\d{1,3})\s*분", pace)
    if match:
        return max(5, min(int(match.group(1)), 120))
    normalized = pace.casefold()
    if any(marker in normalized for marker in ["빠르게", "짧게", "quick"]):
        return 10
    if any(marker in normalized for marker in ["천천히", "여유", "slow"]):
        return 30
    return 20


def has_explicit_pace(pace: str) -> bool:
    normalized = pace.casefold().strip()
    return bool(
        re.search(r"\d{1,3}\s*분", normalized)
        or any(
            marker in normalized
            for marker in ["빠르게", "짧게", "천천히", "여유", "quick", "slow"]
        )
    )


def duration_fit_score(
    duration_seconds: int | None,
    target_minutes: int,
) -> tuple[int, str]:
    if duration_seconds is None:
        return 4, "영상 길이 확인 가능"
    minutes = max(1, round(duration_seconds / 60))
    ratio = minutes / max(target_minutes, 1)
    if 0.6 <= ratio <= 1.4:
        score = 10
    elif 0.35 <= ratio <= 2:
        score = 6
    else:
        score = 1
    return score, f"약 {minutes}분"


def classify_difficulty(title: str) -> str:
    if contains_marker(title, BEGINNER_MARKERS):
        return "beginner"
    if contains_marker(title, ADVANCED_MARKERS):
        return "advanced"
    return "concept"


def classify_course_role(title: str) -> str:
    if contains_marker(title, BEGINNER_MARKERS):
        return "introduction"
    if contains_marker(title, PRACTICE_MARKERS):
        return "practice"
    if contains_marker(title, ADVANCED_MARKERS):
        return "application"
    return "concept"


def popularity_score(value: Any) -> int:
    count = non_negative_int(value)
    if count is None or count <= 0:
        return 0
    return min(7, max(1, int(math.log10(count))))


def freshness_score(value: Any) -> int:
    if not isinstance(value, str) or not value.strip():
        return 0
    try:
        published = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return 0
    if published.tzinfo is None:
        published = published.replace(tzinfo=UTC)
    age_days = max(0, (datetime.now(UTC) - published).days)
    if age_days <= 730:
        return 3
    if age_days <= 1825:
        return 2
    return 1


def recent_learning_tokens(videos: Iterable[dict[str, Any]]) -> set[str]:
    tokens: set[str] = set()
    for video in list(videos)[:5]:
        tokens.update(
            token
            for token in normalize_text(str(video.get("title") or "")).split()
            if len(token) >= 3
        )
    return tokens


def continuity_score(text: str, recent_tokens: set[str]) -> int:
    if not recent_tokens:
        return 0
    haystack = normalize_text(text)
    matches = sum(token in haystack for token in recent_tokens)
    return min(10, matches * 2)


def contains_marker(text: str, markers: tuple[str, ...]) -> bool:
    normalized = text.casefold()
    return any(marker in normalized for marker in markers)


def normalize_text(value: str) -> str:
    return " ".join(
        re.findall(r"[a-z0-9가-힣+#]+", value.casefold())
    )


def display_subject(subject: str) -> str:
    return subject.strip() or "학습"


def is_playable_youtube_url(value: str) -> bool:
    try:
        parsed = urlparse(value)
    except ValueError:
        return False
    host = (parsed.hostname or "").casefold()
    if host == "youtu.be":
        return bool(parsed.path.strip("/"))
    if host not in {
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "music.youtube.com",
    }:
        return False
    if parsed.path == "/watch":
        return bool(parse_qs(parsed.query).get("v", [""])[0])
    return parsed.path.startswith(("/shorts/", "/embed/", "/live/"))


def normalized_channel(video: dict[str, Any]) -> str:
    channel = str(video.get("channel") or "").strip().casefold()
    if channel:
        return channel
    return f"unknown:{video.get('videoId') or video.get('sourceUrl') or id(video)}"


def non_negative_int(value: Any) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 0 else None
