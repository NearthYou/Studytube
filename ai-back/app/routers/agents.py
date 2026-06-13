from fastapi import APIRouter

from app.schemas.agent import AgentChatResponse, AgentPlanResponse, TravelAgentRequest
from app.services.agent_service import run_chat_agent, run_plan_agent

router = APIRouter(prefix="/agent", tags=["agent"])


@router.post("/chat", response_model=AgentChatResponse)
async def chat_with_agent(request: TravelAgentRequest) -> AgentChatResponse:
    return await run_chat_agent(request)


@router.post("/plan", response_model=AgentPlanResponse)
async def build_plan_with_agent(request: TravelAgentRequest) -> AgentPlanResponse:
    return await run_plan_agent(request)
