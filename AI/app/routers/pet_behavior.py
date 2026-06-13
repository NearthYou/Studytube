from fastapi import APIRouter

from app.rag.schemas import PetBehaviorQuestionRequest, PetBehaviorQuestionResponse
from app.rag.service import PetBehaviorRagService

router = APIRouter(prefix="/pet-behavior", tags=["pet-behavior"])
service = PetBehaviorRagService()


@router.post("/question", response_model=PetBehaviorQuestionResponse)
def question(request: PetBehaviorQuestionRequest):
    return service.answer_question(request)
