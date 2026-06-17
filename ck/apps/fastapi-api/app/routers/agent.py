from fastapi import APIRouter

from app.schemas.agent import SeatRecommendationRequest, SeatRecommendationResponse
from app.services.seat_agent_service import recommend_seat

router = APIRouter(prefix="/agent", tags=["agent"])


@router.post("/seat-recommendations", response_model=SeatRecommendationResponse)
def seat_recommendations(request: SeatRecommendationRequest):
    return recommend_seat(request)
