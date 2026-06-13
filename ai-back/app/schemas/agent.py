from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class TravelAgentRequest(BaseModel):
    query: str = Field(min_length=1)
    session_id: str = ""
    region: str = ""
    budget: str = ""
    theme: str = ""
    season: str = ""
    companion: str = ""
    travel_date: str = ""
    duration: int = Field(default=2, ge=1, le=5)
    language: Literal["ko", "en"] = "ko"
    plan_style: Literal["balanced", "budget", "slow"] = "balanced"


class WeatherInsight(BaseModel):
    headline: str
    temperature: str
    travel_verdict: str
    caution: str


class AgentSource(BaseModel):
    post_id: int
    title: str
    summary: str
    region: str
    theme: str
    companion: str
    travel_date: str
    matched_excerpt: str = ""
    score: float | None = None
    comment_highlights: list[str] = Field(default_factory=list)


class PlanStop(BaseModel):
    time: str
    title: str
    description: str
    estimated_cost: str


class PlanDay(BaseModel):
    day_label: str
    theme: str
    stops: list[PlanStop]


class ToolTrace(BaseModel):
    tool: str
    purpose: str
    summary: str


class AgentChatResponse(BaseModel):
    session_id: str | None = None
    answer: str
    retrieval_summary: str
    weather: WeatherInsight
    sources: list[AgentSource]
    plan: list[PlanDay]
    trace: list[ToolTrace]


class AgentPlanResponse(AgentChatResponse):
    style: Literal["balanced", "budget", "slow"]
