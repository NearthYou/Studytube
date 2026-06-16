from __future__ import annotations

from typing import Any

from app.mcp.client import travel_mcp_client
from app.schemas.agent import (
    AgentChatResponse,
    AgentPlanResponse,
    ToolTrace,
    TravelAgentRequest,
)
from app.services.chat_memory_service import (
    create_session_id,
    format_history_block,
    load_recent_history,
    store_chat_exchange,
)
from app.services.guardrail_service import build_guardrail_weather, check_travel_guardrail
from app.services.llm_service import generate_grounded_answer
from app.services.rag_service import (
    build_plan_days,
    build_retrieval_summary,
    build_weather_insight,
    format_sources,
    make_prompt_context,
)


async def _collect_context(request: TravelAgentRequest) -> tuple[dict[str, Any], list[ToolTrace]]:
    traces: list[ToolTrace] = []

    async with travel_mcp_client() as client:
        search_result = await client.call_tool(
            "search_posts",
            {
                "query": request.query,
                "region": request.region,
                "budget": request.budget,
                "theme": request.theme,
                "season": request.season,
                "companion": request.companion,
                "limit": 4,
            },
        )
        traces.append(
            ToolTrace(
                tool="search_posts",
                purpose="Find relevant community posts for RAG grounding.",
                summary=f"Retrieved {len(search_result.get('items', []))} candidate posts.",
            )
        )

        weather = await client.call_tool(
            "get_weather",
            {
                "region": request.region,
                "travel_date": request.travel_date,
            },
        )
        traces.append(
            ToolTrace(
                tool="get_weather",
                purpose="Add travel conditions to the recommendation.",
                summary=weather.get("headline", "Weather summary generated."),
            )
        )

        detail_payloads: list[dict[str, Any]] = []
        comment_payloads: dict[int, dict[str, Any]] = {}
        for item in search_result.get("items", [])[:2]:
            post_id = item.get("postId")
            if not isinstance(post_id, int):
                continue

            detail = await client.call_tool("get_post_detail", {"post_id": post_id})
            detail_payloads.append(detail)
            traces.append(
                ToolTrace(
                    tool="get_post_detail",
                    purpose="Load the full post content for top hits.",
                    summary=f"Loaded post {post_id}.",
                )
            )

            comments = await client.call_tool("get_post_comments", {"post_id": post_id})
            comment_payloads[post_id] = comments
            traces.append(
                ToolTrace(
                    tool="get_post_comments",
                    purpose="Collect comment-based travel hints.",
                    summary=f"Loaded {len(comments.get('items', []))} comments for post {post_id}.",
                )
            )

    return {
        "search": search_result,
        "weather": weather,
        "details": detail_payloads,
        "comments": comment_payloads,
    }, traces


async def run_chat_agent(request: TravelAgentRequest) -> AgentChatResponse:
    session_id = request.session_id.strip() or create_session_id()
    guardrail = check_travel_guardrail(request)

    if not guardrail.allowed:
        trace = [
            ToolTrace(
                tool="travel_guardrail",
                purpose="Keep the chatbot limited to travel planning and ignore prompt-injection attempts.",
                summary=guardrail.summary,
            )
        ]
        store_chat_exchange(session_id, request.language, request.query, guardrail.answer)

        return AgentChatResponse(
            session_id=session_id,
            answer=guardrail.answer,
            retrieval_summary=guardrail.summary,
            weather=build_guardrail_weather(request),
            sources=[],
            plan=[],
            trace=trace,
        )

    history = load_recent_history(session_id)
    context, trace = await _collect_context(request)
    sources = format_sources(context["search"], context["details"], context["comments"])
    weather = build_weather_insight(context["weather"], request)
    retrieval_summary = build_retrieval_summary(request, sources)
    plan = build_plan_days(request, sources, weather)
    answer = await generate_grounded_answer(
        user_request=request,
        mode="chat",
        prompt_context=(
            make_prompt_context(request, sources, weather, retrieval_summary, plan)
            + "\n\n"
            + format_history_block(history)
        ),
        fallback_sources=sources,
        weather=weather,
    )
    trace.append(
        ToolTrace(
            tool="openai_chat",
            purpose="Generate the final grounded response.",
            summary=answer.detail,
        )
    )
    store_chat_exchange(session_id, request.language, request.query, answer.text)

    return AgentChatResponse(
        session_id=session_id,
        answer=answer.text,
        retrieval_summary=retrieval_summary,
        weather=weather,
        sources=sources,
        plan=plan,
        trace=trace,
    )


async def run_plan_agent(request: TravelAgentRequest) -> AgentPlanResponse:
    guardrail = check_travel_guardrail(request)

    if not guardrail.allowed:
        trace = [
            ToolTrace(
                tool="travel_guardrail",
                purpose="Keep the planner limited to travel planning and ignore prompt-injection attempts.",
                summary=guardrail.summary,
            )
        ]

        return AgentPlanResponse(
            session_id=request.session_id.strip() or None,
            answer=guardrail.answer,
            retrieval_summary=guardrail.summary,
            weather=build_guardrail_weather(request),
            sources=[],
            plan=[],
            trace=trace,
            style=request.plan_style,
        )

    context, trace = await _collect_context(request)
    sources = format_sources(context["search"], context["details"], context["comments"])
    weather = build_weather_insight(context["weather"], request)
    retrieval_summary = build_retrieval_summary(request, sources)
    plan = build_plan_days(request, sources, weather)
    answer = await generate_grounded_answer(
        user_request=request,
        mode="plan",
        prompt_context=make_prompt_context(request, sources, weather, retrieval_summary, plan),
        fallback_sources=sources,
        weather=weather,
    )
    trace.append(
        ToolTrace(
            tool="openai_chat",
            purpose="Generate the final grounded response.",
            summary=answer.detail,
        )
    )

    return AgentPlanResponse(
        session_id=request.session_id.strip() or None,
        answer=answer.text,
        retrieval_summary=retrieval_summary,
        weather=weather,
        sources=sources,
        plan=plan,
        trace=trace,
        style=request.plan_style,
    )
