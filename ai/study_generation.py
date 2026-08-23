from __future__ import annotations

import os
import re
from typing import Any, Callable

try:
    from openai import OpenAI
except ModuleNotFoundError:  # pragma: no cover - local test fallback
    OpenAI = None


AGENT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_video",
            "description": "Search or look up external YouTube video metadata.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_playlist_draft",
            "description": "Create a playlist draft from retrieved posts and videos.",
            "parameters": {
                "type": "object",
                "properties": {"title": {"type": "string"}},
                "required": ["title"],
            },
        },
    },
]


def build_study_plan(
    payload: dict[str, Any],
    lookup_youtube: Callable[[dict[str, Any]], dict[str, Any]],
) -> dict[str, Any]:
    goal = str(payload.get("goal") or "React 공부").strip()
    language = str(payload.get("language") or "ko")
    interests = [str(item) for item in payload.get("interests") or []]
    max_iterations = min(int(payload.get("maxIterations") or 3), 4)
    state: dict[str, Any] = {
        "goal": goal,
        "language": language,
        "interests": interests,
        "external": None,
        "trace": [],
    }

    for iteration in range(max_iterations):
        tool_name = choose_agent_tool(state, iteration)
        state["trace"].append(
            {
                "iteration": iteration + 1,
                "tool": tool_name,
                "reason": tool_reason(tool_name),
            }
        )
        try:
            if tool_name == "search_video":
                state["external"] = lookup_youtube({"query": goal, "limit": 5})
            elif tool_name == "create_playlist_draft":
                break
        except Exception as exc:  # pragma: no cover - defensive runtime path
            state["trace"][-1]["error"] = str(exc)

    recommendations = create_playlist_recommendations(state)
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
            "toolCalling": "OpenAI function-calling schema when configured; deterministic tool loop fallback otherwise.",
        },
    }


def choose_agent_tool(state: dict[str, Any], iteration: int) -> str:
    llm_choice = choose_tool_with_llm(state)
    if llm_choice:
        return llm_choice
    if iteration == 0 and not state.get("external"):
        return "search_video"
    return "create_playlist_draft"


def choose_tool_with_llm(state: dict[str, Any]) -> str | None:
    if OpenAI is None or not os.getenv("OPENAI_API_KEY"):
        return None
    try:  # pragma: no cover - requires external credentials
        client = OpenAI()
        response = client.chat.completions.create(
            model=os.getenv("LLM_MODEL", "gpt-4o-mini"),
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Choose the next StudyTube agent tool. "
                        "Use search_video to gather read-only YouTube metadata, then "
                        "create_playlist_draft when enough evidence exists."
                    ),
                },
                {"role": "user", "content": str(state)},
            ],
            tools=AGENT_TOOLS,
            tool_choice="auto",
        )
        tool_calls = getattr(response.choices[0].message, "tool_calls", None)
        if tool_calls:
            name = tool_calls[0].function.name
            if name in {"search_video", "create_playlist_draft"}:
                return name
    except Exception:
        return None
    return None


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


def tool_reason(tool_name: str) -> str:
    return {
        "search_video": "외부 YouTube 메타데이터로 추천 후보를 보강합니다.",
        "create_playlist_draft": "수집한 근거를 학습 코스 초안으로 정리합니다.",
    }[tool_name]
