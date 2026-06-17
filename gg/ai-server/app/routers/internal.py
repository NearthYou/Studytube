import os
from typing import Optional

from dotenv import load_dotenv
from fastapi import APIRouter, Header, HTTPException, status

load_dotenv()

router = APIRouter(prefix="/internal", tags=["internal"])


def verify_internal_token(x_internal_token: Optional[str]) -> None:
    expected_token = os.getenv("AI_INTERNAL_TOKEN", "change-me")

    if x_internal_token != expected_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="유효하지 않은 내부 요청 토큰입니다.",
        )


@router.get("/health")
def internal_health(x_internal_token: Optional[str] = Header(default=None)):
    verify_internal_token(x_internal_token)

    return {
        "status": "ok",
        "service": "ai-server",
        "scope": "internal",
    }
