#FastAPI에서는 요청 데이터가 올바른 형식인지 검사하기 위해 **Pydantic**을 자주 사용한다.
# BaseModel은 Pydantic이 제공하는 기본 클래스이고,  
# 이걸 상속해서 “어떤 데이터를 받을지” 형식을 정의할 수 있다.

from pydantic import BaseModel

# 이렇게 해두면 FastAPI는 요청이 들어왔을 때
# message 필드가 있는지
# message가 문자열인지
# 자동으로 검사해준다.

class ChatRequest(BaseModel):
    message: str

class ChatResponse(BaseModel):
    answer: str