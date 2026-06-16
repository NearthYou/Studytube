from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

from app.schemas.agent import TravelAgentRequest, WeatherInsight


GuardrailReason = Literal["ok", "prompt_injection", "off_domain"]


@dataclass(frozen=True)
class GuardrailDecision:
    allowed: bool
    reason: GuardrailReason
    answer: str
    summary: str


TRAVEL_KEYWORDS = (
    "여행",
    "일정",
    "코스",
    "관광",
    "숙소",
    "호텔",
    "펜션",
    "맛집",
    "카페",
    "드라이브",
    "휴가",
    "혼행",
    "가족여행",
    "커플",
    "데이트",
    "동선",
    "예산",
    "1박",
    "2박",
    "3박",
    "4박",
    "5박",
    "당일치기",
    "trip",
    "travel",
    "itinerary",
    "route",
    "hotel",
    "stay",
    "cafe",
    "restaurant",
    "sightseeing",
    "vacation",
    "budget",
)

REGION_KEYWORDS = (
    "강릉",
    "제주",
    "부산",
    "전주",
    "여수",
    "속초",
    "남해",
    "춘천",
    "포항",
    "경주",
    "통영",
    "가평",
    "서울",
    "인천",
    "대구",
    "울산",
    "gangneung",
    "jeju",
    "busan",
    "jeonju",
    "yeosu",
    "sokcho",
    "namhae",
    "chuncheon",
    "pohang",
    "gyeongju",
    "tongyeong",
    "gapyeong",
    "seoul",
)

PROMPT_INJECTION_PATTERNS = (
    r"ignore\s+(all\s+)?(previous|prior|above|system|developer)\s+(instructions?|prompts?|messages?)",
    r"forget\s+(all\s+)?(previous|prior|above|system|developer)\s+(instructions?|prompts?|messages?)",
    r"disregard\s+(all\s+)?(previous|prior|above|system|developer)\s+(instructions?|prompts?|messages?)",
    r"(system|developer)\s+(prompt|message|instruction)",
    r"jailbreak|bypass\s+(the\s+)?(rules|policy|instructions?)",
    r"(프롬프트|지시|명령|규칙).*(잊|무시|초기화|삭제|바꿔|변경)",
    r"(잊|무시|초기화|삭제).*(프롬프트|지시|명령|규칙)",
    r"(시스템|개발자).*(프롬프트|메시지|지시|명령)",
    r"지금까지.*(잊|무시)",
)


def _normalized_text(request: TravelAgentRequest) -> str:
    parts = [
        request.query,
        request.region,
        request.budget,
        request.theme,
        request.season,
        request.companion,
        request.travel_date,
    ]
    return " ".join(part for part in parts if part).casefold()


def _has_prompt_injection(text: str) -> bool:
    return any(re.search(pattern, text, re.IGNORECASE) for pattern in PROMPT_INJECTION_PATTERNS)


def _has_travel_context(request: TravelAgentRequest, text: str) -> bool:
    if any(keyword.casefold() in text for keyword in TRAVEL_KEYWORDS):
        return True

    if any(keyword.casefold() in text for keyword in REGION_KEYWORDS):
        return True

    return any(
        [
            request.region.strip(),
            request.budget.strip(),
            request.theme.strip(),
            request.companion.strip(),
        ]
    )


def _blocked_answer(request: TravelAgentRequest, reason: GuardrailReason) -> str:
    if request.language == "ko":
        if reason == "prompt_injection":
            return (
                "## 여행 상담 범위로만 도와드릴게요\n\n"
                "요청에 기존 지시를 바꾸거나 무시하려는 문장이 포함되어 있어요. "
                "저는 Tripy의 여행 게시글과 여행 조건을 바탕으로 여행지 추천, 일정, 동선, 예산 조정만 도와드릴 수 있습니다.\n\n"
                "예: `부산에서 친구와 1박 2일로 갈 만한 맛집 중심 코스 추천해줘`"
            )

        return (
            "## 여행 관련 질문만 답할 수 있어요\n\n"
            "레시피, 일반 지식, 코딩처럼 여행과 무관한 요청에는 답하지 않습니다. "
            "대신 음식 취향을 여행 조건으로 바꾸면 도와드릴 수 있어요.\n\n"
            "예: `전주에서 한식 맛집 중심 당일치기 코스 추천해줘`"
        )

    if reason == "prompt_injection":
        return (
            "## I can only help within travel planning\n\n"
            "Your request includes text that tries to change or ignore the current instructions. "
            "I can help only with travel recommendations, itinerary planning, routes, lodging, budget, and Tripy community evidence.\n\n"
            "Example: `Recommend a 2-day Busan food-focused trip with friends.`"
        )

    return (
        "## I can answer travel-related questions only\n\n"
        "I cannot answer unrelated requests like recipes, general knowledge, or coding. "
        "If you turn the food preference into a travel request, I can help.\n\n"
        "Example: `Recommend a Jeonju day trip focused on Korean food.`"
    )


def build_guardrail_weather(request: TravelAgentRequest) -> WeatherInsight:
    if request.language == "ko":
        return WeatherInsight(
            headline="여행 조건을 입력하면 날씨 참고를 함께 확인할게요.",
            temperature="정보 없음",
            travel_verdict="여행 요청이 들어오면 지역과 날짜에 맞춰 판단합니다.",
            caution="여행과 관련된 지역, 날짜, 동행, 예산을 알려주세요.",
        )

    return WeatherInsight(
        headline="Share travel conditions to check weather context.",
        temperature="No data",
        travel_verdict="I can evaluate weather once the request is about a trip.",
        caution="Add a region, date, companion, or budget for travel planning.",
    )


def check_travel_guardrail(request: TravelAgentRequest) -> GuardrailDecision:
    text = _normalized_text(request)

    if _has_prompt_injection(text):
        return GuardrailDecision(
            allowed=False,
            reason="prompt_injection",
            answer=_blocked_answer(request, "prompt_injection"),
            summary="Blocked a prompt-injection attempt before retrieval and generation.",
        )

    if not _has_travel_context(request, text):
        return GuardrailDecision(
            allowed=False,
            reason="off_domain",
            answer=_blocked_answer(request, "off_domain"),
            summary="Blocked an off-domain request before retrieval and generation.",
        )

    return GuardrailDecision(
        allowed=True,
        reason="ok",
        answer="",
        summary="Request is within the travel-assistant domain.",
    )
