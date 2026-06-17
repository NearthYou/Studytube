from app.schemas.analysis import (
    AnalysisRequest,
    AnalysisResponse,
    WorkflowStepRecord,
)
from app.services.analysis_service import make_demo_analysis


def _step(step: int, name: str, status: str, detail: str) -> WorkflowStepRecord:
    return WorkflowStepRecord(
        step=step,
        name=name,
        status=status,
        detail=detail,
    )


def run_analysis_workflow(request: AnalysisRequest) -> AnalysisResponse:
    workflow_steps = [
        _step(
            1,
            "현재 기록 입력 받기",
            "success",
            f"게시글 {request.currentPost.id}번 기록을 분석 대상으로 받았습니다.",
        ),
        _step(
            2,
            "MCP tool로 운동명 정규화",
            "success" if request.toolCalls else "skipped",
            f"운동명 정규화 tool 호출 결과 {len(request.toolCalls)}개를 받았습니다.",
        ),
        _step(
            3,
            "이전 기록 검색 결과 받기",
            "success",
            f"정규화된 운동명 기준 비교 후보 {len(request.previousPosts)}개를 받았습니다.",
        ),
    ]

    analysis = make_demo_analysis(request)
    analysis.toolCalls = list(request.toolCalls)
    analysis.workflowSteps = [
        *workflow_steps,
        _step(
            4,
            "AI 분석 실행",
            "success",
            f"{analysis.analysisMode} 모드로 요약, 추천, 다음 목표를 생성했습니다.",
        ),
        _step(
            5,
            "결과 반환",
            "success",
            "분석 결과를 DB에 저장하지 않고 화면 응답으로만 반환합니다.",
        ),
    ]

    if request.toolCalls:
        analysis.basis = [
            *analysis.basis,
            f"FastAPI 내부 MCP-style tool 호출 {len(request.toolCalls)}개를 분석 흐름에 포함했습니다.",
        ]

    return analysis
