from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import httpx
from dotenv import load_dotenv

from app.schemas.agent import AgentSource, TravelAgentRequest, WeatherInsight


OPENAI_URL = "https://api.openai.com/v1/chat/completions"
ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / ".env", override=False)


@dataclass
class LLMAnswer:
    text: str
    provider: str
    detail: str


def _target_language(request: TravelAgentRequest) -> str:
    return "Korean" if request.language == "ko" else "English"


def _build_fallback_answer(
    user_request: TravelAgentRequest,
    mode: Literal["chat", "plan"],
    fallback_sources: list[AgentSource],
    weather: WeatherInsight,
) -> str:
    if not fallback_sources:
        if user_request.language == "ko":
            return (
                "## 아직 근거가 부족해요\n\n"
                "지금 요청에 바로 맞는 커뮤니티 근거가 더 필요해요.\n\n"
                f"- 날씨 메모: {weather.headline}\n"
                "- 지역, 예산, 테마, 동행인을 조금 더 구체적으로 알려주면 더 정확하게 추천할 수 있어요."
            )

        return (
            "## More grounded evidence is needed\n\n"
            "I need a bit more community evidence before making a strong recommendation.\n\n"
            f"- Weather note: {weather.headline}\n"
            "- Add more detail about region, budget, theme, or companion for a better answer."
        )

    titles = [source.title for source in fallback_sources[:3]]
    title_lines = "\n".join(f"- {title}" for title in titles)

    if user_request.language == "ko":
        heading = "## 추천 방향" if mode == "chat" else "## 일정 초안 방향"
        return (
            f"{heading}\n\n"
            f"- 요청: {user_request.query}\n"
            "- 근거 기반으로 커뮤니티 게시글을 묶어서 정리했어요.\n"
            f"- 날씨 판단: {weather.travel_verdict}\n"
            f"- 주의사항: {weather.caution}\n\n"
            "### 참고한 게시글\n"
            f"{title_lines}"
        )

    heading = "## Recommended direction" if mode == "chat" else "## Draft itinerary direction"
    return (
        f"{heading}\n\n"
        f"- Request: {user_request.query}\n"
        "- This summary is grounded in matching community posts.\n"
        f"- Weather verdict: {weather.travel_verdict}\n"
        f"- Caution: {weather.caution}\n\n"
        "### Referenced posts\n"
        f"{title_lines}"
    )


async def _try_openai_completion(
    prompt_context: str,
    mode: Literal["chat", "plan"],
    user_request: TravelAgentRequest,
) -> tuple[str | None, str]:
    api_key = os.getenv("GPT_API_KEY", "").strip()
    model = os.getenv("GPT_MODEL", "gpt-4.1-mini").strip()

    if not api_key:
        return None, "GPT_API_KEY is missing."

    payload = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a travel planning assistant. Use only the provided grounded context. "
                    "Do not invent any source, route, or weather information. "
                    "Return the final answer in clean Markdown with short headings and bullet points when useful."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Mode: {mode}\n"
                    f"Write a concise grounded answer in {_target_language(user_request)}.\n"
                    "Follow the target language even if the user query itself is mixed-language.\n"
                    "Format the answer as Markdown. Prefer short sections and bullet points over long paragraphs.\n\n"
                    f"{prompt_context}"
                ),
            },
        ],
        "temperature": 0.4,
    }

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                OPENAI_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
    except Exception as exc:
        return None, f"OpenAI request failed: {exc}"

    choices = data.get("choices", [])
    if not choices:
        return None, "OpenAI returned no choices."

    message = choices[0].get("message", {})
    content = message.get("content")
    if isinstance(content, str) and content.strip():
        return content.strip(), f"OpenAI model {model} generated the answer."

    return None, "OpenAI returned an empty message."


async def generate_grounded_answer(
    user_request: TravelAgentRequest,
    mode: Literal["chat", "plan"],
    prompt_context: str,
    fallback_sources: list[AgentSource],
    weather: WeatherInsight,
) -> LLMAnswer:
    generated, detail = await _try_openai_completion(prompt_context, mode, user_request)
    if generated:
        return LLMAnswer(
            text=generated,
            provider="openai",
            detail=detail,
        )

    return LLMAnswer(
        text=_build_fallback_answer(user_request, mode, fallback_sources, weather),
        provider="fallback",
        detail=detail,
    )
