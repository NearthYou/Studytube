from fastapi import APIRouter
from app.schemas.message import ChatRequest, ChatResponse
from app.services.message_service import make_answer

router = APIRouter()


@router.get("/hello")
def hello():
    return {"message": "GET 요청이 정상적으로 동작합니다."}


@router.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest):
    answer = make_answer(request.message)
    return ChatResponse(answer=answer)