from __future__ import annotations

import re
from typing import Any, Callable

from study_plan_graph import StudyPlanGraphState, ToolName, run_study_plan_graph


def build_study_plan(
    payload: dict[str, Any],
    lookup_youtube: Callable[[dict[str, Any]], dict[str, Any]],
) -> dict[str, Any]:
    goal = str(payload.get("goal") or "React 공부").strip()
    language = str(payload.get("language") or "ko")
    interests = [str(item) for item in payload.get("interests") or []]
    max_iterations = bounded_iterations(payload.get("maxIterations"))
    state: StudyPlanGraphState = {
        "goal": goal,
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
        for video in external.get("videos") or []:
            recommendations.append(
                {
                    "title": video["title"],
                    "url": video["sourceUrl"],
                    "thumbnailUrl": video["thumbnailUrl"],
                    "source": video.get("provider") or external["provider"],
                    "why": video.get("summary") or external["summary"],
                }
            )
    return recommendations


def create_playlist_title(goal: str, language: str) -> str:
    if language.lower().startswith("ko"):
        return f"{goal} 맞춤 학습 코스"
    return f"Study playlist for {goal}"


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
