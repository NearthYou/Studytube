from __future__ import annotations

import re
from typing import Any, Callable

from study_plan_graph import StudyPlanGraphState, ToolName, run_study_plan_graph
from video_recommendation import (
    clean_subject_request,
    rank_video_candidates,
    select_course_sequence,
)


def build_study_plan(
    payload: dict[str, Any],
    lookup_youtube: Callable[[dict[str, Any]], dict[str, Any]],
) -> dict[str, Any]:
    goal = str(payload.get("goal") or "React 공부").strip()
    language = str(payload.get("language") or "ko")
    interests = [str(item) for item in payload.get("interests") or []]
    max_iterations = bounded_iterations(payload.get("maxIterations"))
    recommendation_context = normalize_recommendation_context(
        payload.get("recommendationContext"),
        goal,
        interests,
    )
    state: StudyPlanGraphState = {
        "goal": goal,
        "search_queries": build_search_queries(goal),
        "learner_context": recommendation_context,
        "max_iterations": max_iterations,
        "next_tool": None,
        "external": None,
        "recommendations": [],
        "search_failed": False,
        "trace": [],
    }

    state = run_study_plan_graph(
        state,
        choose_tool=choose_agent_tool,
        tool_reason=tool_reason,
        lookup_youtube=lookup_youtube,
        create_recommendations=create_playlist_recommendations,
    )

    recommendations = state["recommendations"]
    return {
        "mode": "agent",
        "goal": goal,
        "playlistTitle": create_playlist_title(goal, language),
        "recommendations": recommendations,
        "suggestedTags": suggest_tags(goal, recommendations, interests),
        "rationale": create_agent_rationale(goal, recommendations, language),
        "trace": state["trace"],
        "guardrails": {
            "maxIterations": max_iterations,
            "loopStopped": True,
            "orchestration": "langgraph",
            "toolCalling": "LangGraph routes bounded search and draft nodes.",
        },
    }


def choose_agent_tool(state: dict[str, Any]) -> ToolName:
    if state.get("external") is None:
        return "search_video"
    return "create_playlist_draft"


def build_search_queries(goal: str) -> list[str]:
    subject = goal.strip()
    for line in goal.splitlines():
        label, separator, value = line.partition(":")
        if separator and label.strip() in {"배울 내용", "주제", "관심사"}:
            subject = value.strip()
            break
    subject = clean_subject_request(subject) or goal.strip()
    return list(
        dict.fromkeys(
            [
                subject,
                f"{subject} 기초 강의",
                f"{subject} tutorial for beginners",
            ]
        )
    )


def bounded_iterations(value: Any) -> int:
    try:
        parsed = int(value or 3)
    except (TypeError, ValueError):
        parsed = 3
    return max(1, min(parsed, 4))


def create_playlist_recommendations(state: dict[str, Any]) -> list[dict[str, Any]]:
    recommendations = []
    external = state.get("external")
    if external:
        ranked_videos = rank_video_candidates(
            external.get("videos") or [],
            state.get("learner_context") or {},
        )
        for video in select_course_sequence(ranked_videos, limit=4):
            reasons = [
                str(reason)
                for reason in video.get("recommendationReasons") or []
                if str(reason).strip()
            ]
            recommendations.append(
                {
                    "title": video["title"],
                    "url": video["sourceUrl"],
                    "thumbnailUrl": video["thumbnailUrl"],
                    "source": video.get("provider") or external["provider"],
                    "channel": video.get("channel") or "YouTube",
                    "why": ", ".join(reasons)
                    or video.get("summary")
                    or external["summary"],
                    "recommendationReasons": reasons,
                    "recommendationScore": video.get("recommendationScore", 0),
                    "durationSeconds": video.get("durationSeconds"),
                    "captionAvailable": video.get("captionAvailable"),
                    "difficulty": video.get("difficulty"),
                    "courseRole": video.get("courseRole"),
                }
            )
    return recommendations


def normalize_recommendation_context(
    value: Any,
    goal: str,
    interests: list[str],
) -> dict[str, Any]:
    context = dict(value) if isinstance(value, dict) else {}
    raw_subject = str(
        context.get("subject") or build_search_queries(goal)[0]
    ).strip()
    context["subject"] = clean_subject_request(raw_subject)
    context["pace"] = str(context.get("pace") or raw_subject).strip()
    context["learningGoal"] = str(
        context.get("learningGoal") or goal
    ).strip()
    context["interests"] = [
        str(item).strip()
        for item in context.get("interests") or interests
        if str(item).strip()
    ][:5]
    context["excludedVideoIds"] = [
        str(item).strip()
        for item in context.get("excludedVideoIds") or []
        if str(item).strip()
    ][:100]
    context["recentVideos"] = [
        dict(item)
        for item in context.get("recentVideos") or []
        if isinstance(item, dict)
    ][:5]
    return context


def learning_order_score(title: str) -> int:
    normalized = title.casefold()
    if any(
        marker in normalized
        for marker in ["입문", "기초", "초보", "beginner", "basics", "intro"]
    ):
        return 0
    if any(
        marker in normalized
        for marker in ["고급", "심화", "advanced", "expert", "project"]
    ):
        return 2
    return 1


def create_playlist_title(goal: str, language: str) -> str:
    subject = build_search_queries(goal)[0]
    if language.lower().startswith("ko"):
        return f"{subject} 학습 코스"
    return f"Study playlist for {subject}"


def create_agent_rationale(
    goal: str, recommendations: list[dict[str, Any]], language: str
) -> str:
    count = len(recommendations)
    if language.lower().startswith("ko"):
        return (
            f"목표 '{goal}'에 대해 읽기 전용 YouTube 메타데이터를 사용해 "
            f"{count}개의 학습 코스 단계를 만들었습니다."
        )
    return (
        f"The agent used read-only YouTube metadata to create "
        f"{count} learning steps for '{goal}'."
    )


def suggest_tags(
    goal: str, recommendations: list[dict[str, Any]], interests: list[str]
) -> list[str]:
    tokens = tokenize(goal)
    for item in recommendations:
        tokens.update(tokenize(item["title"]))
    tokens.update(tag.lower() for tag in interests)
    useful = [
        token
        for token in tokens
        if len(token) >= 3 and token not in {"course", "study", "video", "want"}
    ]
    return sorted(useful)[:6]


def tokenize(text: str) -> set[str]:
    return set(re.findall(r"[a-zA-Z0-9가-힣]+", text.lower()))


def tool_reason(tool_name: ToolName) -> str:
    return {
        "search_video": "외부 YouTube 메타데이터로 추천 후보를 보강합니다.",
        "create_playlist_draft": "수집한 근거를 학습 코스 초안으로 정리합니다.",
    }[tool_name]
