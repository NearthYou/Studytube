from __future__ import annotations

from typing import Any

from app.schemas.agent import AgentSource, PlanDay, PlanStop, TravelAgentRequest, WeatherInsight


def _is_korean(request: TravelAgentRequest) -> bool:
    return request.language == "ko"


def build_weather_insight(raw: dict[str, Any], request: TravelAgentRequest) -> WeatherInsight:
    if _is_korean(request):
        return WeatherInsight(
            headline=raw.get("headline_ko") or raw.get("headline") or "아직 날씨 정보가 없습니다.",
            temperature=raw.get("temperature_ko") or raw.get("temperature") or "온도 정보 없음",
            travel_verdict=raw.get("travelVerdict_ko") or raw.get("travelVerdict") or "현지 날씨를 고려해 일정을 조정하세요.",
            caution=raw.get("caution_ko") or raw.get("caution") or "출발 전 실시간 예보를 다시 확인하세요.",
        )

    return WeatherInsight(
        headline=raw.get("headline") or "Weather information is not available yet.",
        temperature=raw.get("temperature") or "No temperature data",
        travel_verdict=raw.get("travelVerdict") or "Adjust the itinerary with local weather in mind.",
        caution=raw.get("caution") or "Check a live forecast before departure.",
    )


def format_sources(
    search_result: dict[str, Any],
    detail_payloads: list[dict[str, Any]],
    comments_by_post_id: dict[int, dict[str, Any]],
) -> list[AgentSource]:
    details_by_id = {
        detail["post"]["id"]: detail["post"]
        for detail in detail_payloads
        if isinstance(detail.get("post"), dict) and isinstance(detail["post"].get("id"), int)
    }

    sources: list[AgentSource] = []
    for item in search_result.get("items", []):
        post_id = item.get("postId")
        if not isinstance(post_id, int):
            continue

        detail = details_by_id.get(post_id, {})
        comments = comments_by_post_id.get(post_id, {}).get("items", [])
        comment_highlights = [
          comment.get("content", "")
          for comment in comments[:2]
          if isinstance(comment, dict) and comment.get("content")
        ]

        sources.append(
            AgentSource(
                post_id=post_id,
                title=item.get("title") or detail.get("title") or f"Post {post_id}",
                summary=item.get("summary") or detail.get("summary") or "",
                region=item.get("region") or detail.get("region") or "",
                theme=item.get("theme") or detail.get("theme") or "",
                companion=item.get("companion") or detail.get("companion") or "",
                travel_date=item.get("travelDate") or detail.get("travelDate") or "",
                matched_excerpt=item.get("matchedExcerpt") or detail.get("content", "")[:220],
                score=float(item.get("score")) if item.get("score") is not None else None,
                comment_highlights=comment_highlights,
            )
        )

    return sources


def build_retrieval_summary(request: TravelAgentRequest, sources: list[AgentSource]) -> str:
    if not sources:
        if _is_korean(request):
            return (
                f"'{request.query}' 요청에 바로 맞는 게시글 근거가 아직 충분하지 않습니다. "
                "검색 범위를 넓히거나 필터를 하나 완화해보세요."
            )

        return (
            f"The request '{request.query}' does not yet have enough matching source posts. "
            "Try widening the search or relaxing one filter."
        )

    top_region = sources[0].region or ("알 수 없음" if _is_korean(request) else "unknown")
    top_theme = sources[0].theme or ("알 수 없음" if _is_korean(request) else "unknown")

    if _is_korean(request):
        return (
            f"'{request.query}' 요청과 가장 가까운 커뮤니티 게시글 {len(sources)}개를 근거로 사용했습니다. "
            f"대표 지역은 {top_region}, 대표 테마는 {top_theme}입니다."
        )

    return (
        f"Used {len(sources)} community posts closest to '{request.query}' as grounding evidence. "
        f"Top region: {top_region}, top theme: {top_theme}."
    )


