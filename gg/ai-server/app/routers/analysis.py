from typing import Optional

from fastapi import (
    APIRouter,
    Header,
)  # FastAPI에서 API 주소 묶음과 요청 헤더를 받기 위해 가져온다.
from app.routers.internal import (
    verify_internal_token,
)  # NestJS가 보낸 내부 요청 토큰이 맞는지 검사한다.
from app.schemas.analysis import (
    AnalysisRequest,
    AnalysisResponse,
    NormalizeExercisesRequest,
    NormalizeExercisesResponse,
)  # 분석 API의 요청/응답 모양을 가져온다.
from app.services.agent_service import (
    run_analysis_workflow,
)  # 분석 순서를 관리하는 Agent workflow를 가져온다.
from app.services.tool_service import (
    normalize_exercise_names,
)  # FastAPI 내부 MCP-style tool 함수를 가져온다.

router = APIRouter()  # 분석 관련 API 주소들을 이 router에 모은다.


@router.post(
    "/demo", response_model=AnalysisResponse
)  # POST /analysis/demo 요청을 받을 준비를 한다.
def analyze_demo(
    request: AnalysisRequest,
    x_internal_token: Optional[str] = Header(default=None),
):  # NestJS가 보낸 운동 기록 분석 요청을 받는다.
    verify_internal_token(
        x_internal_token
    )  # FastAPI를 아무나 직접 호출하지 못하도록 내부 토큰을 검사한다.
    return run_analysis_workflow(
        request
    )  # Agent workflow로 분석 결과를 만들어서 응답한다.


@router.post(
    "/tools/normalize-exercises", response_model=NormalizeExercisesResponse
)  # POST /analysis/tools/normalize-exercises 요청을 받을 준비를 한다.
def normalize_exercises(
    request: NormalizeExercisesRequest,
    x_internal_token: Optional[str] = Header(default=None),
):  # NestJS가 이전 기록 검색 전에 운동명 정규화를 요청한다.
    verify_internal_token(
        x_internal_token
    )  # FastAPI를 아무나 직접 호출하지 못하도록 내부 토큰을 검사한다.
    normalized_names, tool_calls = normalize_exercise_names(
        request.names
    )  # FastAPI 내부 MCP-style tool로 운동명을 정규화한다.
    return NormalizeExercisesResponse(
        normalizedNames=normalized_names,
        toolCalls=tool_calls,
    )
