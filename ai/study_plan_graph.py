from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Literal, TypedDict, cast

from langgraph.graph import END, START, StateGraph
from langgraph.runtime import Runtime


ToolName = Literal["search_video", "create_playlist_draft"]


class StudyPlanGraphState(TypedDict):
    goal: str
    search_queries: list[str]
    max_iterations: int
    next_tool: ToolName | None
    external: dict[str, Any] | None
    recommendations: list[dict[str, Any]]
    search_failed: bool
    trace: list[dict[str, Any]]


ToolChoice = Callable[[dict[str, Any]], ToolName]
ToolReason = Callable[[ToolName], str]
YoutubeLookup = Callable[[dict[str, Any]], dict[str, Any]]
PlaylistBuilder = Callable[[dict[str, Any]], list[dict[str, Any]]]


@dataclass(frozen=True)
class StudyPlanGraphContext:
    choose_tool: ToolChoice
    tool_reason: ToolReason
    lookup_youtube: YoutubeLookup
    create_recommendations: PlaylistBuilder


def create_study_plan_graph():
    workflow = StateGraph(
        StudyPlanGraphState,
        context_schema=StudyPlanGraphContext,
    )

    def decide(
        state: StudyPlanGraphState,
        runtime: Runtime[StudyPlanGraphContext],
    ) -> dict[str, Any]:
        iteration = len(state["trace"])
        tool_name = runtime.context.choose_tool(cast(dict[str, Any], state))
        trace = [
            *state["trace"],
            {
                "iteration": iteration + 1,
                "tool": tool_name,
                "reason": runtime.context.tool_reason(tool_name),
            },
        ]
        return {
            "next_tool": tool_name,
            "trace": trace,
        }

    def search_video(
        state: StudyPlanGraphState,
        runtime: Runtime[StudyPlanGraphContext],
    ) -> dict[str, Any]:
        merged: dict[str, Any] | None = None
        for query in state["search_queries"][: state["max_iterations"]]:
            try:
                result = runtime.context.lookup_youtube(
                    {"query": query, "limit": 5}
                )
            except Exception:  # pragma: no cover - provider behavior varies
                return (
                    {"external": merged, "search_failed": False}
                    if merged is not None
                    else failed_search_update(state)
                )
            if not usable_youtube_result(result):
                return (
                    {"external": merged, "search_failed": False}
                    if merged is not None
                    else failed_search_update(state)
                )
            merged = merge_youtube_results(merged, result)
            if len(merged["videos"]) >= 4:
                break
        return (
            {"external": merged, "search_failed": False}
            if merged is not None
            else failed_search_update(state)
        )

    def create_playlist_draft(
        state: StudyPlanGraphState,
        runtime: Runtime[StudyPlanGraphContext],
    ) -> dict[str, Any]:
        return {
            "recommendations": runtime.context.create_recommendations(
                cast(dict[str, Any], state)
            )
        }

    def route_decision(
        state: StudyPlanGraphState,
    ) -> Literal["search_video", "create_playlist_draft"]:
        tool_name = state["next_tool"]
        if tool_name is None:
            raise RuntimeError("study plan graph has no next tool")
        return tool_name

    def route_after_search(
        state: StudyPlanGraphState,
    ) -> Literal["decide", "create_playlist_draft", "stop"]:
        if state["search_failed"]:
            return (
                "create_playlist_draft"
                if state["external"] is not None
                else "stop"
            )
        if len(state["trace"]) >= state["max_iterations"]:
            return "create_playlist_draft"
        return "decide"

    workflow.add_node("decide", decide)
    workflow.add_node("search_video", search_video)
    workflow.add_node("create_playlist_draft", create_playlist_draft)
    workflow.add_edge(START, "decide")
    workflow.add_conditional_edges(
        "decide",
        route_decision,
        {
            "search_video": "search_video",
            "create_playlist_draft": "create_playlist_draft",
        },
    )
    workflow.add_conditional_edges(
        "search_video",
        route_after_search,
        {
            "decide": "decide",
            "create_playlist_draft": "create_playlist_draft",
            "stop": END,
        },
    )
    workflow.add_edge("create_playlist_draft", END)
    return workflow.compile(name="studytube-study-plan")


STUDY_PLAN_GRAPH = create_study_plan_graph()


def usable_youtube_result(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and value.get("provider") != "youtube-search-unavailable"
        and isinstance(value.get("videos"), list)
        and len(value["videos"]) > 0
    )


def failed_search_update(state: StudyPlanGraphState) -> dict[str, Any]:
    trace = [dict(item) for item in state["trace"]]
    trace[-1]["error"] = "video search unavailable"
    return {"search_failed": True, "trace": trace}


def merge_youtube_results(
    current: dict[str, Any] | None,
    incoming: dict[str, Any],
) -> dict[str, Any]:
    videos: list[dict[str, Any]] = []
    seen: set[str] = set()
    for video in [
        *((current or {}).get("videos") or []),
        *(incoming.get("videos") or []),
    ]:
        source_url = str(video.get("sourceUrl") or "")
        if not source_url or source_url in seen:
            continue
        seen.add(source_url)
        videos.append(video)
        if len(videos) >= 4:
            break
    base = dict(current or incoming)
    base["videos"] = videos
    return base


def run_study_plan_graph(
    initial_state: StudyPlanGraphState,
    *,
    choose_tool: ToolChoice,
    tool_reason: ToolReason,
    lookup_youtube: YoutubeLookup,
    create_recommendations: PlaylistBuilder,
) -> StudyPlanGraphState:
    return cast(
        StudyPlanGraphState,
        STUDY_PLAN_GRAPH.invoke(
            initial_state,
            context=StudyPlanGraphContext(
                choose_tool=choose_tool,
                tool_reason=tool_reason,
                lookup_youtube=lookup_youtube,
                create_recommendations=create_recommendations,
            ),
        ),
    )
