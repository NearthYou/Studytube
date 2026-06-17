from fastapi import FastAPI  # FastAPI 서버 앱을 만들기 위해 가져온다.
from app.routers.demo import router as demo_router  # 기존 데모 API 묶음을 가져온다.
from app.routers.analysis import (
    router as analysis_router,
)  # 새로 만든 분석 API 묶음을 가져온다.
from app.routers.internal import (
    router as internal_router,
)  # NestJS 같은 내부 서버가 호출할 API 묶음을 가져온다.

app = FastAPI()  # FastAPI 서버 객체를 만든다.

app.include_router(demo_router)  # 기존 데모 API를 서버에 등록한다.
app.include_router(
    analysis_router, prefix="/analysis", tags=["analysis"]
)  # 분석 API를 /analysis로 시작하는 주소에 등록한다.
app.include_router(internal_router)  # 내부 서버 전용 API를 서버에 등록한다.


@app.get("/health")  # GET /health 요청으로 AI 서버 상태를 확인할 수 있게 한다.
def health():  # AI 서버가 켜져 있는지 알려주는 함수다.
    return {
        "status": "ok",  # 서버가 정상이라는 표시다.
        "service": "ai-server",  # 이 응답이 AI 서버에서 온 것임을 표시한다.
    }
