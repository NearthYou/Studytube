# FastAPI에서는 요청 데이터가 올바른 형식인지 검사하기 위해 Pydantic을 자주 사용한다.
# BaseModel을 상속해서 "어떤 데이터를 받을지" 형식을 정의할 수 있다.

from pydantic import BaseModel


class ChatRequest(BaseModel):
    message: str


class ChatResponse(BaseModel):
    answer: str