def build_plan_days(
    request: TravelAgentRequest,
    sources: list[AgentSource],
    weather: WeatherInsight,
) -> list[PlanDay]:
    duration = max(1, min(request.duration, 5))
    region = request.region or (sources[0].region if sources else ("추천 지역" if _is_korean(request) else "recommended region"))
    theme = request.theme or (sources[0].theme if sources else ("맞춤 여행" if _is_korean(request) else "custom trip"))

    style_suffix = {
        "balanced": "균형형" if _is_korean(request) else "balanced",
        "budget": "예산형" if _is_korean(request) else "budget",
        "slow": "여유형" if _is_korean(request) else "slow",
    }[request.plan_style]

    plan_days: list[PlanDay] = []
    for index in range(duration):
        source = sources[index % len(sources)] if sources else None
        title = source.title if source else (f"{region} 핵심 코스" if _is_korean(request) else f"{region} key course")
        day_label = f"{'DAY' if not _is_korean(request) else 'DAY'} {index + 1}"
        day_theme = f"{region} {style_suffix} {'일정' if _is_korean(request) else 'plan'}"

        if _is_korean(request):
            stops = [
                PlanStop(
                    time="09:30",
                    title=f"{title} 시작 동선",
                    description=(
                        f"커뮤니티 게시글 '{title}'에서 언급된 핵심 포인트를 중심으로 "
                        f"{region} 여행의 첫 동선을 잡습니다."
                    ),
                    estimated_cost=request.budget or "예산 조정 가능",
                ),
                PlanStop(
                    time="13:00",
                    title=f"{theme} 중심 식사 및 휴식",
                    description=(
                        f"{request.companion or '동행'} 여행 기준으로 이동 피로가 적은 중간 동선을 배치합니다. "
                        f"날씨 메모: {weather.temperature}"
                    ),
                    estimated_cost="1만~3만원",
                ),
                PlanStop(
                    time="17:30",
                    title=f"{region} 마무리 코스",
                    description=weather.caution,
                    estimated_cost="0~5만원",
                ),
            ]
        else:
            stops = [
                PlanStop(
                    time="09:30",
                    title=f"{title} opening route",
                    description=(
                        f"Start with the core points from the community post '{title}' "
                        f"to set the opening route for {region}."
                    ),
                    estimated_cost=request.budget or "budget flexible",
                ),
                PlanStop(
                    time="13:00",
                    title=f"{theme} lunch and activity block",
                    description=(
                        f"Place a lower-friction mid-day route for {request.companion or 'the group'}. "
                        f"Weather note: {weather.temperature}"
                    ),
                    estimated_cost="10k-30k KRW",
                ),
                PlanStop(
                    time="17:30",
                    title=f"{region} closing stop",
                    description=weather.caution,
                    estimated_cost="0-50k KRW",
                ),
            ]

        plan_days.append(
            PlanDay(
                day_label=day_label,
                theme=day_theme,
                stops=stops,
            )
        )

    return plan_days


def make_prompt_context(
    request: TravelAgentRequest,
    sources: list[AgentSource],
    weather: WeatherInsight,
    retrieval_summary: str,
    plan: list[PlanDay],
) -> str:
    source_lines = []
    for source in sources:
        comments = " | ".join(source.comment_highlights) if source.comment_highlights else "No comment highlights"
        source_lines.append(
            f"- {source.title} / {source.region} / {source.theme} / {source.companion}\n"
            f"  summary: {source.summary}\n"
            f"  excerpt: {source.matched_excerpt}\n"
            f"  comments: {comments}"
        )

    plan_lines = []
    for day in plan:
        plan_lines.append(
            f"- {day.day_label} {day.theme}: "
            + "; ".join(f"{stop.time} {stop.title}" for stop in day.stops)
        )

    return (
        f"Target language: {request.language}\n"
        f"User request: {request.model_dump()}\n\n"
        f"Retrieval summary: {retrieval_summary}\n\n"
        f"Weather: {weather.model_dump()}\n\n"
        f"Sources:\n" + ("\n".join(source_lines) if source_lines else "- none") + "\n\n"
        f"Draft plan:\n" + ("\n".join(plan_lines) if plan_lines else "- none")
    )
